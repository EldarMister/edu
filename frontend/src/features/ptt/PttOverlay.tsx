import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import { useAudioPttReceiver } from './useAudioPttReceiver';
import { useAudioPttSender } from './useAudioPttSender';
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
const WAITER_NAV_INSET = 58;

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
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M10.5 3.5h3M12 3.5v3.25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <rect x="7" y="6.5" width="10" height="14" rx="2.25" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="10.3" r="0.9" fill="currentColor" />
      <path d="M10 13.3h4M10 15.8h4M10 18.3h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
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
      <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-slate-300" />
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

function RadioMetaRow({ channelLabel, onlineCount }: { channelLabel: string; onlineCount: number }) {
  return (
    <div className="mb-3 flex h-10 items-center justify-between rounded-xl border border-border bg-background/60 px-4">
      <span className="text-sm font-semibold text-text-primary">{channelLabel}</span>
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
  const rippleCount = state === 'speakingSelf' ? 3 : state === 'ready' || state === 'speakingOther' || state === 'error' ? 1 : 0;
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
        className={`relative flex touch-none select-none items-center justify-center rounded-full text-white transition-all duration-200 disabled:cursor-not-allowed ${view.circle} ${
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

export function PttOverlay({
  waiterMode = false,
  buttonHidden = false,
}: {
  waiterMode?: boolean;
  buttonHidden?: boolean;
}) {
  const user = useAuth((s) => s.user);
  const connected = useSocketConnected();
  const isMobile = useMediaQuery('(max-width: 1023px)');
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<PttChannel>(() => initialChannel(user?.role));
  const [onlineCount, setOnlineCount] = useState(0);
  const [busySpeaker, setBusySpeaker] = useState<{ id: string; name?: string } | null>(null);

  const selected = useMemo(
    () => PTT_CHANNELS.find((item) => item.key === channel) ?? PTT_CHANNELS[0],
    [channel],
  );
  const sender = useAudioPttSender(channel, true);
  const { receiving, speaker: playingSpeaker } = useAudioPttReceiver(channel, true);

  const bottomNavInset = waiterMode && isMobile ? WAITER_NAV_INSET : 0;
  const floatingBottom = waiterMode && isMobile
    ? 'calc(var(--edu-ptt-floating-bottom, 78px) + env(safe-area-inset-bottom, 0px))'
    : 'calc(24px + env(safe-area-inset-bottom, 0px))';
  const sheetBottom = `calc(${bottomNavInset}px + env(safe-area-inset-bottom, 0px))`;

  const joinSeqRef = useRef(0);
  const joinChannel = useCallback(() => {
    const sock = getSocket();
    const seq = ++joinSeqRef.current;
    const attempt = (retriesLeft: number) => {
      if (joinSeqRef.current !== seq) return;
      sock.emit(PTT_EVENTS.JOIN, { channel }, (ack: { ok?: boolean; onlineCount?: number } | undefined) => {
        if (joinSeqRef.current !== seq) return;
        if (ack?.ok) {
          if (typeof ack.onlineCount === 'number') setOnlineCount(ack.onlineCount);
          return;
        }
        if (retriesLeft > 0) setTimeout(() => attempt(retriesLeft - 1), 1000);
      });
    };
    attempt(5);
  }, [channel]);

  useEffect(() => {
    setChannel(initialChannel(user?.role));
  }, [user?.role]);

  useEffect(() => {
    const sock = getSocket();
    joinChannel();
    sock.on('connect', joinChannel);
    return () => {
      sock.off('connect', joinChannel);
    };
  }, [joinChannel]);

  useEffect(() => {
    const sock = getSocket();
    const onPresence = (payload: PttPresencePayload) => {
      if (payload.channel === channel) setOnlineCount(payload.onlineCount);
    };
    const onBusy = (payload: PttBusyPayload) => {
      if (payload.channel === channel) {
        setBusySpeaker({ id: payload.speaker?.id ?? 'unknown', name: payload.speaker?.name });
      }
    };
    const onFree = (payload: PttFreePayload) => {
      if (payload.channel === channel) setBusySpeaker(null);
    };
    sock.on(PTT_EVENTS.PRESENCE, onPresence);
    sock.on(PTT_EVENTS.CHANNEL_BUSY, onBusy);
    sock.on(PTT_EVENTS.CHANNEL_FREE, onFree);
    return () => {
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
    event.currentTarget.setPointerCapture?.(event.pointerId);
    void sender.start();
  };

  const onPressStop = () => sender.stop();

  // Кнопку прячем на некоторых экранах официанта — при этом лист закрываем,
  // но сам оверлей остаётся смонтированным (приём аудио не прерывается).
  useEffect(() => {
    if (buttonHidden) setOpen(false);
  }, [buttonHidden]);

  // «Занято» = кто-то держит кнопку (channel_busy) ИЛИ у нас сейчас играет
  // входящий файл (receiving). Второе продлевает блокировку на всё
  // воспроизведение — иначе после отпускания канал выглядел бы свободным,
  // пока длинное сообщение ещё звучит.
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
          : 'Готово к разговору';

  const statusHint =
    state === 'error'
      ? 'Повторите попытку'
      : state === 'speakingSelf'
        ? 'Отпустите для остановки'
        : state === 'speakingOther'
          ? 'Дождитесь освобождения канала'
          : (sender.deniedReason ?? 'Нажмите и удерживайте');

  return (
    <>
      {!buttonHidden && (
        <div
          className="fixed right-2 z-[70] flex h-[82px] w-[82px] items-center justify-center"
          style={{ bottom: floatingBottom }}
        >
          <span className="pointer-events-none absolute h-[82px] w-[82px] rounded-full bg-primary/[0.06]" />
          <span className="pointer-events-none absolute h-[68px] w-[68px] rounded-full bg-primary/10" />
          <span className="pointer-events-none absolute h-[58px] w-[58px] rounded-full bg-primary/[0.14]" />
          <button
            type="button"
            aria-label="Рация"
            onClick={() => setOpen(true)}
            className={`relative flex h-14 w-14 items-center justify-center rounded-full text-white shadow-[0_8px_20px_rgba(0,91,255,0.26)] transition-transform active:scale-95 ${
              connected ? 'bg-primary' : 'bg-text-muted'
            }`}
          >
            <RadioIcon size={25} />
          </button>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-[90]">
          <button
            type="button"
            aria-label="Закрыть рацию"
            className="absolute left-0 right-0 top-0 animate-fade-in bg-black/30"
            style={{ bottom: sheetBottom }}
            onClick={() => setOpen(false)}
          />
          <section
            className="absolute left-0 right-0 mx-auto max-w-xl animate-sheet-up rounded-t-[24px] border border-border bg-white px-4 pt-2 shadow-none sm:px-6"
            style={{
              bottom: sheetBottom,
              paddingBottom: 16,
              maxHeight: '55dvh',
            }}
          >
            <RadioHeader onClose={() => setOpen(false)} />
            <RadioChannelTabs channel={channel} onChange={changeChannel} />
            <RadioMetaRow channelLabel={selected.label} onlineCount={onlineCount} />
            <PushToTalkCircle
              state={state}
              disabled={state === 'error' || speakingOther}
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
