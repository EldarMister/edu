export const PTT_CHANNELS = [
  { key: 'general', label: 'Все' },
  { key: 'waiters', label: 'Официанты' },
  { key: 'kitchen', label: 'Кухня' },
  { key: 'admin', label: 'Администрация' },
] as const;

export type PttChannel = (typeof PTT_CHANNELS)[number]['key'];
export type PttOpusCodec = 'opus' | 'opus-hq';

export type PttAudioPayload = {
  channel: PttChannel;
  senderId: string;
  senderRole?: string;
  senderName?: string;
  mimeType: string;
  chunk: string;
  sentAt?: string;
};

export type PttFramePayload = {
  channel: PttChannel;
  talkId: string;
  senderId: string;
  senderName?: string;
  senderRole?: string;
  audio: ArrayBuffer;
};

export type PttDeniedPayload = {
  talkId?: string;
  channel?: PttChannel;
  reason: string;
  speakerId?: string;
};

export type PttPresencePayload = {
  channel: PttChannel;
  onlineCount: number;
};

export type PttBusyPayload = {
  talkId?: string;
  codec?: PttOpusCodec;
  channel: PttChannel;
  speaker?: { id: string; role: string; name?: string };
  startedAt?: string;
};

export type RadioState = 'ready' | 'speakingSelf' | 'speakingOther' | 'error';

export type PttFreePayload = {
  talkId?: string;
  channel: PttChannel;
  speakerId?: string;
  freedAt?: string;
};

export const PTT_EVENTS = {
  JOIN: 'ptt_join',
  START_TALK: 'ptt_start_talk',
  STOP_TALK: 'ptt_stop_talk',
  CHANNEL_BUSY: 'ptt_channel_busy',
  CHANNEL_FREE: 'ptt_channel_free',
  AUDIO_MESSAGE: 'ptt_audio_message',
  AUDIO_FRAME: 'ptt_audio_frame',
  AUDIO_PACKET: 'ptt_audio_packet',
  TALK_DENIED: 'ptt_talk_denied',
  PRESENCE: 'ptt_presence',
} as const;
