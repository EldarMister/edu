import React from 'react';
import { AppState, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Text } from '@/components/typography';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import * as ScreenOrientation from 'expo-screen-orientation';
import { API_BASE } from '@/config/env';
import { Button, Loading } from '@/components/ui';
import { FastPressable } from '@/components/FastPressable';
import { ScreenTransition } from '@/components/ScreenTransition';
import type { RootStackParamList } from '@/navigation/types';
import { QueueVoice } from '@/services/queueVoice';
import { colors } from '@/theme';

interface QueueOrder {
  id: string;
  orderNumber: string;
  tableNumber: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}
interface QueueBoard {
  enabled: boolean;
  mode: 'table' | 'number';
  cafeName: string;
  preparing: QueueOrder[];
  ready: QueueOrder[];
}
const STATUS: Record<string, string> = {
  sent_to_kitchen: 'Новый',
  accepted_by_kitchen: 'Принят',
  cooking: 'Готовится',
  partially_rejected: 'Изменён',
  ready: 'Готов',
};

export function QueueScreen() {
  const params = useRoute<RouteProp<RootStackParamList, 'Queue'>>().params ?? {};
  const { width } = useWindowDimensions();
  const tablet = width >= 640;
  const narrow = width < 380;
  const q = useQuery({
    queryKey: ['queue', params.code, params.cafe],
    queryFn: async () => (await axios.get<QueueBoard>(`${API_BASE}/queue`, {
      params: params.code ? { code: params.code } : { cafe: params.cafe },
      timeout: 15000,
    })).data,
    refetchInterval: 5000,
  });
  const [now, setNow] = React.useState(Date.now);
  const [soundOn, setSoundOn] = React.useState(false);
  const announced = React.useRef<Set<string> | null>(null);
  const voice = React.useMemo(() => new QueueVoice(params.code ? { code: params.code } : { cafe: params.cafe }), [params.code, params.cafe]);
  React.useEffect(() => {
    void ScreenOrientation.unlockAsync().catch(() => undefined);
    return () => { void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined); };
  }, []);
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const state = AppState.addEventListener('change', next => {
      if (next !== 'active') { voice.disable(); setSoundOn(false); }
    });
    return () => { clearInterval(timer); state.remove(); voice.disable(); };
  }, [voice]);
  React.useEffect(() => { announced.current = null; setSoundOn(false); }, [voice]);
  React.useEffect(() => {
    if (!q.data?.enabled) return;
    const ids = new Set(q.data.ready.map(item => item.id));
    if (announced.current) for (const item of q.data.ready) if (!announced.current.has(item.id)) voice.enqueue(item.id);
    announced.current = ids;
  }, [q.data, voice]);
  const toggleSound = () => {
    if (soundOn) voice.disable(); else voice.enable();
    setSoundOn(!soundOn);
  };
  const clock = new Date(now).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return <SafeAreaView style={styles.safe}>
    {q.isLoading ? <Loading /> : !q.data ? <View style={styles.emptyScreen}>
      <Text style={styles.errorText} translate>Не удалось загрузить табло очереди</Text>
      <Button title="Повторить" size="md" onPress={() => void q.refetch()} />
    </View> : !q.data.enabled ? <View style={styles.emptyScreen}>
      <Text style={styles.disabledTitle} translate>Экран очереди отключён</Text>
      <Text style={styles.disabledHint} translate>Включите его в настройках кафе (раздел «Экран очереди заказов»).</Text>
    </View> : <View style={styles.board}>
      <View style={[styles.header, tablet && styles.headerTablet]}>
        <View style={styles.headerCell}>
          <Text numberOfLines={1} style={[styles.heading, narrow && styles.headingNarrow, width >= 480 && styles.headingWide, tablet && styles.headingTablet]} translate>Готовятся</Text>
        </View>
        <Text numberOfLines={1} style={[styles.clock, tablet && styles.clockTablet]}>{clock}</Text>
        <View style={[styles.headerCell, styles.readyHeading, tablet && styles.readyHeadingTablet]}>
          <FastPressable
            onPress={toggleSound}
            accessibilityRole="button"
            accessibilityLabel={soundOn ? 'Звук включён' : 'Включить звук'}
            accessibilityState={{ selected: soundOn }}
            hitSlop={6}
            style={({ pressed }) => [styles.soundButton, tablet && styles.soundButtonTablet, soundOn && styles.soundButtonActive, pressed && styles.soundButtonPressed]}
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={soundOn ? colors.success : colors.textMuted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M11 5 6 9H2v6h4l5 4V5Z" />
              <Path d={soundOn ? 'M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14' : 'm22 9-6 6M16 9l6 6'} />
            </Svg>
          </FastPressable>
          <Text numberOfLines={1} style={[styles.heading, narrow && styles.headingNarrow, width >= 480 && styles.headingWide, tablet && styles.headingTablet]} translate>Готовы</Text>
        </View>
      </View>
      <View style={styles.columns}>
        <QueueColumn board={q.data} orders={q.data.preparing} now={now} side="preparing" tablet={tablet} narrow={narrow} />
        <QueueColumn board={q.data} orders={q.data.ready} now={now} side="ready" tablet={tablet} narrow={narrow} />
      </View>
      <Text style={[styles.footer, tablet && styles.footerTablet]} translate>Очередь заказов</Text>
    </View>}
  </SafeAreaView>;
}

