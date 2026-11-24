import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { SheetHandle } from '@/components/SheetHandle';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import { usePermissions } from '@/hooks/usePermissions';
import { useAudioPttReceiver } from './useAudioPttReceiver';
import { useAudioPttSender } from './useAudioPttSender';
import { preparePttCapture } from './liveAudio';
import {
  PTT_CHANNELS,
  PTT_EVENTS,
  type PttBusyPayload,
  type PttChannel,
  type PttFreePayload,
  type PttPresencePayload,
  type RadioState,
} from './types';

const CHANNEL_STORAGE_KEY = 'edu-pos:ptt-channel';
const POSITION_STORAGE_KEY = 'edu-pos:ptt-button-position';

// Fractions of the available travel. Only the drag preview can sit between the two edges.
type LauncherPosition = { x: number; y: number };
type DockPosition = LauncherPosition & { x: 0 | 1 };

function nearestDock({ x, y }: LauncherPosition): DockPosition {
  return { x: x < 0.5 ? 0 : 1, y };
}

function readLauncherPosition(): DockPosition | null {
  try {
    const position = JSON.parse(localStorage.getItem(POSITION_STORAGE_KEY) ?? 'null');
    if (position && [position.x, position.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      return nearestDock(position);
    }
  } catch {
    // Storage can be unavailable or have invalid data.
  }
  return null;
}

function defaultChannelForRole(role?: string): PttChannel {
  if (role === 'WAITER') return 'waiters';
  if (role === 'KITCHEN' || role === 'BAR') return 'kitchen';
  if (role === 'ADMIN' || role === 'OWNER') return 'admin';
  return 'general';
}

function isPttChannel(value: unknown): value is PttChannel {
  return PTT_CHANNELS.some((item) => item.key === value);
}

function initialChannel(role?: string): PttChannel {
  try {
    const stored = localStorage.getItem(CHANNEL_STORAGE_KEY);
    if (isPttChannel(stored)) return stored;
  } catch {
    /* private mode */
  }
  return defaultChannelForRole(role);
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

function hasBlockingOverlay() {
  const overlays = document.querySelectorAll('.modal-backdrop, [role="dialog"], [data-radio-blocking]');
  return Array.from(overlays).some((overlay) =>
    !overlay.closest('[aria-hidden="true"]') && overlay.getClientRects().length > 0,
  );
}

function useBlockingOverlayOpen() {
  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => {
    const sync = () => setOverlayOpen(hasBlockingOverlay());
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributeFilter: ['aria-hidden'],
    });
    window.addEventListener('resize', sync);
    sync();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, []);

  return overlayOpen;
}

function useSocketConnected() {
  const [connected, setConnected] = useState(() => getSocket().connected);

  useEffect(() => {
    const sock = getSocket();
    const sync = () => setConnected(sock.connected);
    sock.on('connect', sync);
    sock.on('disconnect', sync);
    sync();
    return () => {
      sock.off('connect', sync);
      sock.off('disconnect', sync);
    };
  }, []);

  return connected;
}

