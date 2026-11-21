import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';

export function liveKitRadio() {
  if (process.env.PTT_LIVEKIT_ENABLED !== 'true') return null;
  const url = process.env.PTT_LIVEKIT_URL?.trim();
  const key = process.env.PTT_LIVEKIT_API_KEY?.trim();
  const secret = process.env.PTT_LIVEKIT_API_SECRET?.trim();
  if (!url || !key || !secret) return null;
  try {
    const endpoint = new URL(url);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'wss:' && !(local && endpoint.protocol === 'ws:' && process.env.NODE_ENV !== 'production')) {
      return null;
    }
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
    const api = new URL(endpoint);
    api.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
    return { url: endpoint.toString(), key, secret, rooms: new RoomServiceClient(api.toString(), key, secret, { requestTimeout: 2 }) };
  } catch {
    return null;
  }
}

export function radioRoom(cafeId: string, channel: string) {
  return `edu-pos:ptt:${cafeId}:${channel}`;
}

export async function radioToken(config: NonNullable<ReturnType<typeof liveKitRadio>>, room: string, socketId: string) {
  const token = new AccessToken(config.key, config.secret, { identity: socketId, ttl: '90s' });
  token.addGrant({ roomJoin: true, room, canSubscribe: true, canPublish: false, canPublishData: false });
  return token.toJwt();
}

export function radioPublishPermission(canPublish: boolean) {
  return { canSubscribe: true, canPublish, canPublishData: false, canPublishSources: [TrackSource.MICROPHONE] };
}
