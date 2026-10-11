import React from 'react';
import { View, type ViewStyle, type StyleProp } from 'react-native';

/** PWA sections switch in place; only their specific dialogs animate. */
export function ScreenTransition({ children, style }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  transitionKey?: string;
}) {
  return <View style={style}>{children}</View>;
}
