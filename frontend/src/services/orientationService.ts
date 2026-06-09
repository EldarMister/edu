/**
 * OrientationService — управляет блокировкой ориентации экрана.
 *
 * Принцип работы:
 *  - screen.orientation.lock() работает только в установленном PWA (standalone/fullscreen).
 *  - В браузерной вкладке вызов бросает ошибку — она подавляется,
 *    и в роли fallback выступает "orientation": "any" из манифеста (= следует системному автоповороту).
 *
 * Портретные экраны (официант, администратор, владелец):
 *  - Блокируются в portrait-primary — экран не поворачивается НИКОГДА,
 *    даже если системный автоповорот включён.
 *
 * Экран кухни:
 *  - Блокируется в 'landscape' (не 'landscape-primary'!).
 *  - Значение 'landscape' разрешает ОБЕ альбомные ориентации:
 *    landscape-primary и landscape-secondary.
 *  - Если автоповорот включён → экран свободно вращается между двумя
 *    альбомными позициями.
 *  - Если автоповорот выключен → экран остаётся в текущей альбомной
 *    позиции (не возвращается в портрет).
 *  - Определять состояние автоповорота вручную не нужно — API делает
 *    это сам через значение 'landscape'.
 */

// Расширяем стандартный тип: в некоторых браузерах lock/unlock опциональны
type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: OrientationLockType) => Promise<void>;
  unlock?: () => void;
};

type OrientationLockType =
  | 'any'
  | 'natural'
  | 'landscape'
  | 'portrait'
  | 'portrait-primary'
  | 'portrait-secondary'
  | 'landscape-primary'
  | 'landscape-secondary';

class OrientationService {
  /**
   * Портретные экраны: официант, администратор, владелец.
   * portrait-primary — строго «нормальный» портрет (не перевёрнутый).
   * Переопределяет системный автоповорот в PWA режиме.
   */
  async lockPortrait(): Promise<void> {
    await this.applyLock('portrait-primary');
  }

  /**
   * Экран кухни.
   * 'landscape' — разрешает landscape-primary И landscape-secondary.
   * При включённом автоповороте: экран свободно вращается между ними.
   * При выключённом автоповороте: удерживает текущую альбомную позицию.
   */
  async lockLandscape(): Promise<void> {
    await this.applyLock('landscape');
  }

  /**
   * Снять блокировку при размонтировании компонента.
   */
  unlock(): void {
    const orientation = this.getOrientation();
    if (!orientation?.unlock) return;
    try {
      orientation.unlock();
    } catch {
      // Подавляем: на iOS и в браузерных вкладках unlock тоже не поддерживается
    }
  }

  private async applyLock(type: OrientationLockType): Promise<void> {
    const orientation = this.getOrientation();
    if (!orientation?.lock) return;

    try {
      await orientation.lock(type);
    } catch {
      // screen.orientation.lock() бросает SecurityError / NotSupportedError
      // в браузерных вкладках и на iOS — это нормально, подавляем.
    }
  }

  private getOrientation(): LockableScreenOrientation | null {
    if (typeof screen === 'undefined' || !screen.orientation) return null;
    return screen.orientation as LockableScreenOrientation;
  }
}

export const orientationService = new OrientationService();
export default orientationService;
