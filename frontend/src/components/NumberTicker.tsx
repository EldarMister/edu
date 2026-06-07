import { money } from '@/lib/format';

/**
 * Анимированное число со «слот-машинным» прокручиванием цифр при изменении.
 * Каждая цифра — это вертикальная колонка 0–9, которая сдвигается к нужной
 * позиции с плавной анимацией. Нецифровые символы (пробелы, «с») статичны.
 */
export function NumberTicker({
  value,
  format = money,
  className = '',
}: {
  value: number;
  /** Форматтер числа в строку (по умолчанию денежный формат). */
  format?: (n: number) => string;
  className?: string;
}) {
  const text = format(value);
  return (
    <span className={`inline-flex items-end leading-none [font-variant-numeric:tabular-nums] ${className}`}>
      {text.split('').map((ch, i) =>
        /\d/.test(ch) ? (
          <Digit key={i} digit={Number(ch)} />
        ) : (
          <span key={i} className="inline-block leading-none" style={{ whiteSpace: 'pre' }}>
            {ch}
          </span>
        ),
      )}
    </span>
  );
}

function Digit({ digit }: { digit: number }) {
  return (
    <span
      className="inline-block overflow-hidden align-bottom"
      style={{ height: '1em', lineHeight: '1em' }}
      aria-hidden
    >
      <span
        className="flex flex-col"
        style={{
          transform: `translateY(-${digit}em)`,
          transition: 'transform 600ms cubic-bezier(0.22, 1, 0.36, 1)',
          willChange: 'transform',
        }}
      >
        {Array.from({ length: 10 }, (_, n) => (
          <span key={n} className="flex items-center justify-center" style={{ height: '1em', lineHeight: '1em' }}>
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}
