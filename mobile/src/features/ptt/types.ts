import type { OpusMode } from './opusAudio';

export const PTT_CHANNELS = [
  { key: 'general', label: 'Все' },
  { key: 'waiters', label: 'Официанты' },
  { key: 'kitchen', label: 'Кухня' },
  { key: 'admin', label: 'Администрация' },
] as const;

export type PttChannel = (typeof PTT_CHANNELS)[number]['key'];
export type PttOpusCodec = OpusMode;

export const PTT_CHANNEL_STORAGE_KEY = 'edu-pos:ptt-channel';

export type PttAudioPayload = {
  channel: PttChannel;
  senderId: string;
  senderRole?: string;
  senderName?: string;
  mimeType: string;
  chunk: string;
  sentAt?: string;
};

export type PttDeniedPayload = {
  channel?: PttChannel;
  talkId?: string;
  reason: string;
  speakerId?: string;
};

export type PttPresencePayload = {
  channel: PttChannel;
  onlineCount: number;
};

export type PttBusyPayload = {
  sequenced?: boolean;
  channel: PttChannel;
  talkId?: string;
  codec?: OpusMode;
  speaker?: { id: string; role: string; name?: string };
  startedAt?: string;
};

export type PttBatchPayload = {
  channel: PttChannel;
  talkId: string;
  codec: PttOpusCodec;
  senderId: string;
  senderName?: string;
  senderRole?: string;
  firstFrame: number;
  audio: unknown;
};

export type RadioState = 'ready' | 'speakingSelf' | 'speakingOther' | 'error';

export type PttFreePayload = {
  frames?: number;
  channel: PttChannel;
  talkId?: string;
  speakerId?: string;
  freedAt?: string;
};

export type PttFramePayload = Omit<PttAudioPayload, 'chunk' | 'mimeType'> & {
  talkId: string;
  audio: unknown;
};

export const PTT_EVENTS = {
  JOIN: 'ptt_join',
  START_TALK: 'ptt_start_talk',
  STOP_TALK: 'ptt_stop_talk',
  CHANNEL_BUSY: 'ptt_channel_busy',
  CHANNEL_FREE: 'ptt_channel_free',
  AUDIO_MESSAGE: 'ptt_audio_message',
  NATIVE_CHUNK: 'ptt_chunk',
  NATIVE_STREAM: 'ptt_audio_stream',
  AUDIO_PACKET: 'ptt_audio_packet',
  AUDIO_BATCH: 'ptt_audio_batch',
  AUDIO_SYNC: 'ptt_audio_sync',
  AUDIO_FRAME: 'ptt_audio_frame',
  TALK_DENIED: 'ptt_talk_denied',
  PRESENCE: 'ptt_presence',
} as const;
