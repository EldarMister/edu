import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { minDishUnitPrice, money, variantNamesLine } from '@/lib/format';
import { resolveApiImage } from '@/lib/image';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from './WorkspaceHeader';
import { WorkspaceSearch } from './WorkspaceSearch';
import { DocumentField } from './warehouse/WarehouseUi';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import {
  routingOptions,
  usePreparationStations,
  usePreparationStationUpdates,
  type PreparationStation,
} from '@/features/kitchen/stations';
import { IconTrash, IconPlus } from '../components/icons';
import type { MenuView } from './warehouse/navigation';
import { MenuStockCatalogue } from './warehouse/MenuStockCatalogue';
import { EditorPage } from './warehouse/EditorPage';
import { useEditorRoute, usePageFilter } from './warehouse/workspace-route';
import { MenuEntryPage } from './MenuEntryPage';
import {
  useAdminCategories,
  useAdminDishes,
  useAdminSets,
  useCategoryMutations,
  useDishMutations,
  useSetMutations,
  type AdminDish,
  type AdminCategory,
} from '../api';

export function MenuPage({
  view = 'goods',
}: { view?: MenuView; onView?: (v: MenuView) => void } = {}) {
  if (view === 'ingredients' || view === 'preparations')
    return <MenuStockCatalogue key={view} view={view} />;
  if (view === 'categories') return <MenuCategoriesPage />;
  return <MenuDishList key={view} view={view} />;
}
function MenuDishList({ view }: { view: MenuView }) {
  const [categoryId, setCategoryId] = usePageFilter('category');
  const [search, setSearch] = usePageFilter('search');
  const [, setParams] = useSearchParams();
  const location = useLocation();
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const stations = usePreparationStations().data ?? [];
  usePreparationStationUpdates();
  const categoriesQ = useAdminCategories();
  const dishesQ = useAdminDishes(categoryId, search);
  const { remove } = useDishMutations();
  const push = useNotifications((state) => state.push);
  const isGoods = view === 'goods';
  const { can } = usePermissions();
  const editable = can('actions.editMenu');
  function clearFilters() {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete('search');
        next.delete('category');
        return next;
      },
      { replace: true, state: location.state },
    );
  }
  const rows = (dishesQ.data ?? []).filter(
    (dish) =>
      (dish.catalogKind ?? (dish.hasDirectStock ? 'goods' : 'recipe')) ===
      (isGoods ? 'goods' : 'recipe'),
  );
  async function onDelete(dish: AdminDish) {
    if (!confirm(`Удалить «${dish.name}» из меню?`)) return;
    try {
      await remove.mutateAsync(dish.id);
      push({ message: 'Позиция удалена', at: new Date().toISOString() });
    } catch (failure) {
      push({ message: apiError(failure), at: new Date().toISOString() });
    }
  }
  if (editor?.type === 'categories' || editor?.type === 'category') return <MenuCategoriesPage />;
  if (editor?.type === 'set')
    return editor.id ? (
      <ExistingSetPage key={editor.id} id={editor.id} stations={stations} onClose={closeEditor} />
    ) : (
      <SetModal set={null} stations={stations} onClose={closeEditor} />
    );
  return (
    <div className="min-w-0">
      <WorkspaceHeaderCount count={dishesQ.isSuccess ? rows.length : undefined} />
      {editable && (
        <WorkspaceHeaderActions>
          {!isGoods && (
            <MenuActions
              ariaLabel="Другие действия"
              onChange={(action) => {
                if (action === 'set') openEditor({ type: 'set' });
              }}
              options={[{ value: 'set', label: 'Добавить сет' }]}
            />
          )}
          <button
            aria-label={isGoods ? 'Добавить товар' : 'Добавить техкарту'}
            className="btn-primary btn-md"
            onClick={() => openEditor({ type: 'entry' })}
          >
            Добавить
          </button>
        </WorkspaceHeaderActions>
      )}
      {editor?.type === 'entry' && (
        <MenuEntryPage
          id={editor.id}
          kind={isGoods ? 'goods' : 'recipe'}
          categoryId={categoryId}
          initialTab={editor.action === 'recipe' ? 'recipe' : 'main'}
          onClose={closeEditor}
        />
      )}
      <div className="poster-toolbar">
        <WorkspaceSearch
          label={isGoods ? 'Поиск товаров' : 'Поиск техкарт'}
          value={search}
          onChange={setSearch}
        />
        <Select
          ariaLabel="Категория"
          className="h-9 w-48 border-0 bg-transparent text-primary"
          value={categoryId}
          onChange={setCategoryId}
          options={[
            { value: '', label: 'Все категории' },
            ...(categoriesQ.data ?? []).map((category) => ({
              value: category.id,
              label: category.name,
            })),
          ]}
        />
      </div>
      {categoriesQ.isError && (
        <ListLoadError
          error={categoriesQ.error}
          onRetry={() => void categoriesQ.refetch()}
          pending={categoriesQ.isFetching}
        />
      )}
      {dishesQ.isPending ? (
        <div className="py-12">
          <Spinner />
        </div>
      ) : dishesQ.isError ? (
        <ListLoadError
          error={dishesQ.error}
          onRetry={() => void dishesQ.refetch()}
          pending={dishesQ.isFetching}
        />
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="py-3 pr-4 font-normal">Название</th>
                <th className="px-4 py-3 font-normal">Категория</th>
                {!isGoods && <th className="px-4 py-3 font-normal">Выход</th>}
                <th className="px-4 py-3 text-right font-normal">Цена</th>
                <th className="px-4 py-3 font-normal">Статус</th>
                <th>
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((dish) => (
                <tr key={dish.id} className="border-b border-border hover:bg-background/40">
                  <td className="py-3 pr-4">
                    <button
                      className="flex items-center gap-3 text-left"
                      onClick={() =>
                        openEditor({ type: dish.isSet ? 'set' : 'entry', id: dish.id })
                      }
                    >
                      <span className="h-9 w-12 shrink-0">
                        {dish.imageUrl && (
                          <img
                            src={resolveApiImage(dish.imageUrl) ?? undefined}
                            alt=""
                            className="h-9 w-12 rounded-sm object-cover"
                          />
                        )}
                      </span>
                      <span>
                        <span className="font-medium text-text-primary">{dish.name}</span>
                        {dish.isSet && <span className="ml-2 text-xs text-text-muted">Сет</span>}
                        {dish.variants.length > 0 && (
                          <span className="mt-0.5 block text-xs text-text-muted">
                            {variantNamesLine(dish.variants)}
                          </span>
                        )}
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{dish.category.name}</td>
                  {!isGoods && (
                    <td className="px-4 py-3 text-text-secondary">{dishOutput(dish)}</td>
                  )}
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {dish.variants.length
                      ? `от ${money(minDishUnitPrice(dish))}`
                      : money(dish.price)}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {dish.isAvailable && dish.isActive ? 'Доступен' : 'Скрыт'}
                  </td>
                  <td className="w-px px-3 py-3 text-right">
                    <div className="poster-row-actions">
                      {!isGoods && !dish.isSet && can('actions.warehouseRecipes') && (
                        <button
                          className="text-xs text-primary hover:underline"
                          onClick={() =>
                            openEditor({ type: 'entry', id: dish.id, action: 'recipe' })
                          }
                        >
                          Состав
                        </button>
                      )}
                      <button
                        className="text-xs text-primary hover:underline"
                        onClick={() =>
                          openEditor({ type: dish.isSet ? 'set' : 'entry', id: dish.id })
                        }
                      >
                        {editable ? 'Ред.' : 'Открыть'}
                      </button>
                      {editable && (
                        <MenuActions
                          ariaLabel={`Действия: ${dish.name}`}
                          disabled={remove.isPending}
                          onChange={(action) => {
                            if (action === 'delete') void onDelete(dish);
                          }}
                          options={[{ value: 'delete', label: 'Удалить' }]}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <div className="space-y-3 py-12 text-center text-sm text-text-muted" role="status">
              <p>
                {search || categoryId
                  ? 'Нет позиций по выбранным условиям'
                  : isGoods
                    ? editable
                      ? 'Добавьте первый товар для продажи'
                      : 'Товаров пока нет'
                    : editable
                      ? 'Добавьте первую техкарту'
                      : 'Техкарт пока нет'}
              </p>
              {(search || categoryId) && (
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={clearFilters}
                >
                  Сбросить поиск и категорию
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function dishOutput(dish: AdminDish) {
  const metadata = (
    dish as AdminDish & { recipeMetadata?: { outputQuantity?: number; outputUnit?: string } | null }
  ).recipeMetadata;
  return metadata?.outputQuantity != null
    ? `${metadata.outputQuantity} ${metadata.outputUnit ?? ''}`.trim()
    : '—';
}
function ListLoadError({
  error,
  onRetry,
  pending,
}: {
  error: unknown;
  onRetry: () => void;
  pending: boolean;
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 py-4 text-sm">
      <p className="text-danger">{apiError(error)}</p>
      <button
        type="button"
        className="text-primary hover:underline disabled:opacity-50"
        onClick={onRetry}
        disabled={pending}
      >
        {pending ? 'Загрузка…' : 'Повторить загрузку'}
      </button>
    </div>
  );
}
function ExistingSetPage({
  id,
  stations,
  onClose,
}: {
  id: string;
  stations: PreparationStation[];
  onClose: () => void;
}) {
  const setsQ = useAdminSets();
  if (setsQ.isPending)
    return (
      <EditorPage title="Сет" onClose={onClose}>
        <Spinner />
      </EditorPage>
    );
  if (setsQ.isError)
    return (
      <EditorPage title="Сет" onClose={onClose}>
        <ListLoadError
          error={setsQ.error}
          onRetry={() => void setsQ.refetch()}
          pending={setsQ.isFetching}
        />
      </EditorPage>
    );
  const set = setsQ.data.find((item) => item.id === id);
  if (!set)
    return (
      <EditorPage title="Сет не найден" onClose={onClose}>
        <p>Позиция удалена или недоступна.</p>
      </EditorPage>
    );
  return <SetModal key={id} set={set} stations={stations} onClose={onClose} />;
}
function MenuCategoriesPage() {
  const categoriesQ = useAdminCategories();
  const stations = usePreparationStations().data ?? [];
  usePreparationStationUpdates();
  const [search, setSearch] = usePageFilter('search');
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const { can } = usePermissions();
  const editable = can('actions.editMenu');
  const { reorder } = useCategoryMutations();
  const push = useNotifications((state) => state.push);
  const [deleteTarget, setDeleteTarget] = useState<AdminCategory | null>(null);
  const sorted = [...(categoriesQ.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const rows = sorted.filter((category) =>
    category.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const stationNames = new Map(
    routingOptions(stations).map((station) => [station.value, station.label]),
  );
  for (const station of stations) stationNames.set(station.id, station.name);
  async function move(categoryId: string, offset: number) {
    const index = sorted.findIndex((category) => category.id === categoryId),
      destination = index + offset;
    if (index < 0 || destination < 0 || destination >= sorted.length) return;
    const ids = sorted.map((category) => category.id);
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    try {
      await reorder.mutateAsync(ids);
    } catch (failure) {
      push({ message: apiError(failure), at: new Date().toISOString() });
    }
  }
  if (editor?.type === 'category') {
    if (categoriesQ.isPending)
      return (
        <EditorPage title="Категория" onClose={closeEditor}>
          <Spinner />
        </EditorPage>
      );
    if (categoriesQ.isError)
      return (
        <EditorPage title="Категория" onClose={closeEditor}>
          <ListLoadError
            error={categoriesQ.error}
            onRetry={() => void categoriesQ.refetch()}
            pending={categoriesQ.isFetching}
          />
        </EditorPage>
      );
    const category = sorted.find((item) => item.id === editor.id);
    if (editor.id && !category)
      return (
        <EditorPage title="Категория не найдена" onClose={closeEditor}>
          <p>Категория недоступна.</p>
        </EditorPage>
      );
    return (
      <MenuCategoryForm
        key={editor.id ?? 'new'}
        category={category}
        stations={stations}
        onClose={closeEditor}
      />
    );
  }
  return (
    <div className="min-w-0">
      <WorkspaceHeaderCount count={categoriesQ.isSuccess ? rows.length : undefined} />
      {editable && (
        <WorkspaceHeaderActions>
          <button
            aria-label="Добавить категорию"
            className="btn-primary btn-md"
            onClick={() => openEditor({ type: 'category' })}
          >
            Добавить
          </button>
        </WorkspaceHeaderActions>
      )}
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск категорий меню" value={search} onChange={setSearch} />
      </div>
      {categoriesQ.isPending ? (
        <Spinner />
      ) : categoriesQ.isError ? (
        <ListLoadError
          error={categoriesQ.error}
          onRetry={() => void categoriesQ.refetch()}
          pending={categoriesQ.isFetching}
        />
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="py-3 pr-4 font-normal">Название</th>
                <th className="px-4 py-3 font-normal">Цех</th>
                <th className="px-4 py-3 text-right font-normal">Позиций меню</th>
                <th>
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((category) => (
                <tr key={category.id} className="border-b border-border hover:bg-background/40">
                  <td className="py-4 pr-4">
                    <button
                      className="text-left text-text-primary"
                      onClick={() => openEditor({ type: 'category', id: category.id })}
                    >
                      {category.name}
                    </button>
                  </td>
                  <td className="px-4 py-4 text-text-secondary">
                    {stationNames.get(category.prepStation) ?? category.prepStation}
                  </td>
                  <td className="px-4 py-4 text-right">{category._count.dishes}</td>
                  <td className="w-px px-3 py-4 text-right">
                    <div className="poster-row-actions">
                      <button
                        className="text-xs text-primary hover:underline"
                        onClick={() => openEditor({ type: 'category', id: category.id })}
                      >
                        {editable ? 'Ред.' : 'Открыть'}
                      </button>
                      {editable && (
                        <MenuActions
                          ariaLabel={`Действия категории ${category.name}`}
                          disabled={reorder.isPending}
                          onChange={(action) => {
                            if (action === 'delete') setDeleteTarget(category);
                            else if (action === 'up') void move(category.id, -1);
                            else if (action === 'down') void move(category.id, 1);
                          }}
                          options={[
                            ...(sorted[0]?.id === category.id
                              ? []
                              : [{ value: 'up', label: 'Поднять выше' }]),
                            ...(sorted.at(-1)?.id === category.id
                              ? []
                              : [{ value: 'down', label: 'Опустить ниже' }]),
                            { value: 'delete', label: 'Удалить' },
                          ]}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <div className="space-y-3 py-12 text-center text-sm text-text-muted" role="status">
              <p>
                {search
                  ? 'Категории по этому запросу не найдены'
                  : editable
                    ? 'Добавьте первую категорию товаров и техкарт'
                    : 'Категорий пока нет'}
              </p>
              {search && (
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setSearch('')}
                >
                  Сбросить поиск
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {deleteTarget && (
        <DeleteCategorySheet
          category={deleteTarget}
          categories={sorted}
          onDone={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
function MenuCategoryForm({
  category,
  stations,
  onClose,
}: {
  category?: AdminCategory;
  stations: PreparationStation[];
  onClose: () => void;
}) {
  const { create, update } = useCategoryMutations();
  const { can } = usePermissions();
  const editable = can('actions.editMenu');
  const [name, setName] = useState(category?.name ?? '');
  const [prepStation, setPrepStation] = useState(
    category?.prepStation ?? stations.find((station) => station.isActive)?.id ?? 'none',
  );
  const [error, setError] = useState('');
  const push = useNotifications((state) => state.push);
  const pending = create.isPending || update.isPending;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editable || pending) return;
    if (!name.trim()) {
      setError('Укажите название категории.');
      return;
    }
    setError('');
    try {
      if (category) await update.mutateAsync({ id: category.id, name: name.trim(), prepStation });
      else await create.mutateAsync({ name: name.trim(), prepStation });
      push({ message: 'Категория сохранена', at: new Date().toISOString() });
      onClose();
    } catch (failure) {
      setError(apiError(failure));
    }
  }
  return (
    <EditorPage
      title={category ? 'Редактирование категории' : 'Добавление категории'}
      onClose={onClose}
      footer={
        editable ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              form="menu-category-form"
              className="btn-primary btn-md"
              disabled={pending}
            >
              {pending ? 'Сохранение…' : 'Сохранить'}
            </button>
            <button className="btn-ghost btn-md" onClick={onClose} disabled={pending}>
              Отмена
            </button>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </div>
        ) : undefined
      }
    >
      <form id="menu-category-form" className="space-y-5" onSubmit={save}>
        <fieldset disabled={!editable || pending} className="min-w-0 space-y-5">
          <DocumentField label="Название">
            <input
              aria-label="Название категории"
              className="input"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
            />
          </DocumentField>
          <DocumentField label="Цех">
            <Select
              ariaLabel="Цех категории"
              className="h-11 w-full"
              value={prepStation}
              onChange={setPrepStation}
              options={routingOptions(stations, prepStation)}
            />
          </DocumentField>
        </fieldset>
      </form>
    </EditorPage>
  );
}

/** Подтверждение удаления категории: перенести блюда или удалить вместе с блюдами. */
function DeleteCategorySheet({
  category,
  categories,
  onDone,
}: {
  category: AdminCategory;
  categories: AdminCategory[];
  onDone: () => void;
}) {
  const { remove } = useCategoryMutations();
  const push = useNotifications((s) => s.push);
  const others = categories.filter((c) => c.id !== category.id);
  const [targetId, setTargetId] = useState(others[0]?.id ?? '');
  const hasDishes = category._count.dishes > 0;

  async function run(strategy?: 'move' | 'delete', targetCategoryId?: string) {
    try {
      await remove.mutateAsync({ id: category.id, strategy, targetCategoryId });
      push({ message: 'Категория удалена', at: new Date().toISOString() });
      onDone();
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  return (
    <Modal open onClose={onDone} title={`Удалить «${category.name}»`} panelClassName="max-w-md">
      {!hasDishes ? (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">В категории нет блюд. Удалить её?</p>
          <button
            className="btn-danger btn-lg w-full font-semibold"
            disabled={remove.isPending}
            onClick={() => run()}
          >
            {remove.isPending ? <Spinner /> : 'Удалить категорию'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            В категории {category._count.dishes} блюд. Что сделать с ними?
          </p>

          <div className="space-y-2 rounded-xl border border-border p-3">
            <p className="text-sm font-medium text-text-primary">
              Перенести блюда в другую категорию
            </p>
            {others.length === 0 ? (
              <p className="text-xs text-text-muted">Нет другой категории для переноса.</p>
            ) : (
              <div className="flex gap-2">
                <Select
                  className="h-10 min-w-0 flex-1"
                  value={targetId}
                  onChange={setTargetId}
                  options={others.map((c) => ({ value: c.id, label: c.name }))}
                />
                <button
                  className="btn-primary btn-md shrink-0"
                  disabled={remove.isPending || !targetId}
                  onClick={() => run('move', targetId)}
                >
                  {remove.isPending ? <Spinner /> : 'Перенести и удалить'}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
            <p className="text-sm font-medium text-danger">Удалить категорию вместе с блюдами</p>
            <p className="text-xs text-text-muted">
              Блюда полностью удалятся из меню. История заказов и чеки сохранятся.
            </p>
            <button
              className="btn-danger btn-md w-full font-semibold"
              disabled={remove.isPending}
              onClick={() => run('delete')}
            >
              {remove.isPending ? <Spinner /> : 'Удалить вместе с блюдами'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

interface SetCompDraft {
  uid: string;
  dishId: string;
  dishVariantId?: string;
  name: string;
  quantity: number;
  removable: boolean;
  replaceable: boolean;
}

function SetModal({
  set,
  stations,
  onClose,
}: {
  set: AdminDish | null;
  stations: PreparationStation[];
  onClose: () => void;
}) {
  const isEdit = !!set;
  const { can } = usePermissions();
  const editable = can('actions.editMenu');
  const { create, update } = useSetMutations();
  const push = useNotifications((s) => s.push);
  const [name, setName] = useState(set?.name ?? '');
  const [price, setPrice] = useState(set ? String(Number(set.price)) : '');
  const [prepStation, setPrepStation] = useState(set?.prepStation ?? '');
  const [components, setComponents] = useState<SetCompDraft[]>(() =>
    (set?.setComponents ?? []).map((c) => ({
      uid: c.id,
      dishId: c.dish.id,
      dishVariantId: c.dishVariant?.id,
      name: c.dishVariant ? `${c.dish.name} ${c.dishVariant.name}` : c.dish.name,
      quantity: c.quantity,
      removable: c.removable,
      replaceable: c.replaceable,
    })),
  );
  const [search, setSearch] = useState('');
  const dishesQ = useAdminDishes('', search.trim());
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  // Каждый вариант блюда — отдельный кандидат: «Coca-Cola 0.5 л» и «Coca-Cola 1 л» — разные строки.
  type Candidate = { dishId: string; dishVariantId?: string; name: string };
  const candidates: Candidate[] = (dishesQ.data ?? [])
    .filter((d) => !d.isSet && d.isActive)
    .flatMap((d): Candidate[] =>
      d.variants.length > 0
        ? d.variants.map((v) => ({
            dishId: d.id,
            dishVariantId: v.id,
            name: `${d.name} ${v.name}`,
          }))
        : [{ dishId: d.id, name: d.name }],
    )
    .filter(
      (c) => !components.some((x) => x.dishId === c.dishId && x.dishVariantId === c.dishVariantId),
    );

  function addComp(c: Candidate) {
    setComponents((cur) => [
      ...cur,
      {
        uid: `tmp-${c.dishId}-${c.dishVariantId ?? ''}-${Date.now()}`,
        dishId: c.dishId,
        dishVariantId: c.dishVariantId,
        name: c.name,
        quantity: 1,
        removable: true,
        replaceable: true,
      },
    ]);
  }
  function patch(uid: string, p: Partial<SetCompDraft>) {
    setComponents((cur) => cur.map((c) => (c.uid === uid ? { ...c, ...p } : c)));
  }

  async function onSubmit() {
    if (!editable || pending) return;
    setError('');
    const priceNum = Number(price);
    if (!name.trim()) return setError('Укажите название сета');
    if (!Number.isFinite(priceNum) || priceNum <= 0)
      return setError('Цена сета должна быть больше 0');
    if (components.length === 0) return setError('Добавьте блюда в состав сета');
    const body = {
      name: name.trim(),
      price: priceNum,
      prepStation: prepStation || null,
      components: components.map((c) => ({
        dishId: c.dishId,
        dishVariantId: c.dishVariantId,
        quantity: c.quantity,
        removable: c.removable,
        replaceable: c.replaceable,
      })),
    };
    try {
      if (isEdit) {
        await update.mutateAsync({ id: set!.id, ...body });
        push({ message: 'Сет обновлён', at: new Date().toISOString() });
      } else {
        await create.mutateAsync(body);
        push({ message: 'Сет создан', at: new Date().toISOString() });
      }
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <EditorPage
      open
      onClose={onClose}
      title={isEdit ? (editable ? 'Изменить сет' : set.name) : 'Новый сет'}
      panelClassName="max-w-xl"
      footer={
        editable ? (
          <button
            className="btn-primary btn-lg w-full font-semibold"
            disabled={pending}
            onClick={onSubmit}
          >
            {pending ? <Spinner /> : isEdit ? 'Сохранить' : 'Создать сет'}
          </button>
        ) : undefined
      }
    >
      <fieldset disabled={!editable || pending} className="min-w-0 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Название">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Сет-6"
            />
          </Field>
          <Field label="Цена (с)">
            <input
              className="input"
              type="number"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Куда отправлять сет">
          <Select
            className="h-11 w-full"
            value={prepStation}
            onChange={setPrepStation}
            options={[
              { value: '', label: 'По категории' },
              ...routingOptions(stations, prepStation),
            ]}
          />
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-text-secondary">Состав сета</p>
          {components.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-3 text-sm text-text-muted">
              {editable ? 'Добавьте блюда из списка ниже' : 'Состав сета не задан'}
            </p>
          ) : (
            <div className="space-y-1.5">
              {components.map((c) => (
                <div
                  key={c.uid}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-[15px] text-text-primary">
                    {c.name}
                  </span>
                  <input
                    className="input h-9 w-16 px-2 text-center"
                    type="number"
                    min="1"
                    value={c.quantity}
                    onChange={(e) =>
                      patch(c.uid, {
                        quantity: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                  />
                  <label className="flex items-center gap-1 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={c.removable}
                      onChange={(e) => patch(c.uid, { removable: e.target.checked })}
                    />
                    убирать
                  </label>
                  <label className="flex items-center gap-1 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={c.replaceable}
                      onChange={(e) => patch(c.uid, { replaceable: e.target.checked })}
                    />
                    заменять
                  </label>
                  {editable && (
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-danger hover:bg-danger/5"
                      onClick={() => setComponents((cur) => cur.filter((x) => x.uid !== c.uid))}
                      title="Убрать из состава"
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {editable && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-text-secondary">Добавить блюдо</p>
            <input
              className="input mb-2"
              placeholder="Поиск блюда"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {dishesQ.isPending ? (
              <Spinner />
            ) : dishesQ.isError ? (
              <ListLoadError
                error={dishesQ.error}
                onRetry={() => void dishesQ.refetch()}
                pending={dishesQ.isFetching}
              />
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {candidates.map((c) => (
                  <button
                    key={`${c.dishId}-${c.dishVariantId ?? ''}`}
                    type="button"
                    onClick={() => addComp(c)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-left transition-colors hover:border-primary/40"
                  >
                    <span className="min-w-0 flex-1 truncate text-[15px] text-text-primary">
                      {c.name}
                    </span>
                    <IconPlus className="h-4 w-4 shrink-0 text-primary" />
                  </button>
                ))}
                {candidates.length === 0 && (
                  <p className="py-3 text-center text-sm text-text-muted">Блюда не найдены</p>
                )}
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
      </fieldset>
    </EditorPage>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text-secondary">{label}</label>
      {children}
    </div>
  );
}

function MenuActions({
  ariaLabel,
  options,
  onChange,
  disabled = false,
}: {
  ariaLabel: string;
  options: { value: string; label: string }[];
  onChange: (action: string) => void;
  disabled?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const focusLast = useRef(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  function openMenu(last = false) {
    const rect = trigger.current!.getBoundingClientRect(),
      height = options.length * 40 + 8;
    focusLast.current = last;
    setPosition({
      left: Math.max(8, Math.min(rect.right - 192, window.innerWidth - 200)),
      top:
        rect.bottom + height + 8 > window.innerHeight
          ? Math.max(8, rect.top - height - 4)
          : rect.bottom + 4,
    });
  }
  function closeMenu() {
    setPosition(null);
    trigger.current?.focus();
  }
  useEffect(() => {
    if (!position) return;
    const buttons = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    buttons?.[focusLast.current ? buttons.length - 1 : 0]?.focus();
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setPosition(null);
    };
    const close = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) setPosition(null);
    };
    document.addEventListener('mousedown', outside);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [position]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={!!position}
        aria-controls={position ? menuId : undefined}
        disabled={disabled}
        className="flex h-8 w-10 items-center justify-center text-lg text-primary hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu(event.key === 'ArrowUp');
          }
        }}
        onClick={() => {
          if (position) {
            setPosition(null);
            return;
          }
          openMenu();
        }}
      >
        •••
      </button>
      {position &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label={ariaLabel}
            className="fixed z-[80] w-48 border border-border bg-white py-1 shadow-lg"
            style={position}
            onBlur={(event) => {
              if (
                event.relatedTarget !== trigger.current &&
                !event.currentTarget.contains(event.relatedTarget as Node | null)
              )
                setPosition(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeMenu();
              } else if (event.key === 'Tab') {
                closeMenu();
              } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
                );
                const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? buttons.length - 1
                      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              }
            }}
          >
            {options
              .filter((option) => option.value)
              .map((option) => (
                <button
                  key={option.value}
                  role="menuitem"
                  type="button"
                  tabIndex={-1}
                  className={`block w-full px-4 py-2.5 text-left text-sm hover:bg-background focus:bg-background focus:outline-none ${option.value === 'delete' ? 'text-danger' : 'text-text-secondary'}`}
                  onClick={() => {
                    closeMenu();
                    onChange(option.value);
                  }}
                >
                  {option.label}
                </button>
              ))}
          </div>,
          document.body,
        )}
    </>
  );
}