function RadioIcon({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/рация.png"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: 'contain' }}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

function CloseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const STATE_STYLES: Record<
  RadioState,
  {
    circle: string;
    ring: string;
    label: string;
  }
> = {
  ready: {
    circle: 'bg-primary',
    ring: 'border-primary/25',
    label: 'border-primary/35 text-primary',
  },
  speakingSelf: {
    circle: 'bg-success',
    ring: 'border-success/25',
    label: 'border-success/40 text-success',
  },
  speakingOther: {
    circle: 'bg-warning',
    ring: 'border-warning/30',
    label: 'border-warning/40 text-warning',
  },
  error: {
    circle: 'bg-danger',
    ring: 'border-danger/30',
    label: 'border-danger/40 text-danger',
  },
};

function RadioHeader({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-text-primary">Рация</h2>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-background"
          onClick={onClose}
          aria-label="Закрыть"
        >
          <CloseIcon />
        </button>
      </div>
    </>
  );
}

function RadioChannelTabs({
  channel,
  onChange,
}: {
  channel: PttChannel;
  onChange: (next: PttChannel) => void;
}) {
  return (
    <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
      {PTT_CHANNELS.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onChange(item.key)}
          className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
            item.key === channel
              ? 'border-primary bg-primary text-white'
              : 'border-border bg-white text-text-secondary hover:bg-background'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function RadioMetaRow({ onlineCount }: { onlineCount: number }) {
  return (
    <div className="mb-3 flex justify-end">
      <span className="flex items-center gap-1.5 text-sm text-text-muted">
        <span className="h-2 w-2 rounded-full bg-success" />
        {onlineCount} онлайн
      </span>
    </div>
  );
}

function PushToTalkCircle({
  state,
  disabled,
  size,
  onPressStart,
  onPressStop,
}: {
  state: RadioState;
  disabled: boolean;
  size: number;
  onPressStart: (event: PointerEvent<HTMLButtonElement>) => void;
  onPressStop: () => void;
}) {
  const view = STATE_STYLES[state];
  const rippleCount = state === 'speakingSelf' ? 3 : state === 'speakingOther' ? 1 : 0;
  return (
    <div className="relative flex items-center justify-center py-2" style={{ minHeight: size + 30 }}>
      {Array.from({ length: rippleCount }).map((_, index) => (
        <span
          key={index}
          className={`pointer-events-none absolute rounded-full border ${view.ring} ${
            state === 'speakingSelf' ? 'animate-ptt-ripple' : 'animate-ptt-soft-pulse'
          }`}
          style={{
            width: size + 22 + index * 22,
            height: size + 22 + index * 22,
            animationDelay: `${index * 220}ms`,
          }}
        />
      ))}
      <button
        type="button"
        disabled={disabled}
        onPointerDown={onPressStart}
        onPointerUp={onPressStop}
        onPointerCancel={onPressStop}
        onLostPointerCapture={onPressStop}
        onContextMenu={(event) => event.preventDefault()}
        aria-label="Нажмите и удерживайте, чтобы говорить"
        className={`ptt-no-select relative flex touch-none select-none items-center justify-center rounded-full text-white transition-all duration-200 disabled:cursor-not-allowed ${view.circle} ${
          state === 'speakingSelf' ? 'scale-[1.12]' : ''
        } ${state === 'error' ? 'animate-ptt-shake' : ''}`}
        style={{ width: size, height: size }}
      >
        <RadioIcon size={Math.round(size * 0.42)} />
      </button>
    </div>
  );
}

function RadioStatusText({
  state,
  title,
  hint,
  hintDanger = false,
}: {
  state: RadioState;
  title: string;
  hint: string;
  hintDanger?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 pb-1">
      <span className={`rounded-full border bg-white px-4 py-1 text-sm font-semibold ${STATE_STYLES[state].label}`}>
        {title}
      </span>
      <p className={`text-[13px] ${hintDanger ? 'font-medium text-danger' : 'text-text-muted'}`}>{hint}</p>
    </div>
  );
}

type LauncherDrag = {
  id: number;
  startX: number;
  startY: number;
  left: number;
  top: number;
  preview: LauncherPosition | null;
};

function RadioLauncher({ visible, bottom, state, onOpen }: {
  visible: boolean;
  bottom: string;
  state: RadioState;
  onOpen: () => void;
}) {
  const [saved, setSaved] = useState(readLauncherPosition);
  const [preview, setPreview] = useState<LauncherPosition | null>(null);
  const [pressed, setPressed] = useState(false);
  const [docked, setDocked] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const drag = useRef<LauncherDrag | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    if (!visible) {
      drag.current = null;
      setPreview(null);
      setPressed(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || pressed || docked) return;
    const timer = window.setTimeout(() => setDocked(true), 5000);
    return () => window.clearTimeout(timer);
  }, [visible, pressed, docked]);

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0 || drag.current || !wrapper.current) return;
    const { left, top } = wrapper.current.getBoundingClientRect();
    drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, left, top, preview: null };
    suppressClick.current = false;
    setPressed(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId || !wrapper.current) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.preview && Math.hypot(dx, dy) < 6) return;

    const viewport = document.documentElement;
    const maxX = Math.max(1, viewport.clientWidth - wrapper.current.offsetWidth);
    const maxY = Math.max(1, viewport.clientHeight - wrapper.current.offsetHeight);
    current.preview = {
      x: Math.min(1, Math.max(0, (current.left + dx) / maxX)),
      y: Math.min(1, Math.max(0, (current.top + dy) / maxY)),
    };
    setPreview(current.preview);
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>, save: boolean) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    suppressClick.current = !!current.preview;
    setPressed(false);
    setPreview(null);
    if (save && current.preview) {
      const position = nearestDock(current.preview);
      setSaved(position);
      setDocked(false);
      try {
        localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
      } catch {
        // The position still applies while the app is open.
      }
    }
  }

  if (!visible) return null;
  const position = preview ?? saved;
  const rightSide = saved?.x !== 0;
  const tucked = !preview && docked;
  const dockOffset = tucked ? (rightSide ? 40 : -40) : 0;
  const view = STATE_STYLES[state];

  return (
    <div
      ref={wrapper}
      className={`fixed z-[70] flex h-14 w-14 items-center justify-center ${position ? '' : 'right-2'} ${preview ? '' : 'transition-[left,transform] motion-reduce:transition-none'}`}
      style={position
        ? {
            left: preview ? `${position.x * 100}%` : rightSide ? 'calc(100% - 8px)' : '8px',
            top: `${position.y * 100}%`,
            transform: `translate(${-position.x * 100}%, ${-position.y * 100}%) translateX(${dockOffset}px)`,
          }
        : { bottom, transform: tucked ? `translateX(${dockOffset}px)` : undefined }}
    >
      {(state === 'speakingSelf' || state === 'speakingOther') && (
        <span
          className={`pointer-events-none absolute animate-ptt-soft-pulse rounded-full border ${view.ring}`}
          style={{ width: 74, height: 74 }}
        />
      )}
      <button
        type="button"
        aria-label="Рация"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={(event) => endDrag(event, true)}
        onPointerCancel={(event) => endDrag(event, false)}
        onLostPointerCapture={(event) => endDrag(event, false)}
        onClick={(event) => {
          if (suppressClick.current && event.detail !== 0) {
            suppressClick.current = false;
            return;
          }
          if (tucked) setDocked(false);
          else onOpen();
        }}
        className={`ptt-no-select relative flex h-14 w-14 cursor-grab touch-none items-center justify-center rounded-full text-white shadow-[0_8px_20px_rgba(0,91,255,0.26)] transition-colors active:cursor-grabbing active:scale-95 ${view.circle}`}
      >
        <span className={tucked ? `scale-75 ${rightSide ? '-translate-x-4' : 'translate-x-4'}` : undefined}>
          <RadioIcon size={25} />
        </span>
      </button>
    </div>
  );
}

