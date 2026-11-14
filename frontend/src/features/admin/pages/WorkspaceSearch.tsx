export function WorkspaceSearch({ value, onChange, label, placeholder = 'Быстрый поиск', className = '' }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  return <div className={`poster-search ${className}`}>
    <svg className="poster-search-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" />
    </svg>
    <input type="search" className="input" aria-label={label} placeholder={placeholder} value={value}
      autoComplete="off" onChange={(event) => onChange(event.target.value)} />
    {value && <button type="button" className="poster-search-clear" aria-label={`Очистить: ${label}`} onClick={() => onChange('')}>
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 6 12 12M18 6 6 18" /></svg>
    </button>}
  </div>;
}
