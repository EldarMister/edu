import React from 'react';
import { Image } from 'react-native';
import { useThemeMode } from '@/theme/runtime';

/** Логотип EDU POS (тот же ассет, что в PWA). */
export function BrandLogo({ size = 'header' }: { size?: 'header' | 'login' }) {
  const mode = useThemeMode();
  // Сохраняем родное соотношение сторон ассета (1254×352 ≈ 3.563).
  const h = size === 'login' ? 48 : 32;
  const w = Math.round(h * 3.563);
  return (
    <Image
      source={require('../../assets/logo.png')}
      style={{ height: h, width: w, tintColor: mode === 'dark' ? '#FFFFFF' : undefined }}
      resizeMode="contain"
    />
  );
}
