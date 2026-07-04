import React from 'react';
import { Image } from 'react-native';

/** Логотип EDU POS (тот же ассет, что в PWA). */
export function BrandLogo({ size = 'header' }: { size?: 'header' | 'login' }) {
  // Сохраняем родное соотношение сторон ассета (1254×352 ≈ 3.563).
  const h = size === 'login' ? 56 : 30;
  const w = Math.round(h * 3.563);
  return (
    <Image
      source={require('../../assets/logo.png')}
      style={{ height: h, width: w }}
      resizeMode="contain"
    />
  );
}
