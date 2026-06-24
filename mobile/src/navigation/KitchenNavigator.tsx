import React from 'react';
import { KitchenBoardScreen } from '@/screens/kitchen/KitchenBoardScreen';

/** Кухня и бар — единый экран без нижней навигации (как в PWA, выход в шапке). */
export function KitchenNavigator() {
  return <KitchenBoardScreen station="kitchen" />;
}

export function BarNavigator() {
  return <KitchenBoardScreen station="bar" />;
}
