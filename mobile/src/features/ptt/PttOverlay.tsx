import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
} from './types';

const WAITER_NAV_BAR_HEIGHT = 56;
const WAITER_CART_BAR_HEIGHT = 65;

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

function Waveform({ active }: { active: boolean }) {
  const [phase, setPhase] = React.useState(0);
  React.useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setPhase((value) => (value + 1) % 6), 150);
    return () => clearInterval(id);
  }, [active]);

  const bars = [8, 10, 14, 16, 24, 34, 26, 20, 32, 42, 54, 74, 46, 34, 28, 22, 30, 36, 32, 24, 18, 14, 10, 8];
  return (
    <View style={styles.waveWrap}>
      <View style={styles.waveCircleSmall} />
      <View style={styles.waveCircleLarge} />
      <View style={styles.waveBars}>
        {bars.map((height, index) => {
          const distance = Math.abs(index - (bars.length - 1) / 2);
          const strong = distance < 5;
          const liveHeight = active ? height + ((phase + index) % 3) * 6 : height;
          return (
            <View
              key={`${height}-${index}`}
              style={[
                styles.waveBar,
                {
                  height: liveHeight,
                  backgroundColor: strong ? colors.primary : 'rgba(0,91,255,0.22)',
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

export function PttOverlay() {
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user);
  const connected = useConnectionStatus();
  const isWaiter = user?.role === 'WAITER';
  const [open, setOpen] = React.useState(false);
  const [enabled, setEnabled] = React.useState(true);
  const [channel, setChannel] = React.useState<PttChannel>(() => defaultChannelForRole(user?.role));
  const [onlineCount, setOnlineCount] = React.useState(1);
  const [busySpeakerId, setBusySpeakerId] = React.useState<string | null>(null);
  const selected = React.useMemo(
    () => PTT_CHANNELS.find((item) => item.key === channel) ?? PTT_CHANNELS[0],
    [channel],
  );
  const sender = useAudioPttSender(channel, enabled);
  const receiver = useAudioPttReceiver(channel, enabled);
  const activeWave = sender.talking || receiver.receiving;
  const floatingBottom = isWaiter
    ? WAITER_NAV_BAR_HEIGHT + WAITER_CART_BAR_HEIGHT + insets.bottom + spacing.xl
    : insets.bottom + spacing.xl;
  const sheetBottomInset = isWaiter ? WAITER_NAV_BAR_HEIGHT + insets.bottom : undefined;

  const joinChannel = React.useCallback(() => {
    const sock = getSocket();
    sock.emit(PTT_EVENTS.JOIN, { channel }, (ack: { ok?: boolean; onlineCount?: number } | undefined) => {
      if (ack?.ok && typeof ack.onlineCount === 'number') setOnlineCount(ack.onlineCount);
    });
  }, [channel]);

  React.useEffect(() => {
    setChannel(defaultChannelForRole(user?.role));
  }, [user?.role]);

  React.useEffect(() => {
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

  React.useEffect(() => {
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

  const busyByOther = !!busySpeakerId && busySpeakerId !== user?.id;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Рация"
        onPress={() => {
          setEnabled(true);
          setOpen(true);
        }}
        style={[styles.floatButton, { bottom: floatingBottom }]}
      >
        <MaterialCommunityIcons name="radio-handheld" size={37} color={colors.white} />
        <View style={[styles.onlineDot, { backgroundColor: connected ? colors.success : colors.textLight }]} />
      </Pressable>

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        sheet
        maxHeight="88%"
        bottomInset={sheetBottomInset}
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

        <View style={styles.channelCard}>
          <View style={styles.channelIcon}>
            <MaterialCommunityIcons name="radio-handheld" size={34} color={colors.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.channelTitle} numberOfLines={1}>Канал: {selected.label}</Text>
            <View style={styles.onlineLine}>
              <View style={styles.greenDot} />
              <Text style={styles.onlineText}>{onlineCount} {staffPlural(onlineCount)} онлайн</Text>
            </View>
          </View>
        </View>

        <Waveform active={activeWave} />

        <Text style={styles.hint}>Говорите в канал «{selected.label}»</Text>
        {sender.deniedReason || (busyByOther && !sender.talking) ? (
          <Text style={styles.denied}>{sender.deniedReason ?? 'Канал занят'}</Text>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            disabled={!enabled || busyByOther}
            onPressIn={() => void sender.start()}
            onPressOut={sender.stop}
            style={[
              styles.talkButton,
              sender.talking && styles.talkButtonActive,
              (!enabled || busyByOther) && styles.disabled,
            ]}
          >
            <MaterialCommunityIcons name="radio-handheld" size={33} color={colors.white} />
            <Text style={styles.talkText} numberOfLines={1}>Зажмите для разговора</Text>
          </Pressable>
          <Pressable onPress={disableRadio} style={styles.powerButton}>
            <Ionicons name="power" size={19} color={colors.textSecondary} />
            <Text style={styles.powerText} numberOfLines={1}>Отключить</Text>
          </Pressable>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  floatButton: {
    position: 'absolute',
    right: spacing.xl,
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 90,
    ...softShadow,
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 8,
  },
  onlineDot: {
    position: 'absolute',
    right: 3,
    top: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
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
    marginBottom: spacing.lg,
  },
  title: { fontSize: 26, fontWeight: '700', color: colors.textPrimary },
  closeBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channels: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  channelChip: {
    minHeight: 54,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
  },
  channelChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  channelText: { fontSize: fontSize.base, fontWeight: '500', color: colors.textSecondary },
  channelTextActive: { color: colors.white },
  channelCard: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  channelIcon: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  channelTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  onlineLine: { marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  greenDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.success },
  onlineText: { fontSize: fontSize.base, color: colors.textMuted },
  waveWrap: {
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  waveCircleSmall: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.primaryFaint,
  },
  waveCircleLarge: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    borderWidth: 34,
    borderColor: 'rgba(0,91,255,0.035)',
  },
  waveBars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  waveBar: {
    width: 6,
    borderRadius: 3,
  },
  hint: {
    textAlign: 'center',
    fontSize: fontSize.lg,
    fontWeight: '500',
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  denied: {
    textAlign: 'center',
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.danger,
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  talkButton: {
    flex: 1,
    minWidth: 0,
    height: 72,
    borderRadius: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
  },
  talkButtonActive: {
    backgroundColor: colors.primaryHover,
    transform: [{ scale: 0.98 }],
  },
  talkText: { flexShrink: 1, fontSize: fontSize.lg, fontWeight: '700', color: colors.white },
  powerButton: {
    height: 58,
    maxWidth: 116,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.sm,
  },
  powerText: { flexShrink: 1, fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary },
  disabled: { opacity: 0.58 },
});
