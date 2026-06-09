type OrientationLockType = 'portrait' | 'landscape';

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: OrientationLockType) => Promise<void>;
  unlock?: () => void;
};

class OrientationService {
  async lock(type: OrientationLockType) {
    const orientation = this.getOrientation();
    if (!orientation?.lock) return;

    try {
      await orientation.lock(type);
    } catch {
      // Some browsers only allow orientation lock in installed PWA/fullscreen mode.
    }
  }

  unlock() {
    const orientation = this.getOrientation();
    if (!orientation?.unlock) return;

    try {
      orientation.unlock();
    } catch {
      // Ignore unsupported unlocks for the same reason as lock().
    }
  }

  private getOrientation(): LockableScreenOrientation | null {
    if (typeof screen === 'undefined' || !screen.orientation) return null;
    return screen.orientation as LockableScreenOrientation;
  }
}

export const orientationService = new OrientationService();
export default orientationService;
