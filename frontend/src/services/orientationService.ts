/**
 * OrientationService — управление ориентацией экрана в PWA.
 *
 * Стратегия:
 *  - Манифест задаёт "orientation": "portrait" → ОС блокирует портрет системно.
 *    Это надёжная защита для официанта, администратора и владельца.
 *  - JS API screen.orientation.lock() используется для КУХНИ, чтобы переключить
 *    на landscape поверх системного portrait из манифеста.
 *  - Для портретных экранов JS API используется как дополнительный слой поверх манифеста.
 *  - Если API недоступен (iOS, браузерная вкладка) — молча игнорируем,
 *    манифест остаётся единственной защитой.
 */

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
};

class OrientationService {
  /**
   * Портретные экраны (официант, администратор, владелец).
   * Манифест уже держит portrait — JS API как дополнительный слой.
   */
  async lockPortrait(): Promise<void> {
    // Пробуем конкретное значение, потом общее
    await this.tryLock(['portrait-primary', 'portrait']);
  }

  /**
   * Экран кухни.
   * Перекрывает portrait из манифеста → переключает в landscape.
   * 'landscape' разрешает оба направления (primary + secondary),
   * что правильно при включённом автоповороте.
   */
  async lockLandscape(): Promise<void> {
    await this.tryLock(['landscape', 'landscape-primary']);
  }

  unlock(): void {
    const orientation = this.getOrientation();
    if (!orientation?.unlock) return;
    try {
      orientation.unlock();
    } catch {
      /* игнорируем */
    }
  }

  /**
   * Перебирает список типов ориентации и применяет первый успешный.
   * Это нужно потому что разные браузеры поддерживают разные значения.
   */
  private async tryLock(types: string[]): Promise<void> {
    const orientation = this.getOrientation();
    if (!orientation?.lock) return;

    for (const type of types) {
      try {
        await orientation.lock(type);
        return; // успешно — выходим
      } catch {
        // этот тип не поддерживается — пробуем следующий
      }
    }
    // Все попытки провалились — API недоступен в этом браузере/режиме
  }

  private getOrientation(): LockableScreenOrientation | null {
    if (typeof screen === 'undefined' || !screen.orientation) return null;
    return screen.orientation as LockableScreenOrientation;
  }
}

export const orientationService = new OrientationService();
export default orientationService;
