import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '@/components/Modal';
import { apiError } from '@/lib/api';
import { downscaleToDataUrl, resolveApiImage } from '@/lib/image';
import { IconPlus } from '../components/icons';

export function MenuEntryPhoto({ name, imageUrl, loading, onImage, onBusy, children }: {
  name: string; imageUrl: string; loading: boolean;
  onImage: (value: string) => void; onBusy: (value: boolean) => void; children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [photoUrl, setPhotoUrl] = useState('');
  const [error, setError] = useState('');

  function previewUrl() {
    if (loading || !photoUrl.trim()) return;
    try {
      const url = new URL(photoUrl.trim());
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
      onImage(url.href);
      setError('');
    } catch {
      setError('Укажите полную ссылку на фото, начинающуюся с https:// или http://.');
    }
  }

  function close() {
    if (!loading) setOpen(false);
  }

  return <>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      {imageUrl && <img src={resolveApiImage(imageUrl) ?? undefined} alt={name || 'Фото позиции'}
        className="h-[72px] w-24 rounded-md border border-border object-cover" />}
      <button type="button" className="btn-secondary btn-md inline-flex items-center gap-1.5" onClick={() => {
        setPhotoUrl(imageUrl.startsWith('http') ? imageUrl : '');
        setError('');
        setOpen(true);
      }}>
        {!imageUrl && <IconPlus className="h-4 w-4" aria-hidden="true" />}
        {imageUrl ? 'Изменить фото' : 'Добавить фото'}
      </button>
      {children}
    </div>
    {open && createPortal(<Modal open manageFocus title="Фото позиции" onClose={close} footer={
      <div className="flex justify-end"><button type="button" className="btn-primary btn-md" disabled={loading} onClick={close}>Готово</button></div>}>
      <div className="space-y-3">
        {imageUrl && <img src={resolveApiImage(imageUrl) ?? undefined} alt={name || 'Фото позиции'}
          className="h-24 w-32 rounded-md border border-border object-cover" />}
        <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
            setError('Фото можно загрузить в PNG, JPG или WEBP.');
            return;
          }
          onBusy(true);
          setError('');
          try {
            onImage(await downscaleToDataUrl(file));
            setPhotoUrl('');
          } catch (failure) {
            setError(apiError(failure));
          } finally {
            onBusy(false);
          }
        }} />
        <div className="flex flex-wrap gap-2">
          <button type="button" data-dialog-initial-focus className="btn-secondary btn-md" disabled={loading}
            onClick={() => input.current?.click()}>{loading ? 'Загрузка…' : imageUrl ? 'Заменить файл' : 'Выбрать файл'}</button>
          {imageUrl && <button type="button" className="btn-ghost btn-md text-danger" disabled={loading} onClick={() => {
            onImage(''); setPhotoUrl(''); setError('');
          }}>Удалить фото</button>}
        </div>
        <div className="flex flex-wrap gap-2">
          <input aria-label="Ссылка на фото" className="input min-w-0 flex-[1_1_11rem]" type="url" placeholder="https://…"
            value={photoUrl} disabled={loading} onChange={(event) => setPhotoUrl(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); previewUrl(); } }} />
          <button type="button" className="btn-secondary btn-md shrink-0" disabled={loading || !photoUrl.trim()}
            onClick={previewUrl}>По ссылке</button>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>, document.body)}
  </>;
}
