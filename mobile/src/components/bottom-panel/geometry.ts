export const PANEL_DURATION = 300;
export const STEP_DURATION = 220;

export function resistPanelOffset(offset: number, travel: number) {
  'worklet';
  const edge = Math.max(0, Math.min(travel, offset));
  const overshoot = offset - edge;
  return edge + overshoot * travel * 0.55 / (travel + 0.55 * Math.abs(overshoot));
}

export function panelDragOrigin(offset: number, travel: number) {
  'worklet';
  const edge = Math.max(0, Math.min(travel, offset));
  const overshoot = offset - edge;
  // Undo resistance when picking up an already stretched panel.
  return edge + overshoot * travel / (0.55 * Math.max(1, travel - Math.abs(overshoot)));
}

export function shouldDismissPanel(offset: number, velocity: number, travel: number, displacement = offset) {
  'worklet';
  const flickSpeed = 850;
  return (offset > Math.min(160, travel * 0.24) && velocity > -flickSpeed)
    || (displacement > 12 && velocity > flickSpeed);
}

export function remainingKeyboardOverlap(containerY: number, containerHeight: number, keyboardY: number) {
  return Math.max(0, containerY + containerHeight - keyboardY);
}

/** Lifecycle token invalidates animation completions after reopen/unmount. */
export class PanelCompletion {
  private version = 0;
  private closing = false;
  private mounted = true;
  open() { this.mounted = true; this.closing = false; return ++this.version; }
  close() { if (!this.mounted || this.closing) return null; this.closing = true; return ++this.version; }
  finish(version: number) {
    if (!this.mounted || !this.closing || version !== this.version) return false;
    this.closing = false; this.version++; return true;
  }
  invalidate() { this.mounted = false; this.closing = false; this.version++; }
}
