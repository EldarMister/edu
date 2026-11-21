import React from 'react';
import { StaffShiftGate } from '@/components/StaffShiftGate';
import { KitchenBoardScreen } from '@/screens/kitchen/KitchenBoardScreen';

/** Кухня и бар — единый экран без нижней навигации (как в PWA, выход в шапке). */
export function KitchenNavigator() {
  return <StaffShiftGate><KitchenBoardScreen defaultStation="kitchen" /></StaffShiftGate>;
}

export function BarNavigator() {
  return <StaffShiftGate><KitchenBoardScreen defaultStation="bar" /></StaffShiftGate>;
}
