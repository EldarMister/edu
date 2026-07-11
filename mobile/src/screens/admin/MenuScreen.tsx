import React, { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Select } from '@/components/Select';
import { Button, Toggle } from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme';
import { apiError } from '@/lib/api';
import { API_BASE } from '@/config/env';
import { useNotifications } from '@/store/notifications';
import { minDishUnitPrice, money, variantNamesLine } from '@/utils/format';
import { normalizeUnitLabel, unitLabelOptions } from '@/utils/units';
import {
  useAdminCategories,
  useAdminDishes,
  useCategoryMutations,
  useDishMutations,
  useMenuOverview,
  useSetMutations,
  type AdminCategory,
  type AdminDish,
  type AdminDishVariant,
} from '@/services/api/admin';
import type { PrepStation } from '@/types';

function resolveApiImage(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('data:') || url.startsWith('http')) return url;
  return `${API_BASE}${url.startsWith('/') ? url : `/${url}`}`;
}

const STATION_OPTIONS = [
  { value: '', label: 'Из категории' },
  { value: 'kitchen', label: 'Кухня' },
  { value: 'bar', label: 'Бар' },
  { value: 'none', label: 'Без отправки' },
];

function weightedBaseLabel(dish: Pick<AdminDish, 'weightedMeasure' | 'weightedPriceBase'>) {
  const small = dish.weightedMeasure === 'volume' ? 'мл' : 'г';
  const large = dish.weightedMeasure === 'volume' ? 'л' : 'кг';
  const base = dish.weightedPriceBase ?? 100;
  return base === 1000 ? `1 ${large}` : `${base} ${small}`;
}

