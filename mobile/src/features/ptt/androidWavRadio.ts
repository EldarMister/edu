import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { PTT_CODEC_CAPABILITIES } from './opusAudio';
import type { PttChannel } from './types';

type CaptureModule = {
  start(token: number): Promise<boolean>;
  take(token: number): string | null;
  finish(token: number): string[];
  addListener(event: 'onChunkReady' | 'onCaptureEnded', listener: (payload: { token: number }) => void): { remove(): void };
};
type PlaybackModule = {
  begin(session: string): void;
  enqueue(session: string, packet: string): Promise<boolean>;
  remaining(session: string): number;
  stop(session: string): void;
};

export const wavCapture = Platform.OS === 'android' ? requireOptionalNativeModule<CaptureModule>('EduRadioCapture') : null;
export const wavPlayback = Platform.OS === 'android' ? requireOptionalNativeModule<PlaybackModule>('EduRadioPlayback') : null;

export function radioJoinOptions(channel: PttChannel) {
  return { channel, codecs: PTT_CODEC_CAPABILITIES, sequenced: true, nativeWav: !!wavCapture && !!wavPlayback };
}
