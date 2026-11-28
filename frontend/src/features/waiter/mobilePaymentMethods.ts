const MOBILE_METHODS = [
  { value: 'qr', label: 'QR-код' },
  { value: 'cash', label: 'Наличные' },
  { value: 'card', label: 'Карта' },
  { value: 'mixed', label: 'Смешанная' },
] as const;

export function mobilePaymentMethods(enabled: readonly string[], hasQr: boolean, allowMixed: boolean) {
  const hasDirectOption = enabled.includes('cash') || (enabled.includes('qr') && hasQr);
  return MOBILE_METHODS.filter(({ value }) => {
    if (value === 'mixed') return allowMixed;
    if (value === 'card') return !hasDirectOption && enabled.includes(value);
    return enabled.includes(value);
  });
}
