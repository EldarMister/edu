import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { colors, fontSize, radius, softShadow, spacing, waiterLayout } from '@/theme';
import { getSocket, useConnectionStatus } from '@/services/socket';
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
const CIRCLE_SIZE = 132;
const GLOW_SIZE = CIRCLE_SIZE + 44;

function defaultChannelForRole(role?: string): PttChannel {
  if (role === 'WAITER') return 'waiters';
  if (role === 'KITCHEN' || role === 'BAR') return 'kitchen';
  if (role === 'ADMIN' || role === 'OWNER') return 'admin';
  return 'general';
}

function isPttChannel(value: unknown): value is PttChannel {
  return PTT_CHANNELS.some((item) => item.key === value);
}

/** Визуальные параметры круга и статусной метки по состоянию рации (как в PWA). */
const STATE_STYLES: Record<RadioState, { circle: string; glow: string; pulse: boolean; label: string }> = {
  idle: { circle: colors.primary, glow: 'rgba(0, 91, 255, 0.16)', pulse: false, label: colors.primary },
  recording: { circle: colors.success, glow: 'rgba(22, 163, 74, 0.22)', pulse: true, label: colors.success },
  receiving: { circle: colors.warning, glow: 'rgba(245, 158, 11, 0.24)', pulse: true, label: colors.warning },
  error: { circle: colors.danger, glow: 'rgba(239, 68, 68, 0.2)', pulse: false, label: colors.danger },
};

function RadioHeader({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>Рация</Text>
      <FastPressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
        <PwaIcon name="close" size={26} color={colors.textMuted} strokeWidth={2} />
      </FastPressable>
    </View>
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
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.channels}>
      {PTT_CHANNELS.map((item) => {
        const active = item.key === channel;
        return (
          <FastPressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={[styles.channelChip, active && styles.channelChipActive]}
          >
            <Text style={[styles.channelText, active && styles.channelTextActive]}>{item.label}</Text>
          </FastPressable>
        );
      })}
    </ScrollView>
  );
}

function RadioMetaRow({ channelLabel, onlineCount }: { channelLabel: string; onlineCount: number }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaChannel} numberOfLines={1}>{channelLabel}</Text>
      <View style={styles.metaOnline}>
        <View style={styles.greenDot} />
        <Text style={styles.metaOnlineText}>{onlineCount} онлайн</Text>
      </View>
    </View>
  );
}

