import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { Buffer } from 'buffer';
import { pcmFloats } from './opusAudio';

type Microphone = {
  start(id: string): Promise<void>;
  stop(id: string): void;
  addListener(event: string): void;
  removeListeners(count: number): void;
};

let sequence = 0;

export function startAndroidPttInput(onSamples: (samples: Float32Array) => void, onError: () => void) {
  const microphone = NativeModules.EduPttMicrophone as Microphone | undefined;
  if (Platform.OS !== 'android' || !microphone) return undefined;
  const id = String(++sequence);
  const events = new NativeEventEmitter(microphone);
  let stopping: Promise<boolean> | undefined;
  let finish = (_complete: boolean) => {};
  const done = new Promise<boolean>((resolve) => { finish = resolve; });
  const onPcm = events.addListener('EduPttPcm', (event: { id: string; samples: string }) => {
    if (event.id === id) onSamples(pcmFloats(Buffer.from(event.samples, 'base64')));
  });
  const onEnd = events.addListener('EduPttInputFinished', (event: { id: string; complete: boolean }) => {
    if (event.id !== id) return;
    finish(event.complete);
    detach();
    if (!stopping && !event.complete) onError();
  });
  function detach() {
    onPcm.remove();
    onEnd.remove();
  }
  const ready = microphone.start(id).catch((error) => {
    finish(false);
    detach();
    throw error;
  });
  return {
    ready,
    stop() {
      stopping ??= (async () => {
        const timer = setTimeout(() => finish(false), 450);
        try {
          await ready.then(() => microphone.stop(id), () => undefined);
          return await done;
        } finally {
          clearTimeout(timer);
          detach();
        }
      })();
      return stopping;
    },
  };
}
