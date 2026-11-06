import React from 'react';
import { type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomPanel } from './BottomPanel';
export function FullscreenSheet({ visible, onClose, onDismiss, children, style }: {
  visible: boolean; onClose: () => void; onDismiss?: () => void; children: React.ReactNode; style?: ViewStyle;
}) {
  const nodes = React.Children.toArray(children);
  const first = nodes[0];
  let header: React.ReactNode;
  if (React.isValidElement<{ children?: React.ReactNode; edges?: string[] }>(first) && first.type === SafeAreaView) {
    const parts = React.Children.toArray(first.props.children);
    header = parts.shift();
    nodes[0] = React.cloneElement(first, { edges: first.props.edges?.filter(edge => edge !== 'top' && edge !== 'bottom'), children: parts });
  }
  return <BottomPanel visible={visible} onClose={onClose} onDismiss={onDismiss} expanded headerContent={header}
    panelStyle={{ ...style, width: '100%', maxWidth: 1120, alignSelf: 'center' }} bodyStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
    {nodes}
  </BottomPanel>;
}
