import React from 'react';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { colors, fontSize } from '@/theme';
import type { CartLine } from '@/types';

const noteStyle = { color: colors.textSecondary, fontSize: fontSize.sm };
const exclusionStyle = { color: colors.warning, fontSize: fontSize.sm };

export function ModifierSummary({ details }: {
  details: Pick<CartLine, 'modifierSelections' | 'excludedIngredientNames'>;
}) {
  const { modifierSelections, excludedIngredientNames } = details;
  if (!modifierSelections?.length && !excludedIngredientNames?.length) return null;
  return (
    <View style={{ gap: 2 }}>
      {modifierSelections?.map(({ optionId, name, quantity }) => (
        <Text key={optionId} style={noteStyle}>+ {name} ×{quantity}</Text>
      ))}
      {excludedIngredientNames?.length ? (
        <Text style={exclusionStyle}><Text translate>Без</Text> {excludedIngredientNames.join(', ')}</Text>
      ) : null}
    </View>
  );
}
