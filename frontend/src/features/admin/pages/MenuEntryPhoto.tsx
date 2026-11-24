import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { apiError } from '@/lib/api';
import { downscaleToDataUrl, resolveApiImage } from '@/lib/image';
import { IconPlus } from '../components/icons';
import { downloadMenuPhoto, searchMenuPhotos } from './menu-photo-search';

export function MenuEntryPhoto({ name, imageUrl, loading, onImage, onBusy, children }: {
  name: string; imageUrl: string; loading: boolean;
  onImage: (value: string) => void; onBusy: (value: boolean) => void; children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'search' | 'upload'>('search');
  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [error, setError] = useState('');
  const photos = useQuery({
    queryKey: ['menu-photos', searchTerm],
    queryFn: ({ signal }) => searchMenuPhotos(searchTerm, signal),
    enabled: open && tab === 'search' && !!searchTerm,
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  function search() {
    const term = query.trim();
    setError('');
    if (term && term === searchTerm) void photos.refetch();
    else setSearchTerm(term);
  }

  async function loadImage(loadFile: () => File | Promise<File>, closeAfter = false) {
    onBusy(true);
    setError('');
    try {
      const file = await loadFile();
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        throw new Error('Фото можно загрузить в PNG, JPG или WEBP.');
      }
      onImage(await downscaleToDataUrl(file));
      setPhotoUrl('');
      if (closeAfter) setOpen(false);
    } catch (failure) {
      setError(apiError(failure));
    } finally {
      onBusy(false);
    }
  }

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
        setTab('search');
        setQuery(name.trim());
        setSearchTerm(name.trim());
        setPhotoUrl(imageUrl.startsWith('http') ? imageUrl : '');
        setError('');
        setOpen(true);
      }}>
        {!imageUrl && <IconPlus className="h-4 w-4" aria-hidden="true" />}
        {imageUrl ? 'Изменить фото' : 'Добавить фото'}
      </button>
      {children}
    </div>
    {open && createPortal(<Modal open manageFocus title="Фото позиции" onClose={close} panelClassName="max-w-xl" toolbar={
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2" role="group" aria-label="Источник фотографии">
        <button type="button" className={tab === 'search' ? 'btn-secondary btn-md text-primary' : 'btn-ghost btn-md'}
          aria-pressed={tab === 'search'} disabled={loading} onClick={() => { setTab('search'); setError(''); }}>Поиск картинок</button>
        <button type="button" className={tab === 'upload' ? 'btn-secondary btn-md text-primary' : 'btn-ghost btn-md'}
          aria-pressed={tab === 'upload'} disabled={loading} onClick={() => { setTab('upload'); setError(''); }}>Загрузка</button>
        {imageUrl && <button type="button" className="btn-ghost btn-md ml-auto text-danger" disabled={loading} onClick={() => {
          onImage(''); setPhotoUrl(''); setError('');
        }}>Удалить фото</button>}
      </div>
    } footer={
      <div className="flex justify-end"><button type="button" className="btn-primary btn-md" disabled={loading} onClick={close}>Готово</button></div>}>
      <div className="space-y-3" aria-busy={loading}>
        {tab === 'search' ? <>
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); search(); }}>
            <input data-dialog-initial-focus type="search" aria-label="Поиск фото" className="input min-w-0 flex-1"
              placeholder="Например, бутерброд" value={query} maxLength={120} disabled={loading}
              onChange={(event) => setQuery(event.target.value)} />
            <button type="submit" className="btn-primary btn-md shrink-0" disabled={loading || !query.trim()}>Найти</button>
          </form>
          {!searchTerm ? <p className="text-sm text-text-secondary">Введите название блюда или продукта.</p>
            : photos.isFetching ? <p role="status" className="text-sm text-text-secondary">Ищем фотографии…</p>
            : photos.isError ? <p role="alert" className="text-sm text-danger">Поиск недоступен. Повторите запрос или загрузите фото с компьютера.</p>
            : !photos.data?.length ? <p role="status" className="text-sm text-text-secondary">Фото не нашлись. Попробуйте другой запрос.</p>
            : <>
              <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
                {photos.data.map((photo) => <button key={photo.id} type="button" disabled={loading}
                  className="aspect-[4/3] overflow-hidden rounded-md border border-border bg-background hover:border-primary focus-visible:outline focus-visible:outline-primary"
                  title={photo.title} onClick={() => void loadImage(() => downloadMenuPhoto(photo.url), true)}>
                  <img src={photo.url} alt={photo.title} loading="lazy" className="h-full w-full object-cover" />
                </button>)}
              </div>
              <p className="text-xs text-text-secondary">Источник фото · Wikimedia Commons</p>
            </>}
          {loading && <p role="status" className="text-sm text-text-secondary">Загружаем выбранное фото…</p>}
        </> : <>
          {imageUrl && <img src={resolveApiImage(imageUrl) ?? undefined} alt={name || 'Фото позиции'}
            className="h-24 w-32 rounded-md border border-border object-cover" />}
          <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void loadImage(() => file);
          }} />
          <button type="button" className="btn-secondary btn-md" disabled={loading}
            onClick={() => input.current?.click()}>{loading ? 'Загрузка…' : 'Выбрать файл'}</button>
          <details>
            <summary className="w-fit cursor-pointer text-sm text-primary">Добавить по ссылке</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <input aria-label="Ссылка на фото" className="input min-w-0 flex-[1_1_11rem]" type="url" placeholder="https://…"
                value={photoUrl} disabled={loading} onChange={(event) => setPhotoUrl(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); previewUrl(); } }} />
              <button type="button" className="btn-secondary btn-md shrink-0" disabled={loading || !photoUrl.trim()}
                onClick={previewUrl}>По ссылке</button>
            </div>
          </details>
        </>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>, document.body)}
  </>;
}