function QueueColumn({ board, orders, now, side, tablet, narrow }: {
  board: QueueBoard;
  orders: QueueOrder[];
  now: number;
  side: 'preparing' | 'ready';
  tablet: boolean;
  narrow: boolean;
}) {
  const ready = side === 'ready';
  return <View style={[styles.column, !ready && styles.columnBorder]}>
    {orders.length === 0 ? <View style={styles.emptyColumn}>
      <Text style={[styles.emptyText, tablet && styles.emptyTextTablet]} translate>{ready ? 'Готовых заказов нет' : 'Заказов в работе нет'}</Text>
    </View> : <ScrollView style={styles.scroll} contentContainerStyle={styles.rows} showsVerticalScrollIndicator={false}>
      {orders.map((order, index) => {
        const highlight = ready && index === 0;
        const since = Date.parse(ready ? order.updatedAt : order.createdAt);
        const elapsed = Number.isFinite(since) ? Math.max(0, Math.floor((now - since) / 60_000)) : 0;
        return <ScreenTransition key={order.id}>
          <View style={[styles.row, narrow && styles.rowNarrow, tablet && styles.rowTablet, highlight && styles.highlight]}>
            <View style={[styles.rowInfo, tablet && styles.rowInfoTablet]}>
              <Text numberOfLines={1} style={[styles.time, narrow && styles.timeNarrow, tablet && styles.timeTablet, highlight && styles.highlightTime]}>
                {elapsed > 0 ? <>{elapsed} <Text translate>мин</Text></> : <Text translate>сейчас</Text>}
              </Text>
              <Text numberOfLines={1} style={[styles.status, narrow && styles.statusNarrow, tablet && styles.statusTablet, highlight && styles.highlightStatus]} translate={!!STATUS[order.status]}>{STATUS[order.status] ?? order.status}</Text>
            </View>
            <Text numberOfLines={1} style={[styles.number, narrow && styles.numberNarrow, tablet && styles.numberTablet, ready && styles.readyNumber, highlight && styles.white]}>{String(board.mode === 'table' ? order.tableNumber : order.orderNumber).padStart(2, '0')}</Text>
          </View>
        </ScreenTransition>;
      })}
    </ScrollView>}
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  board: { flex: 1, backgroundColor: colors.white },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 16, borderBottomWidth: 2, borderBottomColor: colors.border },
  headerTablet: { paddingHorizontal: 40, paddingVertical: 20 },
  headerCell: { flex: 1, minWidth: 0 },
  heading: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
  headingNarrow: { fontSize: 18 },
  headingWide: { fontSize: 24 },
  headingTablet: { fontSize: 36 },
  clock: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', letterSpacing: -0.5, fontVariant: ['tabular-nums'], color: colors.textSecondary },
  clockTablet: { fontSize: 30 },
  readyHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  readyHeadingTablet: { gap: 16 },
  soundButton: { width: 32, height: 32, flexShrink: 0, borderRadius: 999, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  soundButtonTablet: { width: 38, height: 38 },
  soundButtonActive: { backgroundColor: colors.successSoft, borderColor: 'rgba(22, 163, 74, 0.4)' },
  soundButtonPressed: { opacity: 0.65 },
  columns: { flex: 1, minHeight: 0, flexDirection: 'row' },
  column: { flex: 1, minWidth: 0 },
  columnBorder: { borderRightWidth: 2, borderRightColor: colors.border },
  scroll: { flex: 1 },
  rows: { flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 12, paddingVertical: 16 },
  rowNarrow: { gap: 6, paddingHorizontal: 8 },
  rowTablet: { gap: 16, paddingHorizontal: 40, paddingVertical: 20 },
  rowInfo: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rowInfoTablet: { gap: 24 },
  time: { width: 48, flexShrink: 0, fontSize: 13, fontWeight: '500', fontVariant: ['tabular-nums'], color: colors.textMuted },
  timeNarrow: { width: 40, fontSize: 11 },
  timeTablet: { width: 80, fontSize: 16 },
  status: { flex: 1, minWidth: 0, fontSize: 14, color: colors.textSecondary },
  statusNarrow: { fontSize: 12 },
  statusTablet: { fontSize: 20 },
  number: { flexShrink: 0, color: colors.textPrimary, fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  numberNarrow: { fontSize: 34 },
  numberTablet: { fontSize: 60 },
  readyNumber: { color: colors.success },
  highlight: { backgroundColor: colors.success },
  highlightTime: { color: 'rgba(255, 255, 255, 0.8)' },
  highlightStatus: { color: 'rgba(255, 255, 255, 0.9)' },
  white: { color: colors.white },
  emptyColumn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  emptyText: { fontSize: 15, color: colors.textMuted, textAlign: 'center' },
  emptyTextTablet: { fontSize: 18 },
  footer: { backgroundColor: colors.textPrimary, color: colors.white, textAlign: 'center', paddingVertical: 12, paddingHorizontal: 12, fontWeight: '600', fontSize: 18, letterSpacing: 0.5 },
  footerTablet: { paddingVertical: 16, fontSize: 24 },
  emptyScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 8 },
  errorText: { fontSize: 20, color: colors.textMuted, textAlign: 'center', marginBottom: 12 },
  disabledTitle: { fontSize: 24, fontWeight: '600', color: colors.textPrimary, textAlign: 'center' },
  disabledHint: { fontSize: 16, color: colors.textMuted, textAlign: 'center' },
});
