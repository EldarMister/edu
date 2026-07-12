import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigationState } from '@react-navigation/native';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { colors, fontSize, radius, softShadow, spacing, waiterLayout } from '@/theme';
import { getSocket, useConnectionStatus } from '@/services/socket';
import { useAuth } from '@/store/auth';
import {
  startPttBackgroundRuntime,
  stopPttBackgroundRuntime,
  updatePttBackgroundChannel,
} from './backgroundRuntime';
import { useRadioVisibility } from './radioVisibility';
import { useAudioPttReceiver } from './useAudioPttReceiver';
import { useAudioPttSender } from './useAudioPttSender';
import {
  PTT_CHANNEL_STORAGE_KEY,
  PTT_CHANNELS,
  PTT_EVENTS,
  type PttBusyPayload,
  type PttChannel,
  type PttFreePayload,
  type PttPresencePayload,
  type RadioState,
} from './types';

const CIRCLE_SIZE = 122;

/** Кастомная PNG-иконка рации (белая) — как на PWA (/рация.png). */
const RADIO_ICON = require('../../../assets/radio-icon.png');

function defaultChannelForRole(role?: string): PttChannel {
  if (role === 'WAITER') return 'waiters';
  if (role === 'KITCHEN' || role === 'BAR') return 'kitchen';
  if (role === 'ADMIN' || role === 'OWNER') return 'admin';
  return 'general';
}

function isPttChannel(value: unknown): value is PttChannel {
  return PTT_CHANNELS.some((item) => item.key === value);
}

/** Активная вкладка официанта и лист вкладки «Заказы» из дерева навигации. */
function readWaiterNav(state: unknown): { tab?: string; ordersLeaf?: string } {
  const s = state as { index?: number; routes?: any[] } | undefined;
  const root = s?.routes?.[s.index ?? 0];
  const tabState = root?.state as { index?: number; routes?: any[] } | undefined;
  if (!tabState?.routes) return {};
  const tabRoute = tabState.routes[tabState.index ?? 0];
  const tab = tabRoute?.name as string | undefined;
  let ordersLeaf: string | undefined;
  const stack = tabRoute?.state as { index?: number; routes?: any[] } | undefined;
  if (tab === 'Orders' && stack?.routes) {
    ordersLeaf = stack.routes[stack.index ?? stack.routes.length - 1]?.name;
  }
  return { tab, ordersLeaf };
}

/** Визуальные параметры круга и статусной метки по состоянию рации (как в PWA). */
const STATE_STYLES: Record<RadioState, { circle: string; ring: string; pulse: boolean; label: string }> = {
  ready: { circle: colors.primary, ring: 'rgba(0, 91, 255, 0.25)', pulse: false, label: colors.primary },
  speakingSelf: { circle: colors.success, ring: 'rgba(22, 163, 74, 0.25)', pulse: true, label: colors.success },
  speakingOther: { circle: colors.warning, ring: 'rgba(245, 158, 11, 0.3)', pulse: true, label: colors.warning },
  error: { circle: colors.danger, ring: 'rgba(239, 68, 68, 0.3)', pulse: false, label: colors.danger },
};

