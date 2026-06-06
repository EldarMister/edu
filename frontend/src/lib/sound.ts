// Короткий звуковой сигнал. Если есть файл в public/sounds, используем его.
let ctx: AudioContext | null = null;

type SoundKind = 'notify' | 'newOrder' | 'payment';

export function beep(kind: SoundKind = 'notify') {
  const file =
    kind === 'newOrder'
      ? '/sounds/new-order.mp3'
      : kind === 'payment'
        ? '/sounds/payment%20sound.mp3'
        : '/sounds/notify.mp3';
  const audio = new Audio(file);
  audio.play().catch(() => playGeneratedBeep(kind));
}

function playGeneratedBeep(kind: SoundKind = 'notify') {
  try {
    ctx = ctx ?? new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.value = kind === 'newOrder' ? 880 : kind === 'payment' ? 740 : 660;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.start();
    o.stop(ctx.currentTime + 0.36);
    if (kind === 'newOrder' || kind === 'payment') {
      // второй тон для заметности на кухне
      const o2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      o2.connect(g2);
      g2.connect(ctx.destination);
      o2.type = 'sine';
      o2.frequency.value = kind === 'payment' ? 988 : 1100;
      g2.gain.setValueAtTime(0.0001, ctx.currentTime + 0.2);
      g2.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.22);
      g2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);
      o2.start(ctx.currentTime + 0.2);
      o2.stop(ctx.currentTime + 0.56);
    }
  } catch {
    /* звук не критичен */
  }
}