/** Меню (владелец/админ) — порт PWA MenuPage (блюда + категории + сеты). */
export function MenuScreen() {
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [dishModal, setDishModal] = useState<AdminDish | null | 'new'>(null);
  const [setModal, setSetModal] = useState<AdminDish | null | 'new'>(null);
  const [catModal, setCatModal] = useState(false);

  const overview = useMenuOverview();
  const categoriesQ = useAdminCategories();
  const dishesQ = useAdminDishes(categoryId, search);
  const { remove } = useDishMutations();
  const push = useNotifications((s) => s.push);
  const o = overview.data;
  const categories = categoriesQ.data ?? [];

  const stationByCat = new Map(categories.map((c) => [c.id, c.prepStation ?? 'kitchen']));
  const dishStation = (d: AdminDish) => d.prepStation ?? stationByCat.get(d.categoryId) ?? 'kitchen';

  const onDelete = (d: AdminDish) =>
    Alert.alert('Удалить блюдо?', `«${d.name}» будет удалено.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          remove
            .mutateAsync(d.id)
            .then(() => push({ message: 'Блюдо удалено', at: new Date().toISOString() }))
            .catch((err) => push({ message: apiError(err), type: 'error', at: new Date().toISOString() })),
      },
    ]);

  const openEdit = (d: AdminDish) => {
    if (d.isSet) {
      setSetModal(d);
      return;
    }
    setDishModal(d);
  };

  const header = (
    <View style={styles.headerWrap}>
      <View style={styles.summary}>
        <Sum label="Блюд" value={o ? String(o.dishesCount) : '—'} />
        <Sep />
        <Sum label="Категорий" value={o ? String(o.categoriesCount) : '—'} />
        <Sep />
        <Sum label="Активных" value={o ? String(o.activeDishesCount) : '—'} />
      </View>

      <TextInput
        style={styles.search}
        placeholder="Поиск блюда"
        placeholderTextColor={colors.textLight}
        value={search}
        onChangeText={setSearch}
      />

      <View style={styles.headerBtns}>
        <Button title="+ Категория" variant="secondary" size="md" style={{ flex: 1 }} onPress={() => setCatModal(true)} />
        <Button
          title="+ Сет"
          variant="secondary"
          size="md"
          style={{ flex: 1 }}
          onPress={() => setSetModal('new')}
        />
      </View>
      <Button title="+ Добавить блюдо" size="md" onPress={() => setDishModal('new')} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        <CatTab active={categoryId === ''} onPress={() => setCategoryId('')} label="Все блюда" />
        {categories.map((c) => (
          <CatTab key={c.id} active={categoryId === c.id} onPress={() => setCategoryId(c.id)} label={c.name} />
        ))}
      </ScrollView>
    </View>
  );

  return (
    <>
      <FlatList
        data={dishesQ.data ?? []}
        keyExtractor={(d) => d.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item: d }) => (
          <DishRow dish={d} station={dishStation(d)} onEdit={() => openEdit(d)} onDelete={() => onDelete(d)} />
        )}
        ListEmptyComponent={
          dishesQ.isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <Text style={styles.empty}>Блюда не найдены</Text>
          )
        }
      />

      {dishModal !== null ? (
        <DishModal
          dish={dishModal === 'new' ? null : dishModal}
          categories={categories}
          defaultCategoryId={categoryId}
          onClose={() => setDishModal(null)}
        />
      ) : null}
      {setModal !== null ? <SetModal set={setModal === 'new' ? null : setModal} onClose={() => setSetModal(null)} /> : null}
      {catModal ? <CategoryModal categories={categories} onClose={() => setCatModal(false)} /> : null}
    </>
  );
}

function DishRow({
  dish: d,
  station,
  onEdit,
  onDelete,
}: {
  dish: AdminDish;
  station: PrepStation;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasVar = d.variants.length > 0;
  const stock = hasVar ? d.variants.reduce((a, v) => a + (v.stock ?? 0), 0) : d.stock ?? 0;
  const outOfStock = d.trackInventory && stock === 0;
  const status = outOfStock
    ? { label: 'Нет в наличии', bg: colors.dangerSoft, fg: colors.danger }
    : d.isActive && d.isAvailable
      ? { label: 'Активно', bg: colors.successSoft, fg: colors.success }
      : { label: 'Скрыто', bg: colors.slate100, fg: colors.textMuted };

  return (
    <View style={styles.dishRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.dishNameRow}>
          <Text style={styles.dishName} numberOfLines={1}>
            {d.name}
          </Text>
          {d.isSet ? <MiniBadge label="Сет" bg={colors.warningSoft} fg={colors.warning} /> : null}
          {d.isWeighted ? <MiniBadge label="Весовое" bg={colors.primarySoft} fg={colors.primary} /> : null}
          {station === 'bar' ? <MiniBadge label="Бар" bg={colors.primarySoft} fg={colors.primary} /> : null}
          {station === 'none' ? <MiniBadge label="Без отправки" bg={colors.slate100} fg={colors.textMuted} /> : null}
        </View>
        {hasVar ? <Text style={styles.variantsLine}>{variantNamesLine(d.variants)}</Text> : null}
        {d.description ? (
          <Text style={styles.dishDesc} numberOfLines={1}>
            {d.description}
          </Text>
        ) : null}
        <Text style={styles.dishMeta}>
          {d.category.name} · {hasVar ? `от ${money(minDishUnitPrice(d))}` : money(d.price)}
          {d.isWeighted ? ` за ${weightedBaseLabel(d)}` : ''}
          {d.trackInventory ? ` · ${stock} ${hasVar ? '' : normalizeUnitLabel(d.unit)}` : ''}
        </Text>
      </View>
      <View style={styles.dishRight}>
        <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
          <Text style={[styles.statusText, { color: status.fg }]}>{status.label}</Text>
        </View>
        <View style={styles.dishActions}>
          <FastPressable onPress={onEdit} hitSlop={6} style={styles.iconBtn}>
            <PwaIcon name="pencil" size={16} color={colors.textMuted} strokeWidth={2} />
          </FastPressable>
          <FastPressable onPress={onDelete} hitSlop={6} style={styles.iconBtn}>
            <PwaIcon name="trash" size={16} color={colors.danger} strokeWidth={2} />
          </FastPressable>
        </View>
      </View>
    </View>
  );
}

/* ---------- Модалка блюда ---------- */

interface VariantDraft {
  uid: string;
  id?: string;
  name: string;
  price: string;
  stock: string;
  unit: string;
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
function variantDraft(v?: AdminDishVariant): VariantDraft {
  return {
    uid: v?.id ?? `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    id: v?.id,
    name: v?.name ?? '',
    price: v ? String(Number(v.price)) : '',
    stock: v?.stock != null ? String(v.stock) : '',
    unit: normalizeUnitLabel(v?.unit),
  };
}

