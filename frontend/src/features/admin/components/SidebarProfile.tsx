import { useEffect, useId, useRef, useState } from 'react';
import { AppVersion } from '@/components/AppVersion';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { WorkspaceLinks } from '@/components/WorkspaceLinks';
import { useT } from '@/lib/i18n';
import { IconLogout } from './icons';
import { SidebarFlyout } from './SidebarFlyout';

export function SidebarProfile({ name, onLogout, compact = false }: { name?: string; onLogout: () => void; compact?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const caption = name?.trim() || t('Профиль');

  useEffect(() => {
    if (!open || compact) return;
    function onOutside(event: PointerEvent) {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) setOpen(false);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || !panel.current?.offsetWidth) return;
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open, compact]);

  const controls = <>
    <div className="px-2"><ThemeSwitch compact /></div>
    {compact && <WorkspaceLinks current="admin" />}
    <div className="mt-1 border-t border-border pt-1">
      <button type="button" onClick={onLogout}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-text-secondary hover:bg-background hover:text-text-primary">
        <IconLogout />{t('Выйти')}
      </button>
    </div>
    {compact && <AppVersion className="my-1" />}
  </>;

  return <div ref={panel} className={`relative shrink-0 border-t border-border ${compact ? 'px-2 py-3' : 'p-3'}`}>
    <button ref={button} type="button" aria-label={t('Профиль')} aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen((current) => !current)}
      title={compact ? t('Профиль') : undefined}
      className={`flex w-full items-center rounded-xl py-2 text-left text-[15px] font-medium hover:bg-background ${compact ? 'justify-center' : 'gap-2.5 px-2'} ${open ? 'bg-background' : ''}`}>
      <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary font-semibold text-white">
        {Array.from(caption)[0].toLocaleUpperCase()}
      </span>
      {!compact && <>
        <span className="min-w-0 flex-1 truncate text-text-primary">{caption}</span>
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
          className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="m3.5 6 4.5 4.5L12.5 6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </>}
    </button>
    {open && (compact
      ? button.current && <SidebarFlyout id={id} label={t('Профиль')} anchor={button.current} align="end" onClose={() => setOpen(false)}>
          {controls}
        </SidebarFlyout>
      : <section id={id} aria-label={t('Профиль')}
          className="absolute bottom-full left-3 right-3 z-30 mb-2 rounded-xl border border-border bg-card p-2 shadow-lg">
          {controls}
        </section>)}
    {!compact && <AppVersion className="mt-2" />}
  </div>;
}
