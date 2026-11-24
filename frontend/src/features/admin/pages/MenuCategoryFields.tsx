import { useId, useRef, useState } from 'react';
import { Select } from '@/components/Select';
import { downscaleToDataUrl, resolveApiImage } from '@/lib/image';
import { menuCategoryOptions } from '@/lib/menu-category-scope';
import { MenuTaxSelect } from '../../settings/MenuTaxSelect';
import { useAdminCategories, type AdminCategory, type MenuCategoryInput } from '../api';

export function useMenuCategoryDraft(category?: AdminCategory) {
  const initialTax = !category || category.taxMode === 'inherit' ? '' : category.taxId ?? 'exempt';
  const [parentId, setParentId] = useState(category?.parentId ?? '');
  const [tax, setTax] = useState(initialTax);
  const [newImage, setImage] = useState<string>();
  const [uploading, setUploading] = useState(false);
  function input(): Omit<MenuCategoryInput, 'name'> {
    const fields: Omit<MenuCategoryInput, 'name'> = {};
    if (!category || parentId !== (category.parentId ?? '')) fields.parentId = parentId || null;
    if (!category || tax !== initialTax) {
      fields.taxMode = tax === '' ? 'inherit' : tax === 'exempt' ? 'none' : 'explicit';
      if (fields.taxMode === 'explicit') fields.taxId = tax;
    }
    if (newImage !== undefined) fields.imageUrl = newImage;
    return fields;
  }
  return { parentId, setParentId, tax, setTax, image: newImage ?? category?.imageUrl, setImage,
    uploading, setUploading, input };
}

export function MenuCategoryFields({ draft, editingId, disabled }: {
  draft: ReturnType<typeof useMenuCategoryDraft>; editingId?: string; disabled: boolean;
}) {
  const categories = useAdminCategories();
  const fileInput = useRef<HTMLInputElement>(null);
  const fileId = useId();
  const [error, setError] = useState('');
  const items = categories.data ?? [];
  const parent = draft.parentId ? items.find((category) => category.id === draft.parentId)
    : items.find((category) => category.id.startsWith('menu-root:'));
  async function readPhoto(file: File) {
    setError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Выберите фотографию в формате JPG, PNG или WebP.');
      return;
    }
    draft.setUploading(true);
    try { draft.setImage(await downscaleToDataUrl(file, 600)); }
    catch { setError('Не удалось прочитать фотографию. Выберите другой файл.'); }
    finally { draft.setUploading(false); }
  }
  return <>
    <Select ariaLabel="Родительская категория" className="w-full" value={draft.parentId} onChange={draft.setParentId}
      disabled={disabled || categories.isPending || categories.isError}
      options={[{ value: '', label: 'Главный экран' }, ...menuCategoryOptions(items, { excludeId: editingId })]} />
    {categories.isError && <button type="button" className="text-sm text-primary" onClick={() => void categories.refetch()}>Загрузить категории повторно</button>}
    <MenuTaxSelect ariaLabel="Налог категории" value={draft.tax} onChange={draft.setTax} inherit parentCategory
      categoryTaxId={parent?.taxId} disabled={disabled} />
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor={fileId} className="text-sm font-semibold">Фотография категории</label>
      {draft.image && <img alt="Фотография категории" src={resolveApiImage(draft.image) ?? undefined} className="h-12 w-16 rounded object-cover" />}
      <input ref={fileInput} id={fileId} className="sr-only" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp"
        disabled={disabled || draft.uploading} onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void readPhoto(file);
        }} />
      <button type="button" className="btn-secondary btn-md" disabled={disabled || draft.uploading}
        onClick={() => fileInput.current?.click()}>{draft.uploading ? 'Загрузка…' : draft.image ? 'Заменить…' : 'Загрузить…'}</button>
      {draft.image && !disabled && <button type="button" className="text-sm text-danger" disabled={draft.uploading}
        onClick={() => { draft.setImage(''); setError(''); }}>Удалить фото</button>}
    </div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </>;
}
