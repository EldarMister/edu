import React from 'react';
import { AppHeader } from './AppHeader';
import { BrandLogo } from './BrandLogo';
import { ShiftStatusBadge } from './ShiftStatusBadge';

/** Верхняя шапка официанта: логотип слева, соединение + статус смены справа. */
export function WaiterHeader() {
  return <AppHeader left={<BrandLogo />} right={<ShiftStatusBadge />} />;
}
