const PHONE_CODES = ['+996', '+7'] as const;
type PhoneCode = (typeof PHONE_CODES)[number];

export const ACCOUNT_PHONE_ERROR = 'Введите 9 цифр после +996 или 10 цифр после +7.';

export function isAccountPhone(phone: string) {
  return /^(?:\+996\d{9}|\+7\d{10})$/.test(phone);
}

function splitPhone(value: string, fallback: PhoneCode = '+996') {
  const compact = value.replace(/[\s().-]/g, '');
  for (const code of PHONE_CODES) {
    if (compact.startsWith(code)) return { code, number: compact.slice(code.length) };
  }
  if (/^996\d{9}$/.test(compact)) return { code: '+996' as const, number: compact.slice(3) };
  if (/^[78]\d{10}$/.test(compact)) return { code: '+7' as const, number: compact.slice(1) };
  const number = fallback === '+996' && /^0\d{9}$/.test(compact) ? compact.slice(1) : compact;
  return { code: fallback, number };
}

export function PhoneInput({ id, value, onChange, disabled, autoComplete = 'off', compact = false }: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoComplete?: string;
  compact?: boolean;
}) {
  const { code, number } = splitPhone(value);
  return (
    <div className={`flex w-full min-w-0 overflow-hidden border border-border bg-white transition focus-within:border-primary
      ${compact ? 'h-9 rounded-md text-sm' : 'h-11 rounded-xl text-[15px]'}`}>
      <select
        aria-label="Код страны"
        className="w-[5.25rem] shrink-0 cursor-pointer border-r border-border bg-background pl-2 pr-1 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:cursor-default"
        value={code}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value + number.replace(/\D/g, ''))}
      >
        <option value="+996">+996</option>
        <option value="+7">+7</option>
      </select>
      <input
        id={id}
        aria-label="Номер телефона"
        className="min-w-0 flex-1 bg-transparent px-3 outline-none placeholder:text-text-light"
        type="tel"
        autoComplete={autoComplete}
        value={number}
        disabled={disabled}
        placeholder={code === '+996' ? '555 123 456' : '912 345-67-89'}
        required
        onChange={(event) => {
          const next = splitPhone(event.target.value, code);
          if (!/^\+?\d*$/.test(next.number)) return;
          onChange(next.number.startsWith('+') ? next.number : next.code + next.number);
        }}
      />
    </div>
  );
}
