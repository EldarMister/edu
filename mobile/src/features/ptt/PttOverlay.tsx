import React from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigationState } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { BottomSheet } from '@/components/BottomSheet';
import { colors, fontSize, radius, softShadow, spacing } from '@/theme';
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

const WAITER_NAV_BAR_HEIGHT = 56;
const WAITER_CART_BAR_HEIGHT = 65;

type RouteLike = { name?: string; state?: NavigationStateLike };
type NavigationStateLike = { index?: number; routes?: RouteLike[] };

function activeRouteName(state: NavigationStateLike | undefined): string | undefined {
  let route = state?.routes?.[state.index ?? 0];
  while (route?.state?.routes?.length) {
    route = route.state.routes[route.state.index ?? 0];
  }
  return route?.name;
}

function defaultChannelForRole(role?: string): PttChannel {
  if (role === 'WAITER') return 'waiters';
  if (role === 'KITCHEN' || role === 'BAR') return 'kitchen';
  if (role === 'ADMIN' || role === 'OWNER') return 'admin';
  return 'general';
}

const STATE_VIEW: Record<
  RadioState,
  {
    color: string;
    ring: string;
    soft: string;
    labelBorder: string;
    labelText: string;
    hintDanger?: boolean;
  }
> = {
  ready: {
    color: colors.primary,
    ring: 'rgba(0, 91, 255, 0.22)',
    soft: 'rgba(0, 91, 255, 0.08)',
    labelBorder: 'rgba(0, 91, 255, 0.35)',
    labelText: colors.primary,
  },
  speakingSelf: {
    color: colors.success,
    ring: 'rgba(22, 163, 74, 0.26)',
    soft: 'rgba(22, 163, 74, 0.08)',
    labelBorder: 'rgba(22, 163, 74, 0.45)',
    labelText: colors.success,
  },
  speakingOther: {
    color: colors.warning,
    ring: 'rgba(245, 158, 11, 0.28)',
    soft: 'rgba(245, 158, 11, 0.09)',
    labelBorder: 'rgba(245, 158, 11, 0.48)',
    labelText: colors.warning,
  },
  error: {
    color: colors.danger,
    ring: 'rgba(239, 68, 68, 0.3)',
    soft: 'rgba(239, 68, 68, 0.08)',
    labelBorder: 'rgba(239, 68, 68, 0.45)',
    labelText: colors.danger,
    hintDanger: true,
  },
};

function Waveform({ active, state }: { active: boolean; state: RadioState }) {
  const [phase, setPhase] = React.useState(0);
  React.useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setPhase((value) => (value + 1) % 6), 140);
    return () => clearInterval(id);
  }, [active]);

  const bars = [10, 14, 20, 28, 18, 34, 42, 30, 22, 16, 12];
  const view = STATE_VIEW[state];
  return (
    <View style={styles.waveBars}>
      {bars.map((height, index) => (
        <View
          key={`${height}-${index}`}
          style={[
            styles.waveBar,
            {
              height: active ? height + ((phase + index) % 3) * 4 : height,
              backgroundColor: active ? view.color : 'rgba(0, 91, 255, 0.18)',
              opacity: active ? 0.95 : 0.55,
            },
          ]}
        />
      ))}
    </View>
  );
}

