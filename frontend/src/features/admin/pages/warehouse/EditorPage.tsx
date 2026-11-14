import { createContext, useCallback, useState, type ReactNode } from 'react';
import { WorkspaceHeaderTitle } from '../WorkspaceHeader';

export const EditorFooterTarget = createContext<HTMLDivElement | null>(null);

export function EditorPage({ title, onClose, children, footer, open = true }: {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  open?: boolean;
  panelClassName?: string;
}) {
  const [footerTarget, setFooterTarget] = useState<HTMLDivElement | null>(null);
  const focusHeading = useCallback((heading: HTMLHeadingElement | null) => {
    if (open) heading?.focus({ preventScroll: true });
  }, [open]);
  if (!open) return null;
  return (
    <EditorFooterTarget.Provider value={footerTarget}>
    <section className="min-w-0 bg-white text-text-primary" aria-label={title} data-editor-page>
      <WorkspaceHeaderTitle>
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onClose} className="workspace-back shrink-0 text-primary" aria-label="Назад">
            <svg width="20" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 5-7 7 7 7" /></svg>
          </button>
          <h1 ref={focusHeading} tabIndex={-1} className="text-xl font-semibold outline-none lg:text-2xl">{title}</h1>
        </div>
      </WorkspaceHeaderTitle>
      <div className="editor-content min-w-0 pb-6">{children}</div>
      <div ref={setFooterTarget} className="editor-footer sticky bottom-0 z-20 border-t border-border bg-white px-1 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">{footer}</div>
    </section>
    </EditorFooterTarget.Provider>
  );
}
