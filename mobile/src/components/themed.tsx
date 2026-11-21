import React from 'react';
import {
  View as NativeView, ScrollView as NativeScrollView, FlatList as NativeFlatList,
  ActivityIndicator as NativeActivityIndicator, RefreshControl as NativeRefreshControl,
  type ViewProps, type ScrollViewProps, type FlatListProps, type ActivityIndicatorProps, type RefreshControlProps,
} from 'react-native';
import { SafeAreaView as NativeSafeAreaView, type SafeAreaViewProps } from 'react-native-safe-area-context';
import { ThemeScope, useThemeColor, useThemedStyle, useThemeMode } from '@/theme/runtime';

export type View = NativeView;
export const View = React.forwardRef<NativeView, ViewProps>(function View({ style, ...props }, ref) {
  return <NativeView {...props} ref={ref} style={useThemedStyle(style)} />;
});

/** QR/receipt artwork keeps its physical white background in either app theme. */
export const PaperView = React.forwardRef<NativeView, ViewProps>(function PaperView({ style, children, ...props }, ref) {
  return <ThemeScope mode="light"><NativeView {...props} ref={ref} style={[{ backgroundColor: '#FFFFFF' }, style]}>{children}</NativeView></ThemeScope>;
});

export type ScrollView = NativeScrollView;
export const ScrollView = React.forwardRef<NativeScrollView, ScrollViewProps>(function ScrollView({ style, contentContainerStyle, indicatorStyle, ...props }, ref) {
  const mode = useThemeMode();
  return <NativeScrollView {...props} ref={ref} style={useThemedStyle(style)} contentContainerStyle={useThemedStyle(contentContainerStyle)} indicatorStyle={indicatorStyle ?? (mode === 'dark' ? 'white' : 'black')} />;
});

export type FlatList<T> = NativeFlatList<T>;
export const FlatList = React.forwardRef(function FlatList<T>({ style, contentContainerStyle, columnWrapperStyle, ListHeaderComponentStyle, ListFooterComponentStyle, ...props }: FlatListProps<T>, ref: React.ForwardedRef<NativeFlatList<T>>) {
  return <NativeFlatList {...props} ref={ref} style={useThemedStyle(style)} contentContainerStyle={useThemedStyle(contentContainerStyle)} columnWrapperStyle={useThemedStyle(columnWrapperStyle)} ListHeaderComponentStyle={useThemedStyle(ListHeaderComponentStyle)} ListFooterComponentStyle={useThemedStyle(ListFooterComponentStyle)} />;
}) as <T>(props: FlatListProps<T> & React.RefAttributes<NativeFlatList<T>>) => React.ReactElement;

export const SafeAreaView = React.forwardRef<NativeView, SafeAreaViewProps>(function SafeAreaView({ style, ...props }, ref) {
  return <NativeSafeAreaView {...props} ref={ref} style={useThemedStyle(style)} />;
});

export function ActivityIndicator({ color, style, ...props }: ActivityIndicatorProps) {
  const map = useThemeColor();
  return <NativeActivityIndicator {...props} color={map(color ?? '#005BFF')} style={useThemedStyle(style)} />;
}

export function RefreshControl({ colors, tintColor, progressBackgroundColor, style, ...props }: RefreshControlProps) {
  const map = useThemeColor();
  return <NativeRefreshControl {...props} colors={colors?.map((color) => map(color))} tintColor={map(tintColor ?? '#005BFF')} progressBackgroundColor={map(progressBackgroundColor ?? '#FFFFFF', 'backgroundColor')} style={useThemedStyle(style)} />;
}
