import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { getJwtAccessSecret } from '../auth/jwt.config';
import { PrismaService } from '../prisma/prisma.service';
import { assertCafeActive } from '../platform/cafe-status';
import { MAX_BATCH_FRAMES, PttStreamBuffer, REPLAY_TTL_MS } from './ptt-stream';
import { liveKitRadio, radioPublishPermission, radioRoom, radioToken } from './ptt-livekit';

const PTT_CHANNELS = ['general', 'waiters', 'kitchen', 'admin'] as const;
type PttChannel = (typeof PTT_CHANNELS)[number];

const PTT_EVENTS = {
  JOIN: 'ptt_join',
  START_TALK: 'ptt_start_talk',
  STOP_TALK: 'ptt_stop_talk',
  CHANNEL_BUSY: 'ptt_channel_busy',
  CHANNEL_FREE: 'ptt_channel_free',
  AUDIO_MESSAGE: 'ptt_audio_message',
  AUDIO_FRAME: 'ptt_audio_frame',
  AUDIO_PACKET: 'ptt_audio_packet',
  AUDIO_BATCH: 'ptt_audio_batch',
  AUDIO_SYNC: 'ptt_audio_sync',
  TALK_DENIED: 'ptt_talk_denied',
  PRESENCE: 'ptt_presence',
  LIVEKIT_CONNECT: 'ptt_livekit_connect',
  LIVEKIT_READY: 'ptt_livekit_ready',
  LIVEKIT_TRACK_READY: 'ptt_livekit_track_ready',
  LIVEKIT_WAIT_TRACK: 'ptt_livekit_wait_track',
  LIVEKIT_KEEPALIVE: 'ptt_livekit_keepalive',
} as const;

// Целый аудиофайл (Telegram-модель) заметно больше отдельного чанка —
// допускаем ~8 МБ base64, чего хватает на длинное голосовое сообщение.
const MAX_AUDIO_CHARS = 8_000_000;
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;
// Live frames contain 40 ms of mono, 16 kHz, signed 16-bit PCM.
const LIVE_FRAME_BYTES = 1280;
// Legacy Opus uses 40 ms frames at 12 kbit/s. The HQ profile uses 20 ms at 32 kbit/s.
const OPUS_HEADER_BYTES = 16;
const LIVE_IDLE_MS = 4000;
const LIVEKIT_IDLE_MS = 9000;
const CAPABILITY_CHECK_TIMEOUT_MS = 200;
// TCP and the initial channel grant can deliver several seconds of queued frames together.
const LEGACY_LIMIT = { burst: 110, perSecond: 30 };
const OPUS_PROFILES = {
  opus: { frameBytes: 60, packetFrames: 2, limit: LEGACY_LIMIT },
  'opus-hq': { frameBytes: 80, packetFrames: 1, limit: { burst: 220, perSecond: 60 } },
} as const;
type OpusProfile = keyof typeof OPUS_PROFILES;
const TALK_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

interface SocketUser {
  id: string;
  role: string;
  name?: string;
  cafeId: string | null;
}

type AuthenticatedSocketUser = SocketUser & { cafeId: string };

interface TalkLock {
  socketId: string;
  userId: string;
  startedAt: string;
  role: string;
  name?: string;
  live?: {
    id: string;
    opus?: { profile: OpusProfile; header: Buffer };
    liveKit?: {
      grant: Promise<unknown>;
      closing: boolean;
      listeners: Set<string>;
      subscribed: Map<string, string>;
    };
    stream?: PttStreamBuffer;
    frames: number;
    lastFrameAt: number;
    timeout: NodeJS.Timeout;
  };
}

interface JoinBody {
  channel?: PttChannel | null;
  codecs?: OpusProfile[];
  sequenced?: boolean;
}

interface TalkBody {
  channel?: PttChannel;
  talkId?: string;
  codec?: 'opus' | 'livekit';
  preferHq?: boolean;
  sequenced?: boolean;
  frames?: number;
}

interface AudioBatchBody extends TalkBody {
  firstFrame?: number;
  audio?: Buffer;
}

interface AudioFrameBody extends TalkBody {
  audio?: Buffer;
}

interface AudioMessageBody extends TalkBody {
  chunk?: string;
  mimeType?: string;
}

