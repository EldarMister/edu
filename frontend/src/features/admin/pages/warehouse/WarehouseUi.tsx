import { Children, cloneElement, isValidElement, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EditorFooterTarget } from './EditorPage';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';

export function QueryState({
  pending,
  error,
  empty,
  children,
}: {
  pending?: boolean;
  error?: unknown;
  empty?: boolean;
  children?: ReactNode;
}) {
  if (pending)
    return (
      <div className="flex justify-center p-10">
        <Spinner />
      </div>
    );
  if (error)
    return (
      <p role="alert" className="p-4 text-sm text-danger">
        {apiError(error)}
      </p>
    );
  if (empty)
    return (
      <div className="px-4 py-12 text-center">
        <p className="font-medium text-text-primary">Ничего не найдено</p>
        <p className="mt-1 text-sm text-text-muted">
          Измените поиск или фильтры, либо добавьте первую запись.
        </p>
      </div>
    );
  return <>{children}</>;
}

export function DocumentFooter({ children, total }: { children: ReactNode; total?: ReactNode }) {
  const target = useContext(EditorFooterTarget);
  const content = (
    <div className={target ? 'document-footer-content flex flex-wrap items-center justify-between gap-3' : 'document-footer sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'}>
      <div className="flex flex-wrap gap-2">{children}</div>
      {total != null && <div className="pr-16 text-sm font-medium text-text-primary">{total}</div>}
    </div>
  );
  return target ? createPortal(content, target) : content;
}

export function DocumentField({ label, children }: { label: string; children: ReactNode }) {
  const controls = Children.map(children, (child) => {
    if (isValidElement<{ 'aria-label'?: string; 'aria-labelledby'?: string }>(child) &&
      typeof child.type === 'string' && ['input', 'textarea', 'select'].includes(child.type) &&
      !child.props['aria-label'] && !child.props['aria-labelledby']) {
      return cloneElement(child, { 'aria-label': label });
    }
    return child;
  });
  return (
    <div role="group" aria-label={label} className="document-field grid items-start gap-1.5 text-sm sm:grid-cols-[190px_minmax(0,1fr)] sm:gap-5">
      <span className="document-field-label pt-2.5 text-text-secondary">{label}</span>
      <span className="document-field-control block min-w-0 sm:max-w-xl">{controls}</span>
    </div>
  );
}
