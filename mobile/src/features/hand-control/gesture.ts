export type Landmark = { x: number; y: number; z?: number };
export type HandSample = { landmarks: Landmark[]; confidence: number; aspect: number };
export type Point = { x: number; y: number };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Distances are measured in image pixels and normalized by palm size, never by camera distance. */
export function handMetrics(sample: HandSample | null): { point: Point; pinch: number } | null {
  if (!sample || !Number.isFinite(sample.confidence) || sample.confidence < 0.7 || !Number.isFinite(sample.aspect) || sample.aspect <= 0 || !Array.isArray(sample.landmarks) || sample.landmarks.length !== 21) return null;
  const p = sample.landmarks;
  if (p.some((v) => !v || !Number.isFinite(v.x) || !Number.isFinite(v.y))) return null;
  const distance = (a: Landmark, b: Landmark) => Math.hypot((a.x - b.x) * sample.aspect, a.y - b.y);
  const palm = Math.max(distance(p[0], p[9]), distance(p[5], p[17]));
  if (palm < 0.035 || p[8].x < 0 || p[8].x > 1 || p[8].y < 0 || p[8].y > 1) return null;
  // The browser supplies upright decoded video in either tablet orientation. Mirror the front camera.
  // A modest inset lets a cook reach viewport edges without moving their hand out of the camera.
  return {
    point: { x: clamp((1 - p[8].x - 0.1) / 0.8, 0, 1), y: clamp((p[8].y - 0.1) / 0.8, 0, 1) },
    pinch: distance(p[4], p[8]) / palm,
  };
}

/** A complete open → closed → open gesture emits one click, on the target captured at closing. */
export class PinchGesture<T> {
  private state: 'unarmed' | 'open' | 'closing' | 'closed' | 'releasing' = 'unarmed';
  private since = 0;
  private lastSample = -Infinity;
  private lastClick = -Infinity;
  private openSince: number | null = null;
  private target: T | null = null;

  reset() {
    this.state = 'unarmed';
    this.openSince = null;
    this.target = null;
    this.lastSample = -Infinity;
  }

  get locked() { return this.state === 'closing' || this.state === 'closed' || this.state === 'releasing'; }
  get lockedTarget() { return this.locked ? this.target : null; }

  willLock(pinch: number, now: number, sensitivity = 1) {
    return this.state === 'open' && now - this.lastSample <= 450
      && now - this.lastClick >= 450 && pinch <= 0.24 * clamp(sensitivity, 0.75, 1.3);
  }

  update(pinch: number | null, now: number, hover: T | null, sensitivity = 1): T | null {
    if (pinch === null || !Number.isFinite(pinch)) { this.reset(); return null; }
    // A stalled camera/worker is equivalent to losing the hand; never finish an old gesture.
    if (now - this.lastSample > 450) this.reset();
    this.lastSample = now;
    const close = 0.24 * clamp(sensitivity, 0.75, 1.3);
    const release = close + 0.18;
    if (this.state === 'unarmed') {
      if (pinch >= release) {
        this.openSince ??= now;
        if (now - this.openSince >= 160) this.state = 'open';
      } else this.openSince = null;
      return null;
    }
    if (this.state === 'open') {
      if (this.willLock(pinch, now, sensitivity)) {
        this.target = hover;
        this.since = now;
        this.state = 'closing';
      }
      return null;
    }
    if (this.state === 'closing') {
      if (pinch >= release) { this.state = 'open'; this.target = null; }
      else if (pinch <= close && now - this.since >= 60) this.state = 'closed';
      return null;
    }
    if (this.state === 'closed') {
      if (pinch >= release) { this.since = now; this.state = 'releasing'; }
      return null;
    }
    if (pinch <= close) { this.state = 'closed'; return null; }
    if (pinch >= release && now - this.since >= 60) {
      const target = this.target;
      this.lastClick = now;
      this.state = 'open';
      this.target = null;
      return target;
    }
    return null;
  }
}

export function recognitionInterval(found: boolean, inferenceMs: number) {
  return found ? Math.max(80, Math.min(400, inferenceMs * 1.5)) : Math.max(400, inferenceMs * 1.5);
}