function DishModal({
  dish,
  categories,
  defaultCategoryId,
  onClose,
}: {
  dish: AdminDish | null;
  categories: AdminCategory[];
  defaultCategoryId: string;
  onClose: () => void;
}) {
  const isEdit = !!dish;
  const { create, update } = useDishMutations();
  const push = useNotifications((s) => s.push);
  const [name, setName] = useState(dish?.name ?? '');
  const [categoryId, setCategoryId] = useState(dish?.categoryId ?? (defaultCategoryId || categories[0]?.id || ''));
  const [price, setPrice] = useState(dish ? (dish.variants.length > 0 ? '' : String(Number(dish.price))) : '');
  const [stock, setStock] = useState(dish?.stock != null ? String(dish.stock) : '');
  const [unit, setUnit] = useState(normalizeUnitLabel(dish?.unit));
  const [description, setDescription] = useState(dish?.description ?? '');
  const [voiceName, setVoiceName] = useState(dish?.voiceName ?? '');
  const [isAvailable, setIsAvailable] = useState(dish?.isAvailable ?? true);
  const [isWeighted, setIsWeighted] = useState(dish?.isWeighted ?? false);
  const [weightedMeasure, setWeightedMeasure] = useState<'weight' | 'volume'>(dish?.weightedMeasure ?? 'weight');
  const [weightedPriceBase, setWeightedPriceBase] = useState(dish?.weightedPriceBase ?? 100);
  const [prepStation, setPrepStation] = useState<'' | 'kitchen' | 'bar' | 'none'>(dish?.prepStation ?? '');
  const [variants, setVariants] = useState<VariantDraft[]>(() => dish?.variants.map(variantDraft) ?? []);
  const [photoUrl, setPhotoUrl] = useState(dish?.imageUrl?.startsWith('http') ? dish.imageUrl : '');
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  const initialPreview = resolveApiImage(dish?.imageUrl ?? null);
  const preview = photoUrl.trim() ? photoUrl.trim() : initialPreview;

  const updateVariant = (uid: string, patch: Partial<VariantDraft>) =>
    setVariants((cur) => cur.map((v) => (v.uid === uid ? { ...v, ...patch } : v)));
  const moveVariant = (from: number, dir: -1 | 1) =>
    setVariants((cur) => {
      const to = from + dir;
      if (to < 0 || to >= cur.length) return cur;
      const next = [...cur];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });

  const onSubmit = async () => {
    setError('');
    if (!name.trim() || !categoryId) {
      setError('Заполните название и категорию');
      return;
    }
    const filled = variants
      .map((v) => ({ id: v.id, name: v.name.trim(), price: v.price.trim(), stock: v.stock.trim(), unit: v.unit }))
      .filter((v) => v.name || v.price);
    for (const v of filled) {
      const p = Number(v.price);
      if (!v.name || !v.price || !Number.isFinite(p) || p <= 0) {
        setError('У каждого варианта должны быть название и цена больше 0');
        return;
      }
    }
    const priceValue = price.trim() ? Number(price) : undefined;
    if (priceValue !== undefined && (!Number.isFinite(priceValue) || priceValue < 0)) {
      setError('Цена блюда должна быть числом');
      return;
    }
    if ((filled.length === 0 || isWeighted) && (!priceValue || priceValue <= 0)) {
      setError('Укажите цену блюда или добавьте варианты с ценами');
      return;
    }
    const trimmedUrl = photoUrl.trim();
    let imageUrl: string | undefined;
    if (trimmedUrl) {
      if (!/^https?:\/\/.+/i.test(trimmedUrl)) {
        setError('Ссылка на фото должна начинаться с https://');
        return;
      }
      if (trimmedUrl !== (dish?.imageUrl ?? '')) imageUrl = trimmedUrl;
    } else if (dish?.imageUrl) {
      imageUrl = '';
    }
    try {
      const body = {
        name: name.trim(),
        categoryId,
        price: priceValue,
        description: description.trim() || undefined,
        voiceName: voiceName.trim() || null,
        isAvailable,
        isWeighted,
        weightedMeasure,
        weightedPriceBase,
        imageUrl,
        prepStation: prepStation === '' ? null : prepStation,
        trackInventory: !isWeighted && (filled.length > 0 ? filled.some((v) => v.stock !== '') : stock.trim() !== ''),
        stock: !isWeighted && priceValue !== undefined ? (stock.trim() ? Number(stock) : undefined) : undefined,
        initialStock: !isWeighted && !isEdit && priceValue !== undefined ? (stock.trim() ? Number(stock) : undefined) : undefined,
        unit: !isWeighted && priceValue !== undefined ? unit : undefined,
        variants: isWeighted ? [] : filled.map((v) => ({
          id: v.id,
          name: v.name,
          price: Number(v.price),
          stock: v.stock ? Number(v.stock) : undefined,
          initialStock: (!isEdit || !v.id) && v.stock ? Number(v.stock) : undefined,
          unit: v.unit,
        })),
      };
      if (isEdit) {
        await update.mutateAsync({ id: dish!.id, ...body });
        push({ message: 'Блюдо обновлено', at: new Date().toISOString() });
      } else {
        await create.mutateAsync(body);
        push({ message: 'Блюдо добавлено', at: new Date().toISOString() });
      }
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  };

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={isEdit ? 'Изменить блюдо' : 'Новое блюдо'}
      maxHeight="92%"
      footer={<Button title={isEdit ? 'Сохранить' : 'Добавить'} size="lg" loading={pending} onPress={onSubmit} />}
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.md }}>
        <Field label="Название">
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Название блюда" placeholderTextColor={colors.textLight} />
        </Field>
        <Field label="Категория">
          <Select value={categoryId} onChange={setCategoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} title="Категория" />
        </Field>
        <Field label="Направление">
          <Select value={prepStation} onChange={(v) => setPrepStation(v as typeof prepStation)} options={STATION_OPTIONS} title="Направление" />
        </Field>
        <Field label="Цена">
          <TextInput style={styles.input} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textLight} />
        </Field>

        <View style={styles.checkRow}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={styles.checkLabel}>Весовое блюдо</Text>
            <Text style={styles.checkHint}>Количество выбирается в {weightedMeasure === 'weight' ? 'г / кг' : 'мл / л'}</Text>
          </View>
          <Toggle checked={isWeighted} onChange={setIsWeighted} />
        </View>
        {isWeighted ? (
          <View style={styles.weightedBox}>
            <Text style={styles.weightedTitle}>Параметры весового блюда</Text>
            <View style={styles.grid2}>
              <Field label="Единица" style={{ flex: 1 }}>
                <Select
                  value={weightedMeasure}
                  onChange={(value) => setWeightedMeasure(value as 'weight' | 'volume')}
                  options={[{ value: 'weight', label: 'г / кг' }, { value: 'volume', label: 'мл / л' }]}
                  title="Единица"
                />
              </Field>
              <Field label="Цена за" style={{ flex: 1 }}>
                <Select
                  value={String(weightedPriceBase)}
                  onChange={(value) => setWeightedPriceBase(Number(value))}
                  options={[1, 100, 1000].map((base) => ({ value: String(base), label: weightedBaseLabel({ weightedMeasure, weightedPriceBase: base }) }))}
                  title="Цена за"
                />
              </Field>
            </View>
            <Text style={styles.weightedHint}>Покупатель задаёт точное количество; стоимость пересчитывается автоматически.</Text>
          </View>
        ) : null}

        {variants.length === 0 && !isWeighted ? (
          <View style={styles.grid2}>
            <Field label="Остаток (склад)" style={{ flex: 1 }}>
              <TextInput style={styles.input} value={stock} onChangeText={setStock} keyboardType="decimal-pad" placeholder="—" placeholderTextColor={colors.textLight} />
            </Field>
            <Field label="Ед." style={{ width: 110 }}>
              <Select value={unit} onChange={setUnit} options={unitLabelOptions(unit)} title="Единица" />
            </Field>
          </View>
        ) : null}

        {/* Варианты */}
        {!isWeighted ? <View>
          <View style={styles.varHead}>
            <Text style={styles.fieldLabel}>Варианты</Text>
            <FastPressable onPress={() => setVariants((c) => [...c, variantDraft()])} hitSlop={6}>
              <Text style={styles.addVarText}>+ Добавить</Text>
            </FastPressable>
          </View>
          {variants.map((v, i) => (
            <View key={v.uid} style={styles.varRow}>
              <View style={styles.varMove}>
                <FastPressable onPress={() => moveVariant(i, -1)} hitSlop={4} disabled={i === 0}>
                  <View style={{ transform: [{ rotate: '180deg' }], opacity: i === 0 ? 0.3 : 1 }}>
                    <PwaIcon name="chevronDown" size={14} color={colors.textMuted} strokeWidth={2} />
                  </View>
                </FastPressable>
                <FastPressable onPress={() => moveVariant(i, 1)} hitSlop={4} disabled={i === variants.length - 1}>
                  <View style={{ opacity: i === variants.length - 1 ? 0.3 : 1 }}>
                    <PwaIcon name="chevronDown" size={14} color={colors.textMuted} strokeWidth={2} />
                  </View>
                </FastPressable>
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <TextInput style={styles.inputSm} value={v.name} onChangeText={(t) => updateVariant(v.uid, { name: t })} placeholder="Вариант" placeholderTextColor={colors.textLight} />
                <View style={styles.grid2}>
                  <TextInput style={[styles.inputSm, { flex: 1 }]} value={v.price} onChangeText={(t) => updateVariant(v.uid, { price: t })} keyboardType="decimal-pad" placeholder="Цена" placeholderTextColor={colors.textLight} />
                  <TextInput style={[styles.inputSm, { flex: 1 }]} value={v.stock} onChangeText={(t) => updateVariant(v.uid, { stock: t })} keyboardType="decimal-pad" placeholder="Остаток" placeholderTextColor={colors.textLight} />
                  <View style={{ width: 90 }}>
                    <Select value={v.unit} onChange={(u) => updateVariant(v.uid, { unit: u })} options={unitLabelOptions(v.unit)} title="Ед." />
                  </View>
                </View>
              </View>
              <FastPressable onPress={() => setVariants((c) => c.filter((x) => x.uid !== v.uid))} hitSlop={6} style={styles.iconBtn}>
                <PwaIcon name="trash" size={15} color={colors.danger} strokeWidth={2} />
              </FastPressable>
            </View>
          ))}
        </View> : null}

        <Field label="Описание">
          <TextInput style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} placeholder="Необязательно" placeholderTextColor={colors.textLight} multiline />
        </Field>
        <Field label="Название для озвучки">
          <TextInput style={styles.input} value={voiceName} onChangeText={setVoiceName} placeholder="Необязательно" placeholderTextColor={colors.textLight} />
        </Field>
        <Field label="Фото (ссылка https://)">
          <TextInput style={styles.input} value={photoUrl} onChangeText={setPhotoUrl} placeholder="https://…" placeholderTextColor={colors.textLight} autoCapitalize="none" />
        </Field>
        {preview ? <Image source={{ uri: preview }} style={styles.photoPreview} resizeMode="cover" /> : null}

        <View style={styles.checkRow}>
          <Text style={styles.checkLabel}>Доступно к заказу</Text>
          <Toggle checked={isAvailable} onChange={setIsAvailable} />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </BottomSheet>
  );
}