export function PttOverlay({
  waiterMode = false,
  buttonHidden = false,
}: {
  waiterMode?: boolean;
  buttonHidden?: boolean;
}) {
  const user = useAuth((s) => s.user);
  const { effectiveRole } = usePermissions();
  const connected = useSocketConnected();
  const isMobile = useMediaQuery('(max-width: 1023px)');
  const overlayOpen = useBlockingOverlayOpen();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const [channel, setChannel] = useState<PttChannel>(() => initialChannel(effectiveRole ?? undefined));
  const [onlineCount, setOnlineCount] = useState(0);
  const [joinedChannel, setJoinedChannel] = useState<PttChannel | null>(null);
  const [busySpeaker, setBusySpeaker] = useState<{ id: string; name?: string } | null>(null);
  const effectiveButtonHidden = buttonHidden || overlayOpen;

  const sender = useAudioPttSender(channel, !!user?.id);
  const { receiving, speaker: playingSpeaker } = useAudioPttReceiver(channel, !!user?.id);

  const floatingBottom = waiterMode && isMobile
    ? 'calc(var(--edu-ptt-floating-bottom, 78px) + env(safe-area-inset-bottom, 0px))'
    : 'calc(24px + env(safe-area-inset-bottom, 0px))';

  useEffect(() => {
    setChannel(initialChannel(effectiveRole ?? undefined));
  }, [effectiveRole]);

  useEffect(() => {
    if (!user?.id) return;
    const sock = getSocket();
    let revision = 0;
    let timer: number | undefined;
    const reset = () => {
      revision++;
      window.clearTimeout(timer);
      setJoinedChannel(null);
      setOnlineCount(0);
    };
    const join = () => {
      reset();
      const expected = revision;
      const attempt = (delay: number) => {
        if (expected !== revision || !sock.connected) return;
        sock.timeout(3000).emit(PTT_EVENTS.JOIN, { channel, codecs: ['opus-hq'], sequenced: true },
          (error: Error | null, ack?: { ok: boolean; channel: PttChannel; onlineCount: number }) => {
            if (expected !== revision) return;
            if (!error && ack?.ok && ack.channel === channel) {
              setOnlineCount(ack.onlineCount);
              setJoinedChannel(channel);
            } else {
              timer = window.setTimeout(() => attempt(Math.min(5000, delay * 2)), delay);
            }
          });
      };
      attempt(500);
    };
    join();
    sock.on('connect', join);
    sock.on('disconnect', reset);
    return () => {
      revision++;
      window.clearTimeout(timer);
      sock.off('connect', join);
      sock.off('disconnect', reset);
      if (sock.connected) sock.emit(PTT_EVENTS.JOIN, { channel: null });
    };
  }, [channel, user?.id]);

  useEffect(() => {
    const sock = getSocket();
    const onPresence = (payload: PttPresencePayload) => {
      if (payload.channel === channel) setOnlineCount(payload.onlineCount);
    };
    const onBusy = (payload: PttBusyPayload) => {
      if (payload.channel === channel || payload.channel === 'general') {
        setBusySpeaker({ id: payload.speaker?.id ?? 'unknown', name: payload.speaker?.name });
      }
    };
    const onFree = (payload: PttFreePayload) => {
      if (payload.channel === channel || payload.channel === 'general') setBusySpeaker(null);
    };
    sock.on(PTT_EVENTS.PRESENCE, onPresence);
    sock.on(PTT_EVENTS.CHANNEL_BUSY, onBusy);
    sock.on(PTT_EVENTS.CHANNEL_FREE, onFree);
    const onDisconnect = () => { setBusySpeaker(null); setOnlineCount(0); };
    sock.on('disconnect', onDisconnect);
    return () => {
      sock.off('disconnect', onDisconnect);
      sock.off(PTT_EVENTS.PRESENCE, onPresence);
      sock.off(PTT_EVENTS.CHANNEL_BUSY, onBusy);
      sock.off(PTT_EVENTS.CHANNEL_FREE, onFree);
    };
  }, [channel]);

  const changeChannel = (next: PttChannel) => {
    if (next === channel) return;
    sender.stop();
    setBusySpeaker(null);
    setChannel(next);
    try {
      localStorage.setItem(CHANNEL_STORAGE_KEY, next);
    } catch {
      /* private mode */
    }
  };

  const onPressStart = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0 || joinedChannel !== channel) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    void sender.start();
  };

  const onPressStop = () => sender.stop();
  const openRadio = () => {
    void preparePttCapture().catch(() => undefined);
    setOpen(true);
  };

  // Закрываем панель рации, сохраняя приём аудио.
  const stopSending = sender.stop;
  const closeRadio = useCallback(() => {
    stopSending();
    setOpen(false);
  }, [stopSending]);
  useEffect(() => {
    if (effectiveButtonHidden) closeRadio();
  }, [effectiveButtonHidden, closeRadio]);

  // Keep the floor occupied while the last received audio is still playing.
  const otherSpeaker = playingSpeaker ?? busySpeaker;
  const speakingOther =
    !sender.talking && (receiving || (!!busySpeaker && busySpeaker.id !== user?.id));
  const state: RadioState = !connected
    ? 'error'
    : sender.talking
      ? 'speakingSelf'
      : speakingOther
        ? 'speakingOther'
        : 'ready';

  const statusTitle =
    state === 'error'
      ? 'Ошибка подключения'
      : state === 'speakingSelf'
        ? 'Вы говорите'
        : state === 'speakingOther'
          ? `Говорит: ${otherSpeaker?.name ?? 'Сотрудник'}`
          : joinedChannel === channel ? 'Готово к разговору' : 'Подключаем канал…';

  const statusHint =
    state === 'error'
      ? 'Восстанавливаем связь…'
      : state === 'speakingSelf'
        ? 'Отпустите для остановки'
        : state === 'speakingOther'
          ? 'Дождитесь освобождения канала'
          : joinedChannel !== channel ? 'Ожидаем соединения с рацией'
            : (sender.deniedReason ?? (sender.starting ? 'Подключаем микрофон…' : 'Нажмите и удерживайте'));

  return (
    <>
      <RadioLauncher visible={!effectiveButtonHidden && !open} bottom={floatingBottom} state={state} onOpen={openRadio} />

      {open && (
        <div className="fixed inset-0 z-[90]">
          <button
            type="button"
            aria-label="Закрыть рацию"
            className="absolute inset-0 animate-fade-in bg-black/30"
            onClick={closeRadio}
          />
          <section
            ref={panel}
            className="absolute left-0 right-0 mx-auto max-w-xl animate-sheet-up rounded-t-[24px] border border-border bg-white px-4 pt-2 shadow-none sm:px-6"
            style={{
              bottom: 0,
              paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
              maxHeight: '55dvh',
            }}
          >
            <SheetHandle panel={panel} onClose={closeRadio} enabled={!sender.talking} />
            <RadioHeader onClose={closeRadio} />
            <RadioChannelTabs channel={channel} onChange={changeChannel} />
            <RadioMetaRow onlineCount={onlineCount} />
            <PushToTalkCircle
              state={state}
              disabled={state === 'error' || joinedChannel !== channel || speakingOther}
              size={isMobile ? 122 : 140}
              onPressStart={onPressStart}
              onPressStop={onPressStop}
            />
            <RadioStatusText
              state={state}
              title={statusTitle}
              hint={statusHint}
              hintDanger={state === 'ready' && !!sender.deniedReason}
            />
          </section>
        </div>
      )}
    </>
  );
}
