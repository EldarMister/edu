import { useEffect, useRef, type RefObject } from 'react';

export function useDialogEscape(panel: RefObject<HTMLElement>, active: boolean, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented
        && panel.current === Array.from(document.querySelectorAll('[data-modal-panel]')).at(-1)) {
        event.preventDefault();
        close.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, panel]);
}