function PttStateButton({
  state,
  disabled,
  onStart,
  onStop,
}: {
  state: RadioState;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const pulse = React.useRef(new Animated.Value(0)).current;
  const shake = React.useRef(new Animated.Value(0)).current;
  const view = STATE_VIEW[state];
  const ringCount = state === 'speakingSelf' ? 3 : 1;

  React.useEffect(() => {
    pulse.setValue(0);
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: state === 'speakingSelf' ? 1100 : 1600,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, state]);

  React.useEffect(() => {
    if (state !== 'error') return;
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: -4, duration: 45, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 4, duration: 70, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -3, duration: 65, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]).start();
  }, [shake, state]);

  const ringScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: state === 'speakingSelf' ? [0.9, 1.28] : [1, 1.1],
  });
  const ringOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: state === 'speakingSelf' ? [0.48, 0] : [0.55, 0.2],
  });
  const buttonScale = state === 'speakingSelf' ? 1.12 : 1;

  return (
    <View style={styles.pttWrap}>
      {Array.from({ length: ringCount }).map((_, index) => (
        <Animated.View
          key={index}
          pointerEvents="none"
          style={[
            styles.pttRing,
            {
              width: 142 + index * 20,
              height: 142 + index * 20,
              borderRadius: (142 + index * 20) / 2,
              borderColor: view.ring,
              opacity: ringOpacity,
              transform: [{ scale: ringScale }],
            },
          ]}
        />
      ))}
      <Animated.View
        style={[
          styles.pttCircle,
          {
            backgroundColor: view.color,
            transform: [{ translateX: shake }, { scale: buttonScale }],
          },
        ]}
      >
        <Pressable
          disabled={disabled}
          onPressIn={onStart}
          onPressOut={onStop}
          style={styles.pttPressable}
          accessibilityRole="button"
          accessibilityLabel="Зажмите для разговора"
        >
          <MaterialCommunityIcons name="radio-handheld" size={45} color={colors.white} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

export function PttOverlay() {
  const insets = useSafeAreaInsets();
  const activeRoute = useNavigationState((state) => activeRouteName(state as NavigationStateLike));
  const user = useAuth((s) => s.user);
  const connected = useConnectionStatus();
  const isWaiter = user?.role === 'WAITER';
  const isMenu = activeRoute === 'Menu';
  const [open, setOpen] = React.useState(false);
  const [channel, setChannel] = React.useState<PttChannel>(() => defaultChannelForRole(user?.role));
  const [onlineCount, setOnlineCount] = React.useState(0);
  const [busySpeaker, setBusySpeaker] = React.useState<{ id: string; name?: string } | null>(null);
  const selected = React.useMemo(
    () => PTT_CHANNELS.find((item) => item.key === channel) ?? PTT_CHANNELS[0],
    [channel],
  );
  const sender = useAudioPttSender(channel, connected);
  const receiver = useAudioPttReceiver(channel, connected);
  const floatingBottom = isWaiter
    ? WAITER_NAV_BAR_HEIGHT + (isMenu ? WAITER_CART_BAR_HEIGHT + spacing.md : spacing.lg) + insets.bottom
    : insets.bottom + spacing.xl;
  const sheetBottomInset = isWaiter ? WAITER_NAV_BAR_HEIGHT + insets.bottom : 0;

  const joinSeqRef = React.useRef(0);
  const joinChannel = React.useCallback(() => {
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

  React.useEffect(() => {
    setChannel(defaultChannelForRole(user?.role));
  }, [user?.role]);

  React.useEffect(() => {
    if (!connected) {
      setBusySpeaker(null);
      return undefined;
    }
    const sock = getSocket();
    joinChannel();
    sock.on('connect', joinChannel);
    return () => {
      sock.off('connect', joinChannel);
    };
  }, [connected, joinChannel]);

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
  };

  const speakingOther = !!busySpeaker && busySpeaker.id !== user?.id && !sender.talking;
  const state: RadioState = !connected
    ? 'error'
    : sender.talking
      ? 'speakingSelf'
      : speakingOther
        ? 'speakingOther'
        : 'ready';
  const activeWave = sender.talking || speakingOther || receiver.receiving;
  const view = STATE_VIEW[state];
  const statusTitle =
    state === 'error'
      ? 'Ошибка подключения'
      : state === 'speakingSelf'
        ? 'Вы говорите'
        : state === 'speakingOther'
          ? `Говорит: ${busySpeaker?.name ?? 'Сотрудник'}`
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
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Рация"
        onPress={() => setOpen(true)}
        style={[styles.floatButton, { bottom: floatingBottom }]}
      >
        <MaterialCommunityIcons name="radio-handheld" size={30} color={colors.white} />
        <View style={[styles.onlineDot, { backgroundColor: connected ? colors.success : colors.danger }]} />
      </Pressable>

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        sheet
        maxHeight="55%"
        bottomInset={sheetBottomInset}
        backdropBottomInset={sheetBottomInset}
        noShadow
        bodyStyle={styles.sheetBody}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Рация</Text>
          <Pressable onPress={() => setOpen(false)} hitSlop={12} style={styles.closeBtn}>
            <Ionicons name="close" size={29} color={colors.textMuted} />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.channels}>
          {PTT_CHANNELS.map((item) => {
            const active = item.key === channel;
            return (
              <Pressable
                key={item.key}
                onPress={() => changeChannel(item.key)}
                style={[styles.channelChip, active && styles.channelChipActive]}
              >
                <Text style={[styles.channelText, active && styles.channelTextActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.metaRow}>
          <Text style={styles.metaChannel} numberOfLines={1}>{selected.label}</Text>
          <View style={styles.onlineLine}>
            <View style={styles.greenDot} />
            <Text style={styles.onlineText}>{onlineCount} онлайн</Text>
          </View>
        </View>

        <Waveform active={activeWave} state={state} />

        <PttStateButton
          state={state}
          disabled={state === 'error' || speakingOther}
          onStart={() => void sender.start()}
          onStop={sender.stop}
        />

        <View style={styles.statusWrap}>
          <Text style={[styles.statusPill, { borderColor: view.labelBorder, color: view.labelText }]}>
            {statusTitle}
          </Text>
          <Text style={[styles.statusHint, view.hintDanger || (state === 'ready' && sender.deniedReason) ? styles.statusHintDanger : null]}>
            {statusHint}
          </Text>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  floatButton: {
    position: 'absolute',
    right: spacing.xl,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 90,
    ...softShadow,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 7,
  },
  onlineDot: {
    position: 'absolute',
    right: 1,
    top: 1,
    width: 17,
    height: 17,
    borderRadius: 8.5,
    borderWidth: 3,
    borderColor: colors.white,
  },
  sheetBody: {
    paddingTop: 0,
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channels: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  channelChip: {
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: radius.pill,
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
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  metaChannel: { flex: 1, minWidth: 0, fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  onlineLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: spacing.sm },
  greenDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.success },
  onlineText: { fontSize: fontSize.xs, color: colors.textMuted },
  waveBars: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginBottom: spacing.xs,
  },
  waveBar: {
    width: 5,
    borderRadius: 2.5,
  },
  pttWrap: {
    height: 156,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  pttRing: {
    position: 'absolute',
    borderWidth: 8,
  },
  pttCircle: {
    width: 122,
    height: 122,
    borderRadius: 61,
  },
  pttPressable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 61,
  },
  statusWrap: {
    alignItems: 'center',
    gap: 6,
  },
  statusPill: {
    minHeight: 28,
    borderWidth: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingVertical: 4,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  statusHint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  statusHintDanger: {
    color: colors.danger,
    fontWeight: '600',
  },
});
