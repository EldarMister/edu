export const PTT_CHANNELS = [
  { key: 'general', label: 'Все' },
  { key: 'waiters', label: 'Официанты' },
  { key: 'kitchen', label: 'Кухня' },
  { key: 'admin', label: 'Администрация' },
] as const;

export type PttChannel = (typeof PTT_CHANNELS)[number]['key'];

export type PttAudioPayload = {
  channel: PttChannel;
  senderId: string;
  senderRole?: string;
  mimeType: string;
  seq?: number;
  chunk: string;
  sentAt?: string;
};

export type PttDeniedPayload = {
  channel?: PttChannel;
  reason: string;
  speakerId?: string;
};

export type PttPresencePayload = {
  channel: PttChannel;
  onlineCount: number;
};

export type PttBusyPayload = {
  channel: PttChannel;
  speaker?: { id: string; role: string };
  startedAt?: string;
};

export type PttFreePayload = {
  channel: PttChannel;
  speakerId?: string;
  freedAt?: string;
};

export const PTT_EVENTS = {
  JOIN: 'ptt_join',
  START_TALK: 'ptt_start_talk',
  CHUNK: 'ptt_chunk',
  STOP_TALK: 'ptt_stop_talk',
  CHANNEL_BUSY: 'ptt_channel_busy',
  CHANNEL_FREE: 'ptt_channel_free',
  AUDIO_STREAM: 'ptt_audio_stream',
  TALK_DENIED: 'ptt_talk_denied',
  PRESENCE: 'ptt_presence',
} as const;
