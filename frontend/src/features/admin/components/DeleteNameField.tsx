export function DeleteNameField({ label, value, disabled, onChange }: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return <label className="grid gap-1.5 text-sm text-text-secondary">
    {label}
    <input className="input w-full" value={value} disabled={disabled} autoComplete="off"
      onChange={(event) => onChange(event.target.value)} />
  </label>;
}
