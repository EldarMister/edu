import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { colors } from '@/theme';

/** The native launch screen continues while fonts and the saved session load. */
export function IntroSplash() {
  return (
    <View style={styles.root}>
      <Image source={require('../../assets/app-icon.png')} resizeMode="contain"
        accessibilityLabel="EDU POS" style={styles.logo} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  logo: { width: 240, height: 240 },
});
