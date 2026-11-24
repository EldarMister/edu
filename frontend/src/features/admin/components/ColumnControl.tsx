import { IconColumns } from './icons';
import './column-control.css';

function ColumnCaption({ label }: { label: string }) {
  return <><IconColumns aria-hidden="true" /><span className="catalogue-action-label">{label}</span></>;
}

export function ColumnButton({ onClick, label = 'Столбцы', className = '' }: {
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return <button type="button" className={`column-control ${className}`} title={label} aria-haspopup="dialog" onClick={onClick}>
    <ColumnCaption label={label} />
  </button>;
}

export function ColumnSummary({ label = 'Столбцы' }: { label?: string }) {
  return <summary className="column-control" title={label}><ColumnCaption label={label} /></summary>;
}
