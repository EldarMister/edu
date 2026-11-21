import React, { useState } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { View } from '@/components/themed';
import { colors } from '@/theme';
import type { FloorPlanTable } from '@/types';
import { floorPlanBounds } from '@/utils/floorPlan';

export function FloorPlanCanvas({ placements, fit = false, renderTable, style }: {
  placements: FloorPlanTable[];
  fit?: boolean;
  renderTable: (table: FloorPlanTable, style: ViewStyle, unit: number) => React.ReactNode;
  style?: ViewStyle;
}) {
  const [width, setWidth] = useState(0);
  const bounds = floorPlanBounds(placements, fit);
  const unit = width / bounds.columns;

  return <View style={[styles.canvas, style, { aspectRatio: bounds.columns / bounds.rows }]}
    onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    {unit > 0 ? placements.map((table) => renderTable(table, {
      position: 'absolute',
      left: (table.x - bounds.x) * unit,
      top: (table.y - bounds.y) * unit,
      width: table.width * unit,
      height: table.height * unit,
      borderRadius: table.shape === 'round' ? Math.min(table.width, table.height) * unit / 2 : 8,
    }, unit)) : null}
  </View>;
}

const styles = StyleSheet.create({
  canvas: { width: '100%', alignSelf: 'center', backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
});
