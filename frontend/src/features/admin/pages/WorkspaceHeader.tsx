import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type HeaderSlots = {
  title: HTMLDivElement | null;
  actions: HTMLDivElement | null;
  count: HTMLSpanElement | null;
  setTitle: (node: HTMLDivElement | null) => void;
  setActions: (node: HTMLDivElement | null) => void;
  setCount: (node: HTMLSpanElement | null) => void;
};
const HeaderContext = createContext<HeaderSlots | null>(null);

export function WorkspaceHeaderProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<HTMLDivElement | null>(null);
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const [count, setCount] = useState<HTMLSpanElement | null>(null);
  const value = useMemo(() => ({ title, actions, count, setTitle, setActions, setCount }), [title, actions, count]);
  return <HeaderContext.Provider value={value}>{children}</HeaderContext.Provider>;
}

export function WorkspaceTitleSlot({ children }: { children: ReactNode }) {
  const slots = useContext(HeaderContext);
  return <div className="workspace-title-container min-w-0">
    <div ref={slots?.setTitle} className="workspace-title-slot" />
    <div className="workspace-default-title flex min-w-0 items-baseline gap-3">{children}<span ref={slots?.setCount} className="workspace-header-count" /></div>
  </div>;
}

export function WorkspaceActionsSlot() {
  const slots = useContext(HeaderContext);
  return <div ref={slots?.setActions} className="workspace-actions-slot flex flex-wrap items-center gap-2" />;
}

export function WorkspaceHeaderTitle({ children }: { children: ReactNode }) {
  const slots = useContext(HeaderContext);
  return slots?.title ? createPortal(children, slots.title) : <div className="mb-5">{children}</div>;
}

export function WorkspaceHeaderActions({ children }: { children: ReactNode }) {
  const slots = useContext(HeaderContext);
  return slots?.actions ? createPortal(children, slots.actions) : <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function WorkspaceHeaderCount({ count }: { count?: number }) {
  const slots = useContext(HeaderContext);
  if (count == null || !slots?.count) return null;
  return createPortal(<span aria-label={`Записей: ${count}`}>{count}</span>, slots.count);
}
