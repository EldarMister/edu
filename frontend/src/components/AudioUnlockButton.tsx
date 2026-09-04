import { useSyncExternalStore } from 'react';
import { audioNeedsGesture, subscribeAudioStatus, unlockAudio } from '@/lib/audio';

export function AudioUnlockButton() {
  const needsGesture = useSyncExternalStore(subscribeAudioStatus, audioNeedsGesture);
  if (!needsGesture) return null;
  return (
    <div className="fixed bottom-28 left-1/2 z-[120] -translate-x-1/2" role="status">
      <button type="button" className="btn-primary btn-md whitespace-nowrap shadow-lg" onClick={unlockAudio}>
        Включить звук
      </button>
    </div>
  );
}