@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
    credentials: true,
  },
})
export class PttGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('PttGateway');
  private readonly locks = new Map<string, TalkLock>();
  private readonly recentStreams = new Map<string, { channel: PttChannel; lock: TalkLock; expires: number }>();

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  handleDisconnect(client: Socket) {
    const channel = client.data.pttChannel as PttChannel | undefined;
    this.releaseTalker(client);
    this.leaveLiveKit(client);
    if (channel) {
      void this.emitPresence(client, channel);
    }
  }

  @SubscribeMessage(PTT_EVENTS.JOIN)
  async handleJoin(@ConnectedSocket() client: Socket, @MessageBody() body: JoinBody) {
    const user = await this.getUser(client);
    if (!user) return this.deny(client, undefined, 'unauthorized');

    const nextChannel = body?.channel ?? null;
    if (nextChannel === null) {
      this.releaseTalker(client);
      client.data.pttHq = false;
      client.data.pttSequenced = false;
      await client.leave(this.accountRoom(user));
      this.leaveLiveKit(client);
      await this.leaveCurrentChannel(client);
      return { ok: true, channel: null };
    }
    if (!this.isChannel(nextChannel)) return this.deny(client, undefined, 'invalid_channel');

    client.data.pttSequenced = body.sequenced === true;
    client.data.pttHq = Array.isArray(body.codecs) && body.codecs.includes('opus-hq');
    const onlineCount = await this.joinChannel(client, user, nextChannel);
    return { ok: true, channel: nextChannel, onlineCount };
  }

  @SubscribeMessage(PTT_EVENTS.LIVEKIT_CONNECT)
  async connectLiveKit(@ConnectedSocket() client: Socket, @MessageBody() body: JoinBody) {
    const config = liveKitRadio();
    if (!config) return { ok: false, reason: 'unavailable' };
    const channel = body?.channel;
    if (!this.isChannel(channel) || client.data.pttChannel !== channel) return { ok: false, reason: 'not_in_channel' };
    const user = await this.hydrateUserFromToken(client);
    if (!user || !client.connected || client.data.pttChannel !== channel) return { ok: false, reason: 'not_in_channel' };
    const channels = channel === 'general' ? [channel] : ['general', channel] as const;
    const credentials = await Promise.all(channels.map(async (name) => ({
      channel: name, token: await radioToken(config, radioRoom(user.cafeId, name), client.id),
    })));
    if (!client.connected || client.data.pttChannel !== channel) return { ok: false, reason: 'not_in_channel' };
    client.data.pttLiveKitChannel = channel;
    client.data.pttLiveKitReady = false;
    return { ok: true, url: config.url, channels: credentials };
  }

  @SubscribeMessage(PTT_EVENTS.LIVEKIT_READY)
  readyLiveKit(@ConnectedSocket() client: Socket, @MessageBody() body: JoinBody & { ready?: boolean }) {
    if (!this.isChannel(body?.channel) || body.channel !== client.data.pttLiveKitChannel
      || body.channel !== client.data.pttChannel) return { ok: false };
    client.data.pttLiveKitReady = body.ready === true;
    const user = this.getCachedUser(client);
    const lock = user && this.locks.get(this.lockKey(user.cafeId, body.channel));
    if (!client.data.pttLiveKitReady && lock?.live?.liveKit) this.releaseTalker(client, body.channel);
    return { ok: true };
  }

  @SubscribeMessage(PTT_EVENTS.LIVEKIT_KEEPALIVE)
  keepLiveKitTalk(@ConnectedSocket() client: Socket, @MessageBody() body: TalkBody) {
    const user = this.getCachedUser(client);
    const channel = body?.channel;
    if (!user || !this.isChannel(channel) || channel !== client.data.pttChannel) return { ok: false };
    const lock = this.locks.get(this.lockKey(user.cafeId, channel));
    if (lock?.socketId !== client.id || !lock.live?.liveKit || lock.live.liveKit.closing
      || lock.live.id !== body.talkId) return { ok: false };
    lock.live.timeout.refresh();
    return { ok: true };
  }

  @SubscribeMessage(PTT_EVENTS.LIVEKIT_TRACK_READY)
  subscribedLiveKit(@ConnectedSocket() client: Socket, @MessageBody() body: TalkBody & { publisher?: string; trackSid?: string }) {
    const user = this.getCachedUser(client);
    if (!user || !this.isChannel(body?.channel) || !this.isTrackSid(body.trackSid)) return { ok: false };
    const lock = this.locks.get(this.lockKey(user.cafeId, body.channel));
    const live = lock?.live?.liveKit;
    if (!live || live.closing || lock.socketId !== body.publisher || !live.listeners.has(client.id)) return { ok: false };
    live.subscribed.set(client.id, body.trackSid);
    return { ok: true };
  }

  @SubscribeMessage(PTT_EVENTS.LIVEKIT_WAIT_TRACK)
  async waitForLiveKitTrack(@ConnectedSocket() client: Socket, @MessageBody() body: TalkBody & { trackSid?: string }) {
    const user = this.getCachedUser(client);
    if (!user || !this.isChannel(body?.channel) || !this.isTrackSid(body.trackSid)) return { ok: false };
    const lock = this.locks.get(this.lockKey(user.cafeId, body.channel));
    const live = lock?.live?.liveKit;
    if (!live || lock.socketId !== client.id || lock.live?.id !== body.talkId) return { ok: false };
    const deadline = Date.now() + 950;
    while (!live.closing && client.connected) {
      if (Array.from(live.listeners).every((listener) => live.subscribed.get(listener) === body.trackSid)) return { ok: true };
      if (Date.now() >= deadline) {
        // A late subscriber may join during the talk. Give the ready listeners a
        // live transmission instead of holding everyone behind that connection.
        return { ok: Array.from(live.subscribed.values()).includes(body.trackSid) };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    return { ok: false };
  }

  private isTrackSid(value: unknown): value is string {
    return typeof value === 'string' && /^TR_[a-zA-Z0-9]+$/.test(value) && value.length <= 64;
  }

  @SubscribeMessage(PTT_EVENTS.START_TALK)
  async handleStartTalk(@ConnectedSocket() client: Socket, @MessageBody() body: TalkBody) {
    const user = await this.getUser(client);
    if (!user) return this.deny(client, body?.channel, 'unauthorized');

    const channel = await this.resolveChannel(client, user, body, body?.codec !== 'livekit');
    if (!channel) return this.deny(client, undefined, 'not_in_channel');

    if (!client.connected) return { ok: false, reason: 'disconnected' };
    const id = body?.talkId;
    if (id !== undefined && (typeof id !== 'string' || !TALK_ID.test(id))) {
      return { ok: false, reason: 'invalid_talk_id' };
    }

    const requestedCodec = body?.codec;
    if (requestedCodec === 'livekit' && id) return this.startLiveKitTalk(client, user, channel, id);
    if (requestedCodec !== undefined && (requestedCodec !== 'opus' || !id)) return { ok: false, reason: 'invalid_codec' };

    const rooms = this.broadcastRooms(user.cafeId, channel);
    let codec: OpusProfile | undefined = requestedCodec;
    if (requestedCodec === 'opus' && body.preferHq === true && await this.canUseHq(client, rooms)) codec = 'opus-hq';
    if (!client.connected || client.data.pttChannel !== channel) return { ok: false, reason: 'disconnected' };

    const key = this.lockKey(user.cafeId, channel);
    const current = this.findBlockingLock(user.cafeId, channel);
    if (current) {
      if (this.locks.get(key) === current && current.socketId === client.id
        && current.live?.id === id && (current.live?.opus ? 'opus' : undefined) === requestedCodec) {
        return { ok: true, channel, talkId: id, codec: current.live?.opus?.profile, sequenced: !!current.live?.stream };
      }
      return this.deny(client, channel, 'busy', current.userId);
    }

    const lock: TalkLock = {
      socketId: client.id, userId: user.id, role: user.role, name: user.name, startedAt: new Date().toISOString(),
    };
    if (id) {
      const timeout = setTimeout(() => {
        client.emit(PTT_EVENTS.TALK_DENIED, { channel, talkId: id, reason: 'audio_timeout' });
        this.releaseTalker(client, channel, id);
      }, LIVE_IDLE_MS);
      timeout.unref();
      const opus = codec ? { profile: codec, header: Buffer.from(id.replaceAll('-', ''), 'hex') } : undefined;
      const frames = (codec ? OPUS_PROFILES[codec].limit : LEGACY_LIMIT).burst;
      const stream = opus && body.sequenced === true && client.data.pttSequenced === true
        ? new PttStreamBuffer(OPUS_PROFILES[opus.profile].frameBytes) : undefined;
      lock.live = { id, opus, stream, frames, lastFrameAt: Date.now(), timeout };
    }
    this.locks.set(key, lock);
    this.server.to(rooms).emit(PTT_EVENTS.CHANNEL_BUSY, this.talker(channel, lock));
    return { ok: true, channel, talkId: id, codec, sequenced: !!lock.live?.stream };
  }

  private async startLiveKitTalk(client: Socket, user: AuthenticatedSocketUser, channel: PttChannel, talkId: string) {
    const config = liveKitRadio();
    if (!config || client.data.pttLiveKitChannel !== channel || client.data.pttLiveKitReady !== true) {
      return { ok: false, reason: 'legacy_required' };
    }
    const rooms = this.broadcastRooms(user.cafeId, channel);
    const audience = await this.radioListeners(rooms);
    const listeners = audience?.filter((socket) => socket.id !== client.id);
    if (!listeners || !listeners.every((socket) => socket.data.pttLiveKitReady === true)) {
      return { ok: false, reason: 'legacy_required' };
    }
    if (!client.connected || client.data.pttChannel !== channel || client.data.pttLiveKitReady !== true) {
      return { ok: false, reason: 'disconnected' };
    }
    const current = this.findBlockingLock(user.cafeId, channel);
    if (current) return this.deny(client, channel, 'busy', current.userId);
    const key = this.lockKey(user.cafeId, channel);
    const timeout = setTimeout(() => {
      client.emit(PTT_EVENTS.TALK_DENIED, { channel, talkId, reason: 'audio_timeout' });
      this.releaseTalker(client, channel, talkId);
    }, LIVEKIT_IDLE_MS);
    timeout.unref();
    const grant = config.rooms.updateParticipant(radioRoom(user.cafeId, channel), client.id, {
      permission: radioPublishPermission(true),
    });
    const lock: TalkLock = {
      socketId: client.id, userId: user.id, role: user.role, name: user.name, startedAt: new Date().toISOString(),
      live: {
        id: talkId, frames: 0, lastFrameAt: 0, timeout,
        liveKit: { grant, closing: false, listeners: new Set(listeners.map((socket) => socket.id)), subscribed: new Map() },
      },
    };
    this.locks.set(key, lock);
    try {
      await grant;
      if (lock.live?.liveKit?.closing || !client.connected || client.data.pttChannel !== channel) {
        this.releaseTalker(client, channel, talkId);
        return { ok: false, reason: 'disconnected' };
      }
      this.server.to(rooms).emit(PTT_EVENTS.CHANNEL_BUSY, this.talker(channel, lock));
      return { ok: true, channel, talkId, codec: 'livekit' };
    } catch {
      // A timed-out request may still have changed permissions on the media server.
      this.releaseTalker(client, channel, talkId);
      return { ok: false, reason: 'media_unavailable' };
    }
  }

  @SubscribeMessage(PTT_EVENTS.AUDIO_FRAME)
  handleAudioFrame(@ConnectedSocket() client: Socket, @MessageBody() body: AudioFrameBody) {
    const user = this.getCachedUser(client);
    const channel = body?.channel;
    if (!user || !this.isChannel(channel) || client.data.pttChannel !== channel) return;
    const lock = this.locks.get(this.lockKey(user.cafeId, channel));
    const live = lock?.live;
    const audio = body?.audio;
    if (!lock || !live || live.opus || live.liveKit || lock.socketId !== client.id || live.id !== body?.talkId
      || !Buffer.isBuffer(audio) || audio.length !== LIVE_FRAME_BYTES) return;
    if (!this.acceptFrames(client, channel, live, 1)) return;
    client.to(this.broadcastRooms(user.cafeId, channel)).except(this.accountRoom(user)).emit(PTT_EVENTS.AUDIO_FRAME, {
      channel, talkId: live.id, audio, senderId: user.id, senderName: user.name, senderRole: user.role,
    });
  }

  @SubscribeMessage(PTT_EVENTS.AUDIO_PACKET)
  handleAudioPacket(@ConnectedSocket() client: Socket, @MessageBody() packet: unknown) {
    const user = this.getCachedUser(client);
    const channel = client.data.pttChannel;
    if (!user || !this.isChannel(channel) || !Buffer.isBuffer(packet)) return;
    const lock = this.locks.get(this.lockKey(user.cafeId, channel));
    const live = lock?.live;
    if (!lock || !live?.opus || live.stream || lock.socketId !== client.id) return;
    const { profile, header } = live.opus;
    const { frameBytes, packetFrames } = OPUS_PROFILES[profile];
    const count = (packet.length - OPUS_HEADER_BYTES) / frameBytes;
    if (!Number.isInteger(count) || count < 1 || count > packetFrames
      || !header.equals(packet.subarray(0, OPUS_HEADER_BYTES))) return;
    if (!this.acceptFrames(client, channel, live, count)) return;
    client.to(this.broadcastRooms(user.cafeId, channel, profile === 'opus-hq')).except(this.accountRoom(user)).emit(PTT_EVENTS.AUDIO_PACKET, packet);
  }

  @SubscribeMessage(PTT_EVENTS.AUDIO_BATCH)
  handleAudioBatch(@ConnectedSocket() client: Socket, @MessageBody() body: AudioBatchBody) {
    const user = this.getCachedUser(client);
    const channel = body?.channel;
    if (!user || !this.isChannel(channel) || channel !== client.data.pttChannel) return;
    const lock = this.locks.get(this.lockKey(user.cafeId, channel));
    const live = lock?.live;
    if (!lock || !live?.stream || !live.opus || lock.socketId !== client.id || live.id !== body.talkId) return;
    const { firstFrame, audio } = body;
    if (!Buffer.isBuffer(audio) || firstFrame !== live.stream.nextFrame) return;
    const { profile } = live.opus;
    const { frameBytes, packetFrames } = OPUS_PROFILES[profile];
    const count = audio.length / frameBytes;
    if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH_FRAMES) return;
    if (!this.acceptFrames(client, channel, live, count)) return;

    live.stream.append(audio);
    const sequencedRooms = this.sequencedRooms(user.cafeId, channel);
    const account = this.accountRoom(user);
    client.to(sequencedRooms).except(account).emit(PTT_EVENTS.AUDIO_BATCH, {
      ...this.streamMetadata(channel, lock), firstFrame, audio,
    });
    // Older releases still speak Opus. Translate the batch back to their original packet format.
    const legacy = client.to(this.broadcastRooms(user.cafeId, channel, profile === 'opus-hq')).except([...sequencedRooms, account]);
    for (let start = 0; start < count; start += packetFrames) {
      const frames = audio.subarray(start * frameBytes, (start + packetFrames) * frameBytes);
      legacy.emit(PTT_EVENTS.AUDIO_PACKET, Buffer.concat([live.opus.header, frames]));
    }
  }

  @SubscribeMessage(PTT_EVENTS.AUDIO_SYNC)
  syncAudio(@ConnectedSocket() client: Socket, @MessageBody() body: TalkBody & { fromFrame?: number }) {
    const user = this.getCachedUser(client);
    const joined = client.data.pttChannel;
    if (!user || !this.isChannel(joined) || client.data.pttSequenced !== true
      || typeof body?.talkId !== 'string' || !TALK_ID.test(body.talkId)
      || typeof body.fromFrame !== 'number' || !Number.isSafeInteger(body.fromFrame) || body.fromFrame < 0) return { ok: false };

    for (const channel of new Set<PttChannel>(['general', joined])) {
      const active = this.locks.get(this.lockKey(user.cafeId, channel));
      if (active?.live?.id === body.talkId) return this.replayFor(user, channel, active, body.fromFrame, false);
    }
    const recent = this.recentStreams.get(this.streamKey(user.cafeId, body.talkId));
    if (!recent || recent.expires <= Date.now()
      || (recent.channel !== 'general' && recent.channel !== joined)) return { ok: false };
    return this.replayFor(user, recent.channel, recent.lock, body.fromFrame, true);
  }

  private replayFor(user: AuthenticatedSocketUser, channel: PttChannel, lock: TalkLock, fromFrame: number, finished: boolean) {
    const stream = lock.live?.stream;
    if (!stream || lock.userId === user.id) return { ok: false };
    const replay = stream.read(fromFrame);
    return {
      ok: true, finished, nextFrame: stream.nextFrame,
      batch: replay ? { ...this.streamMetadata(channel, lock), ...replay } : undefined,
    };
  }

  private streamMetadata(channel: PttChannel, lock: TalkLock) {
    return {
      channel, talkId: lock.live?.id, sequenced: !!lock.live?.stream, codec: lock.live?.opus?.profile,
      senderId: lock.userId, senderName: lock.name, senderRole: lock.role,
    };
  }

  private acceptFrames(client: Socket, channel: PttChannel, live: NonNullable<TalkLock['live']>, count: number) {
    const { burst, perSecond } = live.opus ? OPUS_PROFILES[live.opus.profile].limit : LEGACY_LIMIT;
    const now = Date.now();
    live.frames = Math.min(burst, live.frames + Math.max(0, now - live.lastFrameAt) * perSecond / 1000);
    live.lastFrameAt = now;
    if (live.frames < count) {
      client.emit(PTT_EVENTS.TALK_DENIED, { channel, talkId: live.id, reason: 'audio_backlog' });
      this.releaseTalker(client, channel, live.id);
      return false;
    }
    live.frames -= count;
    live.timeout.refresh();
    return true;
  }

  private talker(channel: PttChannel, lock: TalkLock) {
    return {
      channel, talkId: lock.live?.id, codec: lock.live?.liveKit ? 'livekit' : lock.live?.opus?.profile,
      speaker: { id: lock.userId, role: lock.role, name: lock.name }, startedAt: lock.startedAt,
    };
  }

  private async canUseHq(client: Socket, rooms: string | string[]) {
    const listeners = await this.radioListeners(rooms);
    return !!listeners?.every((socket) => socket.id === client.id || socket.data.pttHq === true);
  }

  private async radioListeners(rooms: string | string[]) {
    let timer: NodeJS.Timeout | undefined;
    try {
      const deadline = new Promise<null>((resolve) => {
        timer = setTimeout(resolve, CAPABILITY_CHECK_TIMEOUT_MS, null);
      });
      return await Promise.race([this.server.in(rooms).fetchSockets(), deadline]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  @SubscribeMessage(PTT_EVENTS.AUDIO_MESSAGE)
  async handleAudioMessage(@ConnectedSocket() client: Socket, @MessageBody() body: AudioMessageBody) {
    const user = await this.getUser(client);
    if (!user) return this.deny(client, body?.channel, 'unauthorized');

    const channel = await this.resolveChannel(client, user, body, false);
    if (!channel) return this.deny(client, undefined, 'not_in_channel');

    const lock = this.locks.get(this.lockKey(user.cafeId, channel));
    if (!lock || lock.socketId !== client.id) {
      return this.deny(client, channel, lock ? 'busy' : 'not_talker', lock?.userId);
    }

    if (lock.live) return { ok: false, reason: 'invalid_audio' };
    const chunk = body?.chunk;
    if (!this.isValidAudio(chunk)) return { ok: false, reason: 'invalid_audio' };

    // Telegram-модель: получили цельный base64-файл. Обычные каналы слышит
    // только своя комната, а канал «Все» транслируется во все PTT-комнаты кафе.
    client.to(this.broadcastRooms(user.cafeId, channel)).except(this.accountRoom(user)).emit(PTT_EVENTS.AUDIO_MESSAGE, {
      channel,
      senderId: user.id,
      senderRole: user.role,
      senderName: user.name,
      mimeType: typeof body.mimeType === 'string' ? body.mimeType.slice(0, 80) : 'application/octet-stream',
      chunk,
      sentAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  @SubscribeMessage(PTT_EVENTS.STOP_TALK)
  async handleStopTalk(@ConnectedSocket() client: Socket, @MessageBody() body: TalkBody) {
    const user = await this.getUser(client);
    const channel = user ? await this.resolveChannel(client, user, body, false) : null;
    if (body?.frames !== undefined) {
      const lock = user && channel && this.locks.get(this.lockKey(user.cafeId, channel));
      if (!lock || lock.socketId !== client.id || lock.live?.id !== body.talkId || !lock.live?.stream
        || body.frames !== lock.live.stream.nextFrame) return { ok: false, reason: 'incomplete_audio' };
    }
    this.releaseTalker(client, channel, body?.talkId ?? null);
    return { ok: true };
  }

  private getCachedUser(client: Socket): AuthenticatedSocketUser | null {
    const user = client.data.user as SocketUser | undefined;
    if (!user?.id || !user.role || !user.cafeId) return null;
    return user as AuthenticatedSocketUser;
  }

  private async resolveChannel(
    client: Socket,
    user: AuthenticatedSocketUser,
    body: TalkBody | undefined,
    autoJoin: boolean,
  ): Promise<PttChannel | null> {
    const bodyChannel = body?.channel;
    const joinedChannel = client.data.pttChannel as PttChannel | undefined;
    if (bodyChannel && this.isChannel(bodyChannel) && bodyChannel === joinedChannel) return bodyChannel;
    if (!bodyChannel && joinedChannel && this.isChannel(joinedChannel)) return joinedChannel;
    if (autoJoin && bodyChannel && this.isChannel(bodyChannel)) {
      await this.joinChannel(client, user, bodyChannel);
      return bodyChannel;
    }
    return null;
  }

  private async joinChannel(
    client: Socket,
    user: AuthenticatedSocketUser,
    nextChannel: PttChannel,
  ): Promise<number> {
    const previous = client.data.pttChannel as PttChannel | undefined;
    if (previous && previous !== nextChannel) {
      this.releaseTalker(client);
      this.leaveLiveKit(client, nextChannel);
      client.data.pttChannel = undefined;
      await this.leaveRooms(client, user.cafeId, previous);
      await this.emitPresenceFor(user.cafeId, previous);
    }

    const room = this.room(user.cafeId, nextChannel);
    const hqRoom = this.room(user.cafeId, nextChannel, true);
    const sequencedRoom = this.sequencedRoom(user.cafeId, nextChannel);
    const rooms = [room, this.accountRoom(user)];
    if (client.data.pttHq === true) rooms.push(hqRoom);
    else await client.leave(hqRoom);
    if (client.data.pttSequenced === true) rooms.push(sequencedRoom);
    else await client.leave(sequencedRoom);
    await client.join(rooms);
    client.data.pttChannel = nextChannel;
    const general = this.locks.get(this.lockKey(user.cafeId, 'general'));
    const active = general ?? this.locks.get(this.lockKey(user.cafeId, nextChannel));
    if (active?.live?.opus || active?.live?.liveKit) {
      client.emit(PTT_EVENTS.CHANNEL_BUSY, this.talker(general ? 'general' : nextChannel, active));
    }
    return this.emitPresenceFor(user.cafeId, nextChannel);
  }

  private async leaveCurrentChannel(client: Socket) {
    const user = this.getCachedUser(client);
    const channel = client.data.pttChannel as PttChannel | undefined;
    if (!user || !channel) return;
    client.data.pttChannel = undefined;
    await this.leaveRooms(client, user.cafeId, channel);
    void this.emitPresence(client, channel);
  }

  private async leaveRooms(client: Socket, cafeId: string, channel: PttChannel) {
    await Promise.all([
      client.leave(this.room(cafeId, channel)),
      client.leave(this.room(cafeId, channel, true)),
      client.leave(this.sequencedRoom(cafeId, channel)),
    ]);
  }

  private leaveLiveKit(client: Socket, nextChannel?: PttChannel) {
    const previous = client.data.pttLiveKitChannel;
    client.data.pttLiveKitChannel = undefined;
    client.data.pttLiveKitReady = false;
    const user = this.getCachedUser(client);
    const config = liveKitRadio();
    if (!user || !config || !this.isChannel(previous)) return;
    const rooms = previous === 'general' ? [previous] : ['general', previous];
    for (const room of rooms) {
      if (nextChannel && (room === 'general' || room === nextChannel)) continue;
      void config.rooms.removeParticipant(radioRoom(user.cafeId, room), client.id).catch(() => undefined);
    }
  }

  private releaseTalker(client: Socket, preferredChannel?: PttChannel | null, expectedTalkId?: string | null) {
    const user = this.getCachedUser(client);
    if (!user) return;
    const channels = preferredChannel ? [preferredChannel] : PTT_CHANNELS;
    for (const channel of channels) {
      const key = this.lockKey(user.cafeId, channel);
      const lock = this.locks.get(key);
      if (!lock || lock.socketId !== client.id) continue;
      if (expectedTalkId !== undefined && (lock.live?.id ?? null) !== expectedTalkId) continue;
      const liveKit = lock.live?.liveKit;
      if (liveKit?.closing) continue;
      if (lock.live) clearTimeout(lock.live.timeout);
      if (liveKit) {
        liveKit.closing = true;
        void this.revokeLiveKitTalk(user, channel, lock).finally(() => this.freeTalk(user, channel, lock));
      } else {
        this.freeTalk(user, channel, lock);
      }
    }
  }

  private async revokeLiveKitTalk(user: AuthenticatedSocketUser, channel: PttChannel, lock: TalkLock) {
    await lock.live?.liveKit?.grant.catch(() => undefined);
    const config = liveKitRadio();
    if (!config) return;
    const room = radioRoom(user.cafeId, channel);
    try {
      await config.rooms.updateParticipant(room, lock.socketId, { permission: radioPublishPermission(false) });
    } catch {
      await config.rooms.removeParticipant(room, lock.socketId).catch(() => undefined);
    }
  }

  private freeTalk(user: AuthenticatedSocketUser, channel: PttChannel, lock: TalkLock) {
    const key = this.lockKey(user.cafeId, channel);
    if (this.locks.get(key) !== lock) return;
    this.locks.delete(key);
    if (lock.live?.stream && lock.live.stream.nextFrame > 0) {
      const now = Date.now();
      for (const [id, recent] of this.recentStreams) {
        if (recent.expires <= now || this.recentStreams.size >= 128) this.recentStreams.delete(id);
      }
      const talkId = this.streamKey(user.cafeId, lock.live.id);
      this.recentStreams.set(talkId, { channel, lock, expires: now + REPLAY_TTL_MS });
      const archived = this.recentStreams.get(talkId);
      setTimeout(() => {
        if (this.recentStreams.get(talkId) === archived) this.recentStreams.delete(talkId);
      }, REPLAY_TTL_MS).unref();
    }
    this.server.to(this.broadcastRooms(user.cafeId, channel)).emit(PTT_EVENTS.CHANNEL_FREE, {
      channel, talkId: lock.live?.id, frames: lock.live?.stream?.nextFrame, speakerId: user.id, freedAt: new Date().toISOString(),
    });
  }

  private async emitPresence(client: Socket, channel: PttChannel): Promise<number> {
    const user = this.getCachedUser(client);
    if (!user) return 0;
    return this.emitPresenceFor(user.cafeId, channel);
  }

  private async emitPresenceFor(cafeId: string, channel: PttChannel): Promise<number> {
    const room = this.room(cafeId, channel);
    const sockets = await this.server.in(room).fetchSockets();
    const uniqueUsers = new Set<string>();
    for (const socket of sockets) {
      const socketUser = socket.data.user as SocketUser | undefined;
      if (socketUser?.id && socketUser.cafeId === cafeId) uniqueUsers.add(socketUser.id);
    }
    const onlineCount = uniqueUsers.size;
    this.server.to(room).emit(PTT_EVENTS.PRESENCE, { channel, onlineCount });
    return onlineCount;
  }

  private async hydrateUserFromToken(client: Socket): Promise<AuthenticatedSocketUser | null> {
    const token =
      (client.handshake.auth?.token as string) ||
      (client.handshake.headers?.authorization as string | undefined)?.replace('Bearer ', '');
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: string }>(token, {
        secret: getJwtAccessSecret(),
      });
      const dbUser = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, name: true, cafeId: true, isActive: true },
      });
      if (!dbUser?.isActive || !dbUser.cafeId) return null;
      await assertCafeActive(this.prisma, dbUser.cafeId);
      const user: AuthenticatedSocketUser = {
        id: dbUser.id,
        role: dbUser.role,
        name: dbUser.name,
        cafeId: dbUser.cafeId,
      };
      client.data.user = user;
      return user;
    } catch {
      return null;
    }
  }

  private async getUser(client: Socket): Promise<AuthenticatedSocketUser | null> {
    const cached = this.getCachedUser(client);
    if (cached) return cached;
    return this.hydrateUserFromToken(client);
  }

  private deny(client: Socket, channel: PttChannel | undefined, reason: string, speakerId?: string) {
    client.emit(PTT_EVENTS.TALK_DENIED, { channel, reason, speakerId });
    if (reason !== 'busy') {
      this.logger.warn(`PTT denied ${client.id}: ${reason}`);
    }
    return { ok: false, reason, speakerId };
  }

  private isChannel(value: unknown): value is PttChannel {
    return typeof value === 'string' && PTT_CHANNELS.includes(value as PttChannel);
  }

  private isValidAudio(chunk: unknown): chunk is string {
    return (
      typeof chunk === 'string' &&
      chunk.length > 0 &&
      chunk.length <= MAX_AUDIO_CHARS &&
      BASE64_RE.test(chunk)
    );
  }

  private findBlockingLock(cafeId: string, channel: PttChannel): TalkLock | undefined {
    if (channel === 'general') {
      for (const candidate of PTT_CHANNELS) {
        const lock = this.locks.get(this.lockKey(cafeId, candidate));
        if (lock) return lock;
      }
      return undefined;
    }
    return this.locks.get(this.lockKey(cafeId, 'general')) ?? this.locks.get(this.lockKey(cafeId, channel));
  }

  private broadcastRooms(cafeId: string, channel: PttChannel, hq = false) {
    return channel === 'general'
      ? PTT_CHANNELS.map((candidate) => this.room(cafeId, candidate, hq))
      : this.room(cafeId, channel, hq);
  }

  private room(cafeId: string, channel: PttChannel, hq = false) {
    return `restaurant_${cafeId}_${channel}${hq ? ':opus-hq' : ''}`;
  }

  private streamKey(cafeId: string, talkId: string) { return cafeId + ':' + talkId; }

  private accountRoom(user: AuthenticatedSocketUser) {
    return `ptt:account:${user.cafeId}:${user.id}`;
  }

  private sequencedRooms(cafeId: string, channel: PttChannel) {
    const channels = channel === 'general' ? PTT_CHANNELS : [channel];
    return channels.map((name) => this.sequencedRoom(cafeId, name));
  }

  private sequencedRoom(cafeId: string, channel: PttChannel) {
    return `ptt:sequenced:${cafeId}:${channel}`;
  }

  private lockKey(cafeId: string, channel: PttChannel) {
    return `${cafeId}:${channel}`;
  }
}
