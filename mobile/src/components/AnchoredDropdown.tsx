import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Modal, Platform, StyleSheet, useWindowDimensions, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HandTargetModal } from '@/features/hand-control/targets';
import { useRadioOverlayBlocker } from '@/features/ptt/radioVisibility';
import { colors, radius } from '@/theme';
import { anchoredSelectPosition, type SelectAnchor } from '@/utils/anchoredSelect';
import { FastPressable } from './FastPressable';
import { View } from './themed';

type Props = {
  label?: string;
  disabled?: boolean;
  buttonStyle: ViewStyle | (ViewStyle | false | undefined)[];
  width: number;
  height: number;
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
};

export function AnchoredDropdown({ label, disabled = false, buttonStyle, width, height, trigger, children }: Props) {
  const button = useRef<View>(null);
  const popup = useRef<View>(null);
  const dimensions = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [viewport, setViewport] = useState({ width: dimensions.width, height: dimensions.height });
  const [anchor, setAnchor] = useState<SelectAnchor | null>(null);
  const visible = !!anchor && !disabled;
  const request = useRef(0);
  useRadioOverlayBlocker(visible);

  function close() {
    request.current += 1;
    Keyboard.dismiss();
    setAnchor(null);
  }

  function measure() {
    const id = ++request.current;
    button.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
      if (request.current === id && measuredWidth > 0 && measuredHeight > 0) {
        setAnchor({ x, y, width: measuredWidth, height: measuredHeight });
      }
    });
  }

  useEffect(() => () => { request.current += 1; }, []);
  useEffect(() => {
    if (disabled) {
      request.current += 1;
      setAnchor(null);
    }
  }, [disabled]);

  const position = anchor && anchoredSelectPosition(anchor, viewport, { width, height }, {
    top: Platform.OS === 'ios' ? insets.top : 0,
    bottom: Platform.OS === 'ios' ? insets.bottom : 0,
    left: insets.left,
    right: insets.right,
  });

  return <>
    <FastPressable ref={button} collapsable={false} accessibilityRole="button"
      accessibilityLabel={label} accessibilityState={{ disabled, expanded: visible }} disabled={disabled}
      style={[buttonStyle, visible && styles.focus, disabled && styles.disabled]}
      onPress={() => {
        if (visible) return close();
        Keyboard.dismiss();
        measure();
      }}>
      {trigger(visible)}
    </FastPressable>
    {visible && position && <Modal transparent hardwareAccelerated animationType="none" onRequestClose={close} onShow={measure}>
      <HandTargetModal>
        <View style={styles.viewport} accessibilityViewIsModal onAccessibilityEscape={close} onLayout={({ nativeEvent }) => {
          const { width: nextWidth, height: nextHeight } = nativeEvent.layout;
          setViewport((current) => current.width === nextWidth && current.height === nextHeight ? current : { width: nextWidth, height: nextHeight });
          measure();
        }}>
          <FastPressable style={StyleSheet.absoluteFill} accessibilityLabel="Закрыть список" accessibilityRole="button"
            onPress={close} handExclude={popup} />
          <View ref={popup} collapsable={false} style={[styles.popup, position]}>
            {children(close)}
          </View>
        </View>
      </HandTargetModal>
    </Modal>}
  </>;
}

const styles = StyleSheet.create({
  viewport: { flex: 1 },
  focus: { borderColor: colors.primary },
  disabled: { opacity: 0.5 },
  popup: {
    position: 'absolute', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
    borderRadius: radius.md, padding: 4, elevation: 12, shadowColor: '#000',
    shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 5 },
  },
});