function PushToTalkCircle({
  state,
  disabled,
  onPressStart,
  onPressStop,
}: {
  state: RadioState;
  disabled: boolean;
  onPressStart: () => void;
  onPressStop: () => void;
}) {
  const view = STATE_STYLES[state];
  const pulse = useSharedValue(0);

  React.useEffect(() => {
    if (view.pulse) {
      pulse.value = withRepeat(
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      return () => cancelAnimation(pulse);
    }
    cancelAnimation(pulse);
    pulse.value = withTiming(0, { duration: 200 });
    return undefined;
  }, [pulse, view.pulse]);

  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.12 }],
    opacity: 0.55 + pulse.value * 0.45,
  }));

  return (
    <View style={styles.circleWrap}>
      {/* Мягкое свечение вокруг круга; пульсирует, пока идёт передача или приём. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.glow, { backgroundColor: view.glow }, glowStyle]}
      />
      <FastPressable
        disabled={disabled}
        onPressIn={onPressStart}
        onPressOut={onPressStop}
        accessibilityRole="button"
        accessibilityLabel="Нажмите и удерживайте, чтобы говорить"
        style={[
          styles.circle,
          { backgroundColor: view.circle, shadowColor: view.circle },
          state === 'recording' && { transform: [{ scale: 1.04 }] },
          disabled && styles.circleDisabled,
        ]}
      >
        <PwaIcon name="radio" size={54} color={colors.white} strokeWidth={2.1} />
      </FastPressable>
    </View>
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
  const color = STATE_STYLES[state].label;
  return (
    <View style={styles.statusWrap}>
      <View style={[styles.statusLabel, { borderColor: `${color}55` }]}>
        <Text style={[styles.statusLabelText, { color }]} numberOfLines={1}>{title}</Text>
      </View>
      <Text style={[styles.statusHint, hintDanger && styles.statusHintDanger]}>{hint}</Text>
    </View>
  );
}

export function PttOverlay() {
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user);
  const connected = useConnectionStatus();
  const isWaiter = user?.role === 'WAITER';
  const [open, setOpen] = React.useState(false);
  const [channel, setChannel] = React.useState<PttChannel>(() => defaultChannelForRole(user?.role));
  const [onlineCount, setOnlineCount] = React.useState(1);
  const [busySpeaker, setBusySpeaker] = React.useState<{ id: string; name?: string } | null>(null);
  const selected = React.useMemo(
    () => PTT_CHANNELS.find((item) => item.key === channel) ?? PTT_CHANNELS[0],
    [channel],
  );
  const sender = useAudioPttSender(channel, true);
  useAudioPttReceiver(channel, true);
  const floatingBottom = isWaiter
    ? waiterLayout.navBarHeight + waiterLayout.cartBarHeight + insets.bottom + spacing.xl
    : insets.bottom + spacing.xl;
  const sheetBottomInset = isWaiter ? waiterLayout.navBarHeight + insets.bottom : undefined;

  const joinSeqRef = React.useRef(0);
  const joinChannel = React.useCallback(() => {
    const sock = getSocket();
    // Сервер аутентифицирует сокет асинхронно (JWT + БД), поэтому join сразу
    // после connect может отвергнуться — ретраим с паузой несколько раз.
    // seq отменяет устаревшие ретраи при смене канала/переподключении.
    const seq = ++joinSeqRef.current;
    const attempt = (retriesLeft: number) => {
      if (joinSeqRef.current !== seq) return;
      sock.emit(PTT_EVENTS.JOIN, { channel }, (ack: { ok?: boolean; onlineCount?: number } | undefined) => {
        if (joinSeqRef.current !== seq) return;
        if (ack?.ok) {
          if (typeof ack.onlineCount === 'number') setOnlineCount(ack.onlineCount);
          return;
        }
        if (retriesLeft > 0) setTimeout(() => attempt(retriesLeft - 1), 1500);
      });
    };
    attempt(3);
  }, [channel]);

  // Последний выбранный канал переживает перезапуск приложения.
  React.useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(CHANNEL_STORAGE_KEY).then((stored) => {
      if (cancelled) return;
      setChannel(isPttChannel(stored) ? stored : defaultChannelForRole(user?.role));
    });
    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  React.useEffect(() => {
    const sock = getSocket();
    joinChannel();
    sock.on('connect', joinChannel);
    return () => {
      sock.off('connect', joinChannel);
    };
  }, [joinChannel]);

  React.useEffect(() => {
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
    void AsyncStorage.setItem(CHANNEL_STORAGE_KEY, next);
  };

  const receivingFromOther = !!busySpeaker && busySpeaker.id !== user?.id && !sender.talking;
  const state: RadioState = !connected
    ? 'error'
    : sender.talking
      ? 'recording'
      : receivingFromOther
        ? 'receiving'
        : 'idle';

  const statusTitle =
    state === 'error'
      ? 'Ошибка подключения'
      : state === 'recording'
        ? 'Вы говорите'
        : state === 'receiving'
          ? `Говорит: ${busySpeaker?.name ?? 'Сотрудник'}`
          : 'Готово к разговору';

  const statusHint =
    state === 'error'
      ? 'Повторите попытку'
      : state === 'recording'
        ? 'Отпустите для остановки'
        : state === 'receiving'
          ? 'Нажмите и удерживайте для ответа'
          : (sender.deniedReason ?? 'Нажмите и удерживайте');

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <FastPressable
        accessibilityRole="button"
        accessibilityLabel="Рация"
        onPress={() => setOpen(true)}
        style={[styles.floatButton, { bottom: floatingBottom }]}
      >
        <PwaIcon name="radio" size={26} color={colors.white} strokeWidth={2.1} />
        <View style={[styles.onlineDot, { backgroundColor: connected ? colors.success : colors.textLight }]} />
      </FastPressable>

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        sheet
        maxHeight="55%"
        bottomInset={sheetBottomInset}
        bodyStyle={styles.sheetBody}
      >
        <RadioHeader onClose={() => setOpen(false)} />
        <RadioChannelTabs channel={channel} onChange={changeChannel} />
        <RadioMetaRow channelLabel={selected.label} onlineCount={onlineCount} />
        <PushToTalkCircle
          state={state}
          disabled={state === 'error' || receivingFromOther}
          onPressStart={() => void sender.start()}
          onPressStop={sender.stop}
        />
        <RadioStatusText
          state={state}
          title={statusTitle}
          hint={statusHint}
          hintDanger={state === 'idle' && !!sender.deniedReason}
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  floatButton: {
    position: 'absolute',
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 90,
    ...softShadow,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 7,
  },
  onlineDot: {
    position: 'absolute',
    right: 1,
    top: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.white,
  },
  sheetBody: {
    paddingTop: 0,
    paddingBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: { fontSize: 21, fontWeight: '600', color: colors.textPrimary },
  closeBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channels: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  channelChip: {
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
  },
  channelChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  channelText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary },
  channelTextActive: { color: colors.white },
  metaRow: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(248, 250, 252, 0.6)',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  metaChannel: { flexShrink: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  metaOnline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaOnlineText: { fontSize: fontSize.sm, color: colors.textMuted },
  greenDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  circleWrap: {
    minHeight: CIRCLE_SIZE + 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  glow: {
    position: 'absolute',
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
  },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 6,
  },
  circleDisabled: { opacity: 0.7 },
  statusWrap: { alignItems: 'center', gap: 6, paddingBottom: spacing.xs },
  statusLabel: {
    maxWidth: '90%',
    borderWidth: 1,
    borderRadius: 999,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingVertical: 5,
  },
  statusLabelText: { fontSize: fontSize.sm, fontWeight: '600' },
  statusHint: { fontSize: 13, color: colors.textMuted },
  statusHintDanger: { color: colors.danger, fontWeight: '500' },
});