function RadioHeader({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>Рация</Text>
      <FastPressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
        <PwaIcon name="close" size={24} color={colors.textMuted} strokeWidth={2} />
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
  const ringCount = state === 'speakingSelf' ? 3 : state === 'speakingOther' ? 1 : 0;

  return (
    <View style={styles.circleWrap}>
      {Array.from({ length: ringCount }).map((_, index) => (
        <PttRipple
          key={index}
          mode={state === 'speakingSelf' ? 'ripple' : 'soft'}
          delay={index * 220}
          size={CIRCLE_SIZE + 22 + index * 22}
          color={view.ring}
          borderWidth={1}
        />
      ))}
      <FastPressable
        disabled={disabled}
        onPressIn={onPressStart}
        onPressOut={onPressStop}
        accessibilityRole="button"
        accessibilityLabel="Нажмите и удерживайте, чтобы говорить"
        style={[
          styles.circle,
          { backgroundColor: view.circle, shadowColor: view.circle },
          state === 'speakingSelf' && { transform: [{ scale: 1.12 }] },
          disabled && styles.circleDisabled,
        ]}
      >
        <Image source={RADIO_ICON} style={styles.circleIcon} resizeMode="contain" />
      </FastPressable>
    </View>
  );
}

function PttRipple({
  mode,
  delay = 0,
  size,
  color,
  borderWidth,
}: {
  mode: 'ripple' | 'soft';
  delay?: number;
  size: number;
  color: string;
  borderWidth: number;
}) {
  const progress = useSharedValue(0);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      progress.value = 0;
      progress.value = mode === 'ripple'
        ? withRepeat(withTiming(1, { duration: 1350, easing: Easing.out(Easing.ease) }), -1, false)
        : withRepeat(withTiming(1, { duration: 850, easing: Easing.inOut(Easing.ease) }), -1, true);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimation(progress);
    };
  }, [delay, mode, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale:
          mode === 'ripple'
            ? interpolate(progress.value, [0, 1], [0.86, 1.28])
            : interpolate(progress.value, [0, 1], [1, 1.08]),
      },
    ],
    opacity:
      mode === 'ripple'
        ? interpolate(progress.value, [0, 0.7, 1], [0.5, 0.18, 0])
        : interpolate(progress.value, [0, 1], [0.72, 0.3]),
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2, borderColor: color, borderWidth },
        animatedStyle,
      ]}
    />
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
  const [onlineCount, setOnlineCount] = React.useState(0);
  const [busySpeaker, setBusySpeaker] = React.useState<{ id: string; name?: string } | null>(null);
  const selected = React.useMemo(
    () => PTT_CHANNELS.find((item) => item.key === channel) ?? PTT_CHANNELS[0],
    [channel],
  );
  const sender = useAudioPttSender(channel, true);
  const { speaker: playingSpeaker } = useAudioPttReceiver(channel, true);

  // Кнопка рации у официанта — только на «Столах», списке «Заказов» и «Профиле».
  // Прячем на «Меню», подробном заказе и в личном кабинете. Другие роли — без
  // ограничений. Оверлей остаётся смонтированным, приём аудио не прерывается.
  const cabinetOpen = useRadioVisibility((s) => s.cabinetOpen);
  const shiftGateOpen = useRadioVisibility((s) => s.shiftGateOpen);
  const waiterNav = useNavigationState((state) => (isWaiter ? readWaiterNav(state) : null));
  const buttonVisible = React.useMemo(() => {
    if (!isWaiter || !waiterNav) return true;
    if (shiftGateOpen) return false;
    const { tab, ordersLeaf } = waiterNav;
    if (!tab) return true;
    if (tab === 'Menu') return false;
    if (tab === 'Orders') return ordersLeaf !== 'OrderDetail';
    if (tab === 'Profile') return !cabinetOpen;
    return true;
  }, [isWaiter, waiterNav, cabinetOpen, shiftGateOpen]);

  React.useEffect(() => {
    if (!buttonVisible) setOpen(false);
  }, [buttonVisible]);
  // Имя последнего говорившего (из channel_busy) — фолбэк на время
  // воспроизведения, если бэкенд не кладёт senderName в аудио-сообщение.
  const lastSpeakerNameRef = React.useRef<string | undefined>(undefined);
  // Кнопка сидит чуть выше нижней навигации (как на PWA ~78px). Показывается
  // только на Столах/Заказах/Профиле, где нет бара корзины, поэтому её можно
  // опустить к самой навигации.
  const floatingBottom = isWaiter
    ? waiterLayout.navBarHeight + spacing.lg + insets.bottom
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
        if (retriesLeft > 0) setTimeout(() => attempt(retriesLeft - 1), 1000);
      });
    };
    attempt(5);
  }, [channel]);

  // Последний выбранный канал переживает перезапуск приложения.
  React.useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(PTT_CHANNEL_STORAGE_KEY).then((stored) => {
      if (cancelled) return;
      setChannel(isPttChannel(stored) ? stored : defaultChannelForRole(user?.role));
    });
    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  React.useEffect(() => {
    if (!user?.id) return undefined;
    void startPttBackgroundRuntime(channel);
    return () => {
      void stopPttBackgroundRuntime();
    };
    // Runtime должен жить всё время авторизованной staff-сессии.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  React.useEffect(() => {
    updatePttBackgroundChannel(channel);
  }, [channel]);

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
        if (payload.speaker?.name) lastSpeakerNameRef.current = payload.speaker.name;
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
    updatePttBackgroundChannel(next);
  };

  // «Занято» = кто-то держит кнопку (channel_busy) ИЛИ у нас сейчас играет
  // входящий файл (playingSpeaker). Второе продлевает блокировку на всё
  // воспроизведение — иначе после отпускания канал выглядел бы свободным,
  // пока длинное сообщение ещё звучит.
  const receivingFromOther =
    !sender.talking && (!!playingSpeaker || (!!busySpeaker && busySpeaker.id !== user?.id));
  const speakerName =
    playingSpeaker?.name ?? busySpeaker?.name ?? lastSpeakerNameRef.current ?? 'Сотрудник';
  const state: RadioState = !connected
    ? 'error'
    : sender.talking
      ? 'speakingSelf'
      : receivingFromOther
        ? 'speakingOther'
        : 'ready';

  const statusTitle =
    state === 'error'
      ? 'Ошибка подключения'
      : state === 'speakingSelf'
        ? 'Вы говорите'
        : state === 'speakingOther'
          ? `Говорит: ${speakerName}`
          : 'Готово к разговору';

  const statusHint =
    state === 'error'
      ? 'Повторите попытку'
      : state === 'speakingSelf'
        ? 'Отпустите для остановки'
        : state === 'speakingOther'
          ? 'Дождитесь освобождения канала'
          : (sender.deniedReason ?? 'Нажмите и удерживайте');
  const outerSpeaking = state === 'speakingSelf' || state === 'speakingOther';
  const outerView = STATE_STYLES[state];

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {buttonVisible && (
        <View pointerEvents="box-none" style={[styles.floatButtonWrap, { bottom: floatingBottom }]}>
          {outerSpeaking ? (
            <PttRipple mode="soft" size={74} color={outerView.ring} borderWidth={1} />
          ) : null}
          <FastPressable
            accessibilityRole="button"
            accessibilityLabel="Рация"
            onPress={() => setOpen(true)}
            style={[styles.floatButton, { backgroundColor: outerView.circle }]}
          >
            <Image source={RADIO_ICON} style={styles.floatButtonIcon} resizeMode="contain" />
          </FastPressable>
        </View>
      )}

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        sheet
        panelStyle={styles.pttSheet}
        maxHeight="55%"
        bottomInset={sheetBottomInset}
        backdropColor="rgba(0,0,0,0.3)"
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
          hintDanger={state === 'ready' && !!sender.deniedReason}
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  floatButtonWrap: {
    position: 'absolute',
    right: spacing.sm,
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 90,
  },
  floatButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 90,
    ...softShadow,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 7,
  },
  sheetBody: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  pttSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: { fontSize: fontSize.xl, fontWeight: '600', color: colors.textPrimary },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
  ring: {
    position: 'absolute',
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
  circleIcon: { width: Math.round(CIRCLE_SIZE * 0.42), height: Math.round(CIRCLE_SIZE * 0.42) },
  floatButtonIcon: { width: 26, height: 26 },
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
