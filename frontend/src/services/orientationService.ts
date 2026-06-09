// Specific orientation lock types are more reliably supported in PWA mode
// than the generic 'portrait' / 'landscape' values.
type OrientationLockType =
  | 'portrait-primary'
  | 'landscape-primary'
  | 'portrait'
  | 'landscape';

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: OrientationLockType) => Promise<void>;
  unlock?: () => void;
};

class OrientationService {
  async lock(type: 'portrait' | 'landscape') {
    const orientation = this.getOrientation();
    if (!orientation?.lock) return;

    // Use the specific primary variant for better PWA support
    const lockType: OrientationLockType =
      type === 'portrait' ? 'portrait-primary' : 'landscape-primary';

    try {
      await orientation.lock(lockType);
    } catch {
      // Some browsers only allow orientation lock in installed PWA/fullscreen mode.
      // Silently ignore — the manifest orientation will serve as the fallback.
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
