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
import { colors } from '@/theme';

type Typography = {
  fontSize: number;
  lineHeight: number;
  fontWeight: TextStyle['fontWeight'];
  fontFamily: string;
};

// A nested Text is an inline span: it inherits the parent's size and weight.
const TypographyContext = React.createContext<Typography | undefined>(undefined);
const TAILWIND_LINE_HEIGHT: Record<number, number> = { 12: 16, 14: 20, 16: 24, 18: 28, 20: 28, 24: 32 };

function pwaLineHeight(size: number) {
  return TAILWIND_LINE_HEIGHT[size] ?? size * 1.4;
}

/** Android selects actual Inter weights by family, rather than synthesizing them. */
function typographyStyle(style: StyleProp<TextStyle>, parent?: Typography) {
  const resolved = StyleSheet.flatten(style) ?? {};
  const size = resolved.fontSize ?? parent?.fontSize ?? 15;
  const weight = resolved.fontWeight ?? parent?.fontWeight ?? '400';
  const numericWeight = Number(weight === 'bold' ? 700 : weight) || 400;
  const inheritedFamily = resolved.fontFamily ?? parent?.fontFamily;
  const family = inheritedFamily && !inheritedFamily.startsWith('Inter')
    ? inheritedFamily
    : inheritedFamily && resolved.fontWeight === undefined
      ? inheritedFamily
      : numericWeight >= 700 ? 'Inter-Bold' : numericWeight >= 600 ? 'Inter-SemiBold' : numericWeight >= 500 ? 'Inter-Medium' : 'Inter';
  const lineHeight = resolved.lineHeight
    ?? (resolved.fontSize === undefined ? parent?.lineHeight : undefined)
    ?? pwaLineHeight(size);
  const typography: Typography = { fontSize: size, lineHeight, fontWeight: weight, fontFamily: family };
  const nativeStyle: TextStyle = {
    fontFamily: family,
    fontWeight: family.startsWith('Inter') ? 'normal' : weight,
    lineHeight,
    includeFontPadding: false,
  };
  return { typography, nativeStyle };
}

export type Text = React.ElementRef<typeof NativeText>;
export const Text = React.forwardRef<Text, TextProps & { translate?: boolean }>(function Text(
  { children, style, translate: localized = false, accessibilityLabel, accessibilityHint, ...props }, ref,
) {
  const parent = React.useContext(TypographyContext);
  const { typography, nativeStyle } = typographyStyle(style, parent);
  const t = useT();
  const content = localized ? React.Children.map(children, child => typeof child === 'string' ? t(child) : child) : children;
  return (
    <TypographyContext.Provider value={typography}>
      <NativeText
        {...props}
        ref={ref}
        style={[!parent && { fontSize: 15, color: colors.textPrimary }, style, nativeStyle]}
        accessibilityLabel={accessibilityLabel ? t(accessibilityLabel) : undefined}
        accessibilityHint={accessibilityHint ? t(accessibilityHint) : undefined}
      >
        {content}
      </NativeText>
    </TypographyContext.Provider>
  );
});

export type TextInput = NativeTextInput;
export const TextInput = Object.assign(React.forwardRef<TextInput, TextInputProps>(function TextInput(
  { style, placeholder, accessibilityLabel, accessibilityHint, ...props }, ref,
) {
  const t = useT();
  const { nativeStyle } = typographyStyle(style);
  return <NativeTextInput {...props} ref={ref} style={[{ fontSize: 15, color: colors.textPrimary }, style, nativeStyle]} placeholder={placeholder ? t(placeholder) : undefined} accessibilityLabel={accessibilityLabel ? t(accessibilityLabel) : undefined} accessibilityHint={accessibilityHint ? t(accessibilityHint) : undefined} />;
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
