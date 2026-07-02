import { useCallback, useEffect, useMemo, useState, type PointerEvent } from 'react';
import { getSocket, useConnectionStatus } from '@/lib/socket';
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
} from './types';

function defaultChannelForRole(role?: string): PttChannel {
  if (role === 'WAITER') return 'waiters';
  if (role === 'KITCHEN' || role === 'BAR') return 'kitchen';
  if (role === 'ADMIN' || role === 'OWNER') return 'admin';
  return 'general';
}

function staffPlural(n: number) {
  const a = Math.abs(n) % 100;
  const b = Math.abs(n) % 10;
  if (a > 10 && a < 20) return 'сотрудников';
  if (b === 1) return 'сотрудник';
  if (b >= 2 && b <= 4) return 'сотрудника';
  return 'сотрудников';
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

function RadioIcon({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M9 4h6M12 4v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <rect x="6.5" y="7.5" width="11" height="13" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M10 11.5h4M10 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="9.5" cy="18" r="0.8" fill="currentColor" />
      <circle cx="14.5" cy="18" r="0.8" fill="currentColor" />
    </svg>
  );
}

function PowerIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2v10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M6.4 6.6a8 8 0 1 0 11.2 0" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Waveform({ active }: { active: boolean }) {
  const bars = [8, 12, 16, 18, 28, 38, 28, 22, 34, 44, 54, 78, 48, 36, 28, 24, 32, 38, 34, 28, 22, 16, 12, 8];
  return (
    <div className="relative flex h-56 items-center justify-center overflow-hidden">
      <div className="absolute h-56 w-56 rounded-full bg-primary/5" />
      <div className="absolute h-80 w-80 rounded-full border-[36px] border-primary/[0.035]" />
      <div className="relative flex items-center gap-2">
        {bars.map((height, index) => {
          const distance = Math.abs(index - (bars.length - 1) / 2);
          const strong = distance < 5;
          return (
            <span
              key={`${height}-${index}`}
              className={`w-2 rounded-full transition-all duration-200 ${
                strong ? 'bg-primary' : 'bg-primary/25'
              } ${active ? 'animate-pulse' : ''}`}
              style={{
                height: active ? height + (index % 3) * 7 : height,
                animationDelay: `${index * 35}ms`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function PttOverlay({ waiterMode = false }: { waiterMode?: boolean }) {
  const user = useAuth((s) => s.user);
  const connected = useConnectionStatus();
  const isMobile = useMediaQuery('(max-width: 1023px)');
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [channel, setChannel] = useState<PttChannel>(() => defaultChannelForRole(user?.role));
  const [onlineCount, setOnlineCount] = useState(1);
  const [busySpeakerId, setBusySpeakerId] = useState<string | null>(null);

  const selected = useMemo(
    () => PTT_CHANNELS.find((item) => item.key === channel) ?? PTT_CHANNELS[0],
    [channel],
  );
  const sender = useAudioPttSender(channel, enabled);
  const receiver = useAudioPttReceiver(channel, enabled);
  const activeWave = sender.talking || receiver.receiving;
  const floatingBottom = waiterMode && isMobile ? 148 : 24;
  const sheetBottom = waiterMode && isMobile ? 58 : 0;

  const joinChannel = useCallback(() => {
    const sock = getSocket();
    sock.emit(PTT_EVENTS.JOIN, { channel }, (ack: { ok?: boolean; onlineCount?: number } | undefined) => {
      if (ack?.ok && typeof ack.onlineCount === 'number') setOnlineCount(ack.onlineCount);
    });
  }, [channel]);

  useEffect(() => {
    setChannel(defaultChannelForRole(user?.role));
  }, [user?.role]);

  useEffect(() => {
    const sock = getSocket();
    if (!enabled) {
      sock.emit(PTT_EVENTS.JOIN, { channel: null });
      setOnlineCount(0);
      setBusySpeakerId(null);
      return undefined;
    }

    joinChannel();
    sock.on('connect', joinChannel);
    return () => {
      sock.off('connect', joinChannel);
    };
  }, [enabled, joinChannel]);

  useEffect(() => {
    const sock = getSocket();
    const onPresence = (payload: PttPresencePayload) => {
      if (payload.channel === channel) setOnlineCount(payload.onlineCount);
    };
    const onBusy = (payload: PttBusyPayload) => {
      if (payload.channel === channel) setBusySpeakerId(payload.speaker?.id ?? 'unknown');
    };
    const onFree = (payload: PttFreePayload) => {
      if (payload.channel === channel) setBusySpeakerId(null);
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
    setBusySpeakerId(null);
    setChannel(next);
  };

  const disableRadio = () => {
    sender.stop();
    setEnabled(false);
  };

  const onPressStart = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    void sender.start();
  };

  const onPressStop = () => sender.stop();

  return (
    <>
      <button
        type="button"
        aria-label="Рация"
        onClick={() => {
          setEnabled(true);
          setOpen(true);
        }}
        className="fixed right-6 z-[70] flex h-20 w-20 items-center justify-center rounded-full bg-primary text-white shadow-[0_12px_28px_rgba(0,91,255,0.35)] transition-transform active:scale-95"
        style={{ bottom: `calc(${floatingBottom}px + env(safe-area-inset-bottom, 0px))` }}
      >
        <RadioIcon size={38} />
        <span
          className={`absolute right-1.5 top-1.5 h-5 w-5 rounded-full border-[3px] border-white ${
            connected ? 'bg-success' : 'bg-text-light'
          }`}
        />
      </button>

      {open && (
        <div className="fixed inset-0 z-[90]">
          <button
            type="button"
            aria-label="Закрыть рацию"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <section
            className="absolute left-0 right-0 rounded-t-[26px] border border-border bg-white px-4 pb-6 pt-3 shadow-soft sm:px-8"
            style={{
              bottom: `calc(${sheetBottom}px + env(safe-area-inset-bottom, 0px))`,
              maxHeight: sheetBottom ? 'calc(88dvh - 58px)' : '88dvh',
            }}
          >
            <div className="mx-auto mb-6 h-1.5 w-20 rounded-full bg-slate-300" />
            <div className="mb-7 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-text-primary">Рация</h2>
              <button
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-background"
                onClick={() => setOpen(false)}
                aria-label="Закрыть"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="no-scrollbar mb-6 flex gap-3 overflow-x-auto">
              {PTT_CHANNELS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => changeChannel(item.key)}
                  className={`shrink-0 rounded-xl border px-5 py-3 text-[15px] font-medium transition-colors ${
                    item.key === channel
                      ? 'border-primary bg-primary text-white'
                      : 'border-border bg-white text-text-secondary hover:bg-background'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="mb-5 flex items-center gap-5 rounded-2xl border border-border bg-white px-5 py-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <RadioIcon size={34} />
              </div>
              <div className="min-w-0">
                <p className="text-[22px] font-semibold text-text-primary">Канал: {selected.label}</p>
                <p className="mt-2 flex items-center gap-3 text-[15px] text-text-muted">
                  <span className="h-3 w-3 rounded-full bg-success" />
                  {onlineCount} {staffPlural(onlineCount)} онлайн
                </p>
              </div>
            </div>

            <Waveform active={activeWave} />

            <p className="mb-6 text-center text-[17px] font-medium text-text-muted">
              Говорите в канал «{selected.label}»
            </p>
            {(sender.deniedReason || (busySpeakerId && busySpeakerId !== user?.id && !sender.talking)) && (
              <p className="mb-3 text-center text-sm font-medium text-danger">
                {sender.deniedReason ?? 'Канал занят'}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={!enabled || (!!busySpeakerId && busySpeakerId !== user?.id)}
                onPointerDown={onPressStart}
                onPointerUp={onPressStop}
                onPointerCancel={onPressStop}
                onLostPointerCapture={onPressStop}
                onContextMenu={(event) => event.preventDefault()}
                className={`flex h-20 min-w-0 flex-1 touch-none items-center justify-center gap-4 rounded-full bg-primary px-5 text-[18px] font-semibold text-white transition-all disabled:opacity-60 ${
                  sender.talking ? 'scale-[0.98] bg-primary-hover' : ''
                }`}
              >
                <RadioIcon size={34} />
                <span className="truncate">Зажмите для разговора</span>
              </button>
              <button
                type="button"
                onClick={disableRadio}
                className="flex h-16 shrink-0 items-center justify-center gap-2 rounded-2xl border border-border bg-white px-4 text-sm font-semibold text-text-secondary transition-colors hover:bg-background"
              >
                <PowerIcon />
                <span className="hidden min-[390px]:inline">Отключить</span>
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