function SetModal({ set, onClose }: { set: AdminDish | null; onClose: () => void }) {
  const isEdit = !!set;
  const { create, update } = useSetMutations();
  const push = useNotifications((s) => s.push);
  const [name, setName] = useState(set?.name ?? '');
  const [price, setPrice] = useState(set ? String(Number(set.price)) : '');
  const [components, setComponents] = useState<SetCompDraft[]>(() =>
    (set?.setComponents ?? [])
      .map((component): SetCompDraft | null => {
        const dish = component.dish ?? component.dishVariant?.dish;
        if (!dish) return null;
        return {
          uid: component.id,
          dishId: dish.id,
          name: component.dishVariant ? `${dish.name} ${component.dishVariant.name}` : dish.name,
          quantity: component.quantity,
          removable: component.removable,
          replaceable: component.replaceable,
          ...(component.dishVariant?.id ? { dishVariantId: component.dishVariant.id } : {}),
        };
      })
      .filter((component): component is SetCompDraft => component !== null),
  );
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const dishesQ = useAdminDishes('', search.trim());
  const pending = create.isPending || update.isPending;

  type Candidate = { dishId: string; dishVariantId?: string; name: string };
  const candidates: Candidate[] = (dishesQ.data ?? [])
    .filter((dish) => !dish.isSet && dish.isActive)
    .flatMap((dish): Candidate[] =>
      dish.variants.length > 0
        ? dish.variants.map((variant) => ({
            dishId: dish.id,
            dishVariantId: variant.id,
            name: `${dish.name} ${variant.name}`,
          }))
        : [{ dishId: dish.id, name: dish.name }],
    )
    .filter(
      (candidate) =>
        !components.some(
          (component) =>
            component.dishId === candidate.dishId && component.dishVariantId === candidate.dishVariantId,
        ),
    );

  const addComp = (candidate: Candidate) =>
    setComponents((current) => [
      ...current,
      {
        uid: `tmp-${candidate.dishId}-${candidate.dishVariantId ?? ''}-${Date.now()}`,
        dishId: candidate.dishId,
        dishVariantId: candidate.dishVariantId,
        name: candidate.name,
        quantity: 1,
        removable: true,
        replaceable: true,
      },
    ]);

  const patchComp = (uid: string, patch: Partial<SetCompDraft>) =>
    setComponents((current) => current.map((component) => (component.uid === uid ? { ...component, ...patch } : component)));

  const submit = async () => {
    setError('');
    const priceNum = Number(price.replace(',', '.'));
    if (!name.trim()) {
      setError('Укажите название сета');
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setError('Цена сета должна быть больше 0');
      return;
    }
    if (components.length === 0) {
      setError('Добавьте блюда в состав сета');
      return;
    }
    const body = {
      name: name.trim(),
      price: priceNum,
      components: components.map((component) => ({
        dishId: component.dishId,
        dishVariantId: component.dishVariantId,
        quantity: Math.max(1, component.quantity),
        removable: component.removable,
        replaceable: component.replaceable,
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
  };

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={isEdit ? 'Изменить сет' : 'Новый сет'}
      maxHeight="92%"
      footer={<Button title={isEdit ? 'Сохранить' : 'Создать сет'} size="lg" loading={pending} onPress={submit} />}
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.md }}>
        <View style={styles.grid2}>
          <Field label="Название" style={{ flex: 1 }}>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Сет-6"
              placeholderTextColor={colors.textLight}
            />
          </Field>
          <Field label="Цена" style={{ width: 116 }}>
            <TextInput
              style={styles.input}
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textLight}
            />
          </Field>
        </View>

        <View>
          <Text style={styles.setSectionTitle}>Состав сета</Text>
          {components.length === 0 ? (
            <Text style={styles.setEmptyBox}>Добавьте блюда из списка ниже</Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {components.map((component) => (
                <View key={component.uid} style={styles.setCompRow}>
                  <View style={{ flex: 1, minWidth: 0, gap: spacing.sm }}>
                    <Text style={styles.setCompName} numberOfLines={1}>
                      {component.name}
                    </Text>
                    <View style={styles.setCompControls}>
                      <View style={styles.qtyControl}>
                        <FastPressable
                          onPress={() => patchComp(component.uid, { quantity: Math.max(1, component.quantity - 1) })}
                          hitSlop={6}
                          style={styles.qtyBtn}
                        >
                          <PwaIcon name="minus" size={14} color={colors.textSecondary} strokeWidth={2} />
                        </FastPressable>
                        <Text style={styles.qtyValue}>{component.quantity}</Text>
                        <FastPressable
                          onPress={() => patchComp(component.uid, { quantity: component.quantity + 1 })}
                          hitSlop={6}
                          style={styles.qtyBtn}
                        >
                          <PwaIcon name="plus" size={14} color={colors.textSecondary} strokeWidth={2} />
                        </FastPressable>
                      </View>
                      <View style={styles.setFlags}>
                        <View style={styles.setFlag}>
                          <Text style={styles.setFlagLabel}>убирать</Text>
                          <Toggle
                            checked={component.removable}
                            onChange={(removable) => patchComp(component.uid, { removable })}
                          />
                        </View>
                        <View style={styles.setFlag}>
                          <Text style={styles.setFlagLabel}>заменять</Text>
                          <Toggle
                            checked={component.replaceable}
                            onChange={(replaceable) => patchComp(component.uid, { replaceable })}
                          />
                        </View>
                      </View>
                    </View>
                  </View>
                  <FastPressable
                    onPress={() => setComponents((current) => current.filter((item) => item.uid !== component.uid))}
                    hitSlop={6}
                    style={styles.iconBtn}
                  >
                    <PwaIcon name="trash" size={16} color={colors.danger} strokeWidth={2} />
                  </FastPressable>
                </View>
              ))}
            </View>
          )}
        </View>

        <View>
          <Text style={styles.setSectionTitle}>Добавить блюдо</Text>
          <TextInput
            style={styles.input}
            value={search}
            onChangeText={setSearch}
            placeholder="Поиск блюда"
            placeholderTextColor={colors.textLight}
          />
          <View style={styles.candidateList}>
            {candidates.map((candidate) => (
              <FastPressable
                key={`${candidate.dishId}-${candidate.dishVariantId ?? ''}`}
                onPress={() => addComp(candidate)}
                style={styles.candidateRow}
              >
                <Text style={styles.candidateName} numberOfLines={1}>
                  {candidate.name}
                </Text>
                <PwaIcon name="plus" size={16} color={colors.primary} strokeWidth={2.4} />
              </FastPressable>
            ))}
            {!dishesQ.isLoading && candidates.length === 0 ? <Text style={styles.emptySmall}>Блюда не найдены</Text> : null}
            {dishesQ.isLoading ? (
              <View style={styles.loadingSmall}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null}
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </BottomSheet>
  );
}

/* ---------- Категории ---------- */

function CategoryModal({ categories, onClose }: { categories: AdminCategory[]; onClose: () => void }) {
  const { create, update, reorder } = useCategoryMutations();
  const push = useNotifications((s) => s.push);
  const [name, setName] = useState('');
  const [prepStation, setPrepStation] = useState<'kitchen' | 'bar' | 'none'>('kitchen');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AdminCategory | null>(null);
  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);

  const add = async () => {
    setError('');
    if (!name.trim()) return;
    try {
      await create.mutateAsync({ name: name.trim(), prepStation });
      setName('');
      setPrepStation('kitchen');
      push({ message: 'Категория добавлена', at: new Date().toISOString() });
    } catch (err) {
      setError(apiError(err));
    }
  };
  const changeStation = (id: string, value: 'kitchen' | 'bar' | 'none') =>
    update.mutateAsync({ id, prepStation: value }).catch((err) => push({ message: apiError(err), type: 'error', at: new Date().toISOString() }));
  const saveRename = async (id: string) => {
    const newName = editName.trim();
    const currentName = sorted.find((c) => c.id === id)?.name;
    setEditingId(null);
    if (!newName || newName === currentName) return;
    try {
      await update.mutateAsync({ id, name: newName });
      push({ message: 'Категория переименована', at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  };
  const move = (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= sorted.length) return;
    const ids = sorted.map((c) => c.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    reorder.mutateAsync(ids).catch((err) => push({ message: apiError(err), type: 'error', at: new Date().toISOString() }));
  };

  const stationOpts = [
    { value: 'kitchen', label: 'Кухня' },
    { value: 'bar', label: 'Бар' },
    { value: 'none', label: 'Без отправки' },
  ];

  return (
    <BottomSheet visible onClose={onClose} title="Категории" maxHeight="88%">
      <View style={styles.catAddRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={name} onChangeText={setName} placeholder="Название категории" placeholderTextColor={colors.textLight} />
      </View>
      <View style={[styles.grid2, { marginTop: spacing.sm }]}>
        <View style={{ flex: 1 }}>
          <Select value={prepStation} onChange={(v) => setPrepStation(v as 'kitchen' | 'bar' | 'none')} options={stationOpts} title="Направление" />
        </View>
        <Button title="Добавить" size="md" loading={create.isPending} onPress={add} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ScrollView style={{ marginTop: spacing.md, maxHeight: 380 }} showsVerticalScrollIndicator={false}>
        {sorted.map((c, index) => (
          <View key={c.id} style={styles.catRow}>
            <View style={styles.varMove}>
              <FastPressable onPress={() => move(index, -1)} hitSlop={4} disabled={index === 0}>
                <View style={{ transform: [{ rotate: '180deg' }], opacity: index === 0 ? 0.3 : 1 }}>
                  <PwaIcon name="chevronDown" size={14} color={colors.textMuted} strokeWidth={2} />
                </View>
              </FastPressable>
              <FastPressable onPress={() => move(index, 1)} hitSlop={4} disabled={index === sorted.length - 1}>
                <View style={{ opacity: index === sorted.length - 1 ? 0.3 : 1 }}>
                  <PwaIcon name="chevronDown" size={14} color={colors.textMuted} strokeWidth={2} />
                </View>
              </FastPressable>
            </View>
            {editingId === c.id ? (
              <View style={styles.catEditBox}>
                <TextInput
                  style={styles.catEditInput}
                  value={editName}
                  onChangeText={setEditName}
                  autoFocus
                  placeholder="Название"
                  placeholderTextColor={colors.textLight}
                  onSubmitEditing={() => saveRename(c.id)}
                />
                <FastPressable onPress={() => saveRename(c.id)} hitSlop={6} style={styles.iconBtn}>
                  <PwaIcon name="check" size={16} color={colors.primary} strokeWidth={2.4} />
                </FastPressable>
                <FastPressable onPress={() => setEditingId(null)} hitSlop={6} style={styles.iconBtn}>
                  <PwaIcon name="close" size={15} color={colors.textMuted} strokeWidth={2} />
                </FastPressable>
              </View>
            ) : (
              <FastPressable
                onPress={() => {
                  setEditingId(c.id);
                  setEditName(c.name);
                }}
                style={styles.catNameBtn}
              >
                <Text style={styles.catName} numberOfLines={1}>
                  {c.name}
                </Text>
                <PwaIcon name="pencil" size={14} color={colors.textMuted} strokeWidth={2} />
              </FastPressable>
            )}
            <View style={{ width: 130 }}>
              <Select value={c.prepStation ?? 'kitchen'} onChange={(v) => changeStation(c.id, v as 'kitchen' | 'bar' | 'none')} options={stationOpts} title="Направление" />
            </View>
            <Text style={styles.catCount}>{c._count.dishes} бл.</Text>
            <FastPressable onPress={() => setDeleteTarget(c)} hitSlop={6} style={styles.iconBtn}>
              <PwaIcon name="trash" size={16} color={colors.danger} strokeWidth={2} />
            </FastPressable>
          </View>
        ))}
      </ScrollView>

      {deleteTarget ? (
        <DeleteCategorySheet category={deleteTarget} categories={sorted} onDone={() => setDeleteTarget(null)} />
      ) : null}
    </BottomSheet>
  );
}

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

  const run = async (strategy?: 'move' | 'delete', targetCategoryId?: string) => {
    try {
      await remove.mutateAsync({ id: category.id, strategy, targetCategoryId });
      push({ message: 'Категория удалена', at: new Date().toISOString() });
      onDone();
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  };

  return (
    <BottomSheet visible onClose={onDone} title={`Удалить «${category.name}»`}>
      {!hasDishes ? (
        <View style={{ gap: spacing.md }}>
          <Text style={styles.hint}>В категории нет блюд. Удалить её?</Text>
          <Button title="Удалить категорию" variant="danger" size="lg" loading={remove.isPending} onPress={() => run()} />
        </View>
      ) : (
        <View style={{ gap: spacing.lg }}>
          <Text style={styles.hint}>В категории {category._count.dishes} блюд. Что сделать с ними?</Text>
          <View style={styles.deleteBox}>
            <Text style={styles.deleteBoxTitle}>Перенести блюда в другую категорию</Text>
            {others.length === 0 ? (
              <Text style={styles.hint}>Нет другой категории для переноса.</Text>
            ) : (
              <View style={{ gap: spacing.sm }}>
                <Select value={targetId} onChange={setTargetId} options={others.map((c) => ({ value: c.id, label: c.name }))} title="Категория" />
                <Button title="Перенести и удалить" size="md" loading={remove.isPending} disabled={!targetId} onPress={() => run('move', targetId)} />
              </View>
            )}
          </View>
          <View style={[styles.deleteBox, styles.deleteBoxDanger]}>
            <Text style={styles.deleteBoxTitleDanger}>Удалить категорию вместе с блюдами</Text>
            <Text style={styles.hint}>Блюда полностью удалятся из меню. История заказов и чеки сохранятся.</Text>
            <Button title="Удалить вместе с блюдами" variant="danger" size="md" loading={remove.isPending} onPress={() => run('delete')} />
          </View>
        </View>
      )}
    </BottomSheet>
  );
}

/* ---------- Мелочи ---------- */

function CatTab({ active, onPress, label }: { active: boolean; onPress: () => void; label: string }) {
  return (
    <FastPressable onPress={onPress} style={[styles.catTab, active && styles.catTabActive]}>
      <Text style={[styles.catTabText, active && styles.catTabTextActive]}>{label}</Text>
    </FastPressable>
  );
}
function MiniBadge({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={[styles.miniBadge, { backgroundColor: bg }]}>
      <Text style={[styles.miniBadgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}
function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: object }) {
  return (
    <View style={style}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}
function Sum({ label, value }: { label: string; value: string }) {
  return (
    <Text style={styles.sumText}>
      {label}: <Text style={styles.sumValue}>{value}</Text>
    </Text>
  );
}
function Sep() {
  return <Text style={styles.sumSep}>|</Text>;
}

const styles = StyleSheet.create({
  listContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  headerWrap: { gap: spacing.sm, marginBottom: spacing.sm },
  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  sumText: { fontSize: fontSize.sm, color: colors.textSecondary },
  sumValue: { fontWeight: '500', color: colors.textPrimary },
  sumSep: { fontSize: fontSize.sm, color: colors.textLight },
  search: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
  },
  headerBtns: { flexDirection: 'row', gap: spacing.sm },
  tabs: { gap: 6, paddingVertical: 4 },
  catTab: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 8 },
  catTabActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  catTabText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary },
  catTabTextActive: { color: colors.white },

  center: { paddingVertical: 60, alignItems: 'center' },
  empty: { paddingVertical: 60, textAlign: 'center', color: colors.textMuted },

  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  dishNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  dishName: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary, flexShrink: 1 },
  variantsLine: { marginTop: 2, fontSize: fontSize.xs, fontWeight: '500', color: colors.primary },
  dishDesc: { marginTop: 2, fontSize: fontSize.xs, color: colors.textMuted },
  dishMeta: { marginTop: 4, fontSize: fontSize.xs, color: colors.textSecondary },
  dishRight: { alignItems: 'flex-end', gap: 6 },
  statusBadge: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: fontSize.xs, fontWeight: '500' },
  dishActions: { flexDirection: 'row', gap: 2 },
  iconBtn: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  miniBadge: { borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  miniBadgeText: { fontSize: 11, fontWeight: '500' },

  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.base,
    color: colors.textPrimary,
    backgroundColor: colors.white,
  },
  inputSm: {
    height: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    backgroundColor: colors.white,
  },
  multiline: { height: 76, paddingTop: 10, textAlignVertical: 'top' },
  fieldLabel: { marginBottom: 6, fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary },
  grid2: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
  varHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  addVarText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.primary },
  varRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm },
  varMove: { alignItems: 'center', justifyContent: 'center' },
  photoPreview: { width: '100%', height: 160, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  checkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checkLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  checkHint: { marginTop: 2, fontSize: fontSize.xs, color: colors.textMuted },
  weightedBox: { gap: spacing.sm, borderWidth: 1, borderColor: colors.primarySoft, borderRadius: radius.md, backgroundColor: colors.primaryFaint, padding: spacing.md },
  weightedTitle: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  weightedHint: { fontSize: fontSize.xs, lineHeight: 16, color: colors.textMuted },
  error: { fontSize: fontSize.sm, color: colors.danger },

  setSectionTitle: { marginBottom: 6, fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary },
  setEmptyBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  setCompRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    backgroundColor: colors.white,
  },
  setCompName: { fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary },
  setCompControls: { gap: spacing.sm },
  qtyControl: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  qtyBtn: { width: 34, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  qtyValue: { minWidth: 34, textAlign: 'center', fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  setFlags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  setFlag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  setFlagLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  candidateList: { marginTop: spacing.sm, gap: spacing.sm, maxHeight: 260 },
  candidateRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.white,
  },
  candidateName: { flex: 1, minWidth: 0, fontSize: fontSize.sm, color: colors.textPrimary },
  emptySmall: { paddingVertical: spacing.md, textAlign: 'center', fontSize: fontSize.sm, color: colors.textMuted },
  loadingSmall: { paddingVertical: spacing.md, alignItems: 'center' },

  catAddRow: { flexDirection: 'row', gap: spacing.sm },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, marginBottom: spacing.sm },
  catNameBtn: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  catName: { flex: 1, minWidth: 0, fontSize: fontSize.base, color: colors.textPrimary },
  catEditBox: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 2 },
  catEditInput: {
    flex: 1,
    minWidth: 0,
    height: 36,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    backgroundColor: colors.white,
  },
  catCount: { width: 44, textAlign: 'right', fontSize: fontSize.xs, color: colors.textMuted },
  hint: { fontSize: fontSize.sm, color: colors.textSecondary },
  deleteBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  deleteBoxDanger: { borderColor: 'rgba(239,68,68,0.3)', backgroundColor: colors.dangerSoft },
  deleteBoxTitle: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textPrimary },
  deleteBoxTitleDanger: { fontSize: fontSize.sm, fontWeight: '500', color: colors.danger },
});
