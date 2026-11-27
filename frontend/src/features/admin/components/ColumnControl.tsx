import { IconColumns } from './icons';

function ColumnCaption({ label }: { label: string }) {
  return <><IconColumns aria-hidden="true" /><span className="catalogue-action-label">{label}</span></>;
}

export function ColumnButton({ onClick, label = 'Столбцы', className = '' }: {
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return <button type="button" className={`workspace-tool ${className}`} title={label} aria-haspopup="dialog" data-disclosure onClick={onClick}>
    <ColumnCaption label={label} />
  </button>;
}

export function ColumnSummary({ label = 'Столбцы' }: { label?: string }) {
  return <summary className="workspace-tool" title={label} data-disclosure><ColumnCaption label={label} /></summary>;
}
