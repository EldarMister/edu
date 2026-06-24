import React from 'react';
import { Image } from 'react-native';

/** Логотип EDU POS (тот же ассет, что в PWA). */
export function BrandLogo({ size = 'header' }: { size?: 'header' | 'login' }) {
  const h = size === 'login' ? 48 : 30;
  const w = size === 'login' ? 170 : 104;
  return (
    <Image
      source={require('../../assets/logo.png')}
      style={{ height: h, width: w }}
      resizeMode="contain"
    />
  );
}
