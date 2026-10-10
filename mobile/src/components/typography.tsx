import React from 'react';
import {
  Alert as NativeAlert,
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextProps,
  type TextInputProps,
  type TextStyle,
  type StyleProp,
} from 'react-native';
import { useT, translate } from '@/lib/i18n';
import { useLocale } from '@/store/locale';

/** Android selects custom font weights by family, rather than synthesizing Inter. */
function fontStyle(style: StyleProp<TextStyle>): TextStyle {
  const resolved = StyleSheet.flatten(style);
  if (resolved?.fontFamily && !resolved.fontFamily.startsWith('Inter')) return {};
  if (resolved?.fontFamily && !resolved.fontWeight) return { fontFamily: resolved.fontFamily, fontWeight: 'normal' };
  const weight = Number(resolved?.fontWeight === 'bold' ? 700 : resolved?.fontWeight) || 400;
  return { fontFamily: weight >= 700 ? 'Inter-Bold' : weight >= 600 ? 'Inter-SemiBold' : weight >= 500 ? 'Inter-Medium' : 'Inter', fontWeight: 'normal' };
}

export type Text = React.ElementRef<typeof NativeText>;
export const Text = React.forwardRef<Text, TextProps & { translate?: boolean }>(function Text(
  { children, style, translate: localized = false, accessibilityLabel, accessibilityHint, ...props }, ref,
) {
  const t = useT();
  const content = localized ? React.Children.map(children, child => typeof child === 'string' ? t(child) : child) : children;
  return <NativeText {...props} ref={ref} style={[style, fontStyle(style)]} accessibilityLabel={accessibilityLabel ? t(accessibilityLabel) : undefined} accessibilityHint={accessibilityHint ? t(accessibilityHint) : undefined}>{content}</NativeText>;
});

export type TextInput = NativeTextInput;
export const TextInput = Object.assign(React.forwardRef<TextInput, TextInputProps>(function TextInput(
  { style, placeholder, accessibilityLabel, accessibilityHint, ...props }, ref,
) {
  const t = useT();
  return <NativeTextInput {...props} ref={ref} style={[style, fontStyle(style)]} placeholder={placeholder ? t(placeholder) : undefined} accessibilityLabel={accessibilityLabel ? t(accessibilityLabel) : undefined} accessibilityHint={accessibilityHint ? t(accessibilityHint) : undefined} />;
}), { State: NativeTextInput.State });

/** Native confirmation dialogs read the current locale at the moment they open. */
export const Alert: typeof NativeAlert = {
  ...NativeAlert,
  prompt: NativeAlert.prompt,
  alert(title, message, buttons, options) {
    const locale = useLocale.getState().locale;
    NativeAlert.alert(translate(title, locale), message ? translate(message, locale) : message, buttons?.map(button => ({ ...button, text: button.text ? translate(button.text, locale) : button.text })), options);
  },
};
