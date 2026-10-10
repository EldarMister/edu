import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Alert, Text } from '@/components/typography';
import { BottomSheet } from '@/components/BottomSheet';
import { Select } from '@/components/Select';
import { DateField } from '@/components/DateField';
import { Button, Card, Field, Toggle } from '@/components/ui';
import { colors, spacing } from '@/theme';
import { apiError } from '@/lib/api';
import { money } from '@/utils/format';
import { useNotifications } from '@/store/notifications';
import {
  useIngredientMutations, useIngredients, usePurchase, usePurchaseMutations, useRecipe, useRecipeMutations,
  type Ingredient, type RecipeItem,
} from '@/services/api/warehouse';
import { UNIT_OPTIONS, unitsForType } from '@/services/api/warehouseUnits';
import type { AdminDish } from '@/services/api/admin';

const number = (value: string) => Number(value.trim().replace(',', '.'));
const date = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function useReportError() { const push = useNotifications((s) => s.push); return (error: unknown) => push({ message: apiError(error), type: 'error', at: new Date().toISOString() }); }
function ScrollableSheet(props: React.ComponentProps<typeof BottomSheet>) {
  return <BottomSheet {...props}><ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">{props.children}</ScrollView></BottomSheet>;
}

export function IngredientEditor({ ingredient, onClose }: { ingredient: Ingredient | null; onClose: () => void }) {
  const [name, setName] = useState(ingredient?.name ?? '');
  const [unit, setUnit] = useState(ingredient?.displayUnit ?? 'kg');
  const [stock, setStock] = useState(String(ingredient?.stock ?? 0));
  const [cost, setCost] = useState(String(ingredient?.avgCost ?? 0));
  const [threshold, setThreshold] = useState(String(ingredient?.lowStockThreshold ?? 0));
  const [active, setActive] = useState(ingredient?.isActive ?? true);
  const mutation = useIngredientMutations();
  const reportError = useReportError();
  async function save() {
    if (!name.trim() || [stock, cost, threshold].some((v) => !Number.isFinite(number(v)) || number(v) < 0)) { reportError(new Error('Укажите название и неотрицательные числовые значения')); return; }
    try {
      const body = { name: name.trim(), unit, avgCost: number(cost), lowStockThreshold: number(threshold), ...(ingredient ? { isActive: active } : { stock: number(stock) }) };
      if (ingredient) await mutation.update.mutateAsync({ id: ingredient.id, ...body }); else await mutation.create.mutateAsync(body);
      onClose();
    } catch (error) { reportError(error); }
  }
  return <ScrollableSheet visible onClose={onClose} title={ingredient ? 'Изменить сырьё' : 'Новое сырьё'} footer={<Button title="Сохранить" loading={mutation.create.isPending || mutation.update.isPending} onPress={() => void save()} />}><View style={styles.stack}><Field label="Название" value={name} onChangeText={setName} /><Text style={styles.label} translate>Единица измерения</Text><Select value={unit} options={UNIT_OPTIONS} onChange={setUnit} title="Единица" />{!ingredient ? <Field label="Начальный остаток" value={stock} onChangeText={setStock} keyboardType="decimal-pad" /> : null}<Field label="Себестоимость за единицу" value={cost} onChangeText={setCost} keyboardType="decimal-pad" /><Field label="Порог низкого остатка" value={threshold} onChangeText={setThreshold} keyboardType="decimal-pad" />{ingredient ? <View style={styles.row}><Text style={styles.label} translate>Активен</Text><Toggle checked={active} onChange={setActive} /></View> : null}</View></ScrollableSheet>;
}

export function IngredientAdjustment({ ingredient, onClose }: { ingredient: Ingredient; onClose: () => void }) {
  const [mode, setMode] = useState<'add' | 'writeoff' | 'set'>('add');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState(ingredient.displayUnit);
  const { adjust } = useIngredientMutations();
  const reportError = useReportError();
  async function save() {
    if (!quantity.trim() || !Number.isFinite(number(quantity)) || number(quantity) < 0) { reportError(new Error('Укажите неотрицательное количество')); return; }
    try { await adjust.mutateAsync({ id: ingredient.id, mode, quantity: number(quantity), unit }); onClose(); }
    catch (error) { reportError(error); }
  }
  return <ScrollableSheet visible onClose={onClose} title="Коррекция остатка" footer={<Button title="Применить" loading={adjust.isPending} onPress={() => void save()} />}><View style={styles.stack}><Text style={styles.title}>{ingredient.name}</Text><Text style={styles.muted} translate>Текущий остаток: {ingredient.stock} {ingredient.unit}</Text><Select value={mode} options={[{ value: 'add', label: 'Добавить' }, { value: 'writeoff', label: 'Списать' }, { value: 'set', label: 'Установить остаток' }]} onChange={setMode} title="Операция" /><Field label="Количество" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" /><Select value={unit} options={unitsForType(ingredient.unitType)} onChange={setUnit} title="Единица" /></View></ScrollableSheet>;
}

type PurchaseLine = { key: string; ingredientId: string; quantity: string; unit: string; price: string; total: string };
const lineTotal = (quantity: string, price: string) => String(Math.round((number(quantity) || 0) * (number(price) || 0) * 100) / 100);
const blankLine = (): PurchaseLine => ({ key: `${Date.now()}-${Math.random()}`, ingredientId: '', quantity: '', unit: 'kg', price: '', total: '' });
export function PurchaseEditor({ purchaseId, onClose }: { purchaseId: string | null; onClose: () => void }) {
  const q = usePurchase(purchaseId);
  const ingredients = useIngredients('');
  const [supplier, setSupplier] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(date);
  const [lines, setLines] = useState<PurchaseLine[]>(() => [blankLine()]);
  const [complete, setComplete] = useState(!purchaseId);
  const mutations = usePurchaseMutations();
  const reportError = useReportError();
  useEffect(() => {
    if (!q.data) return;
    setSupplier(q.data.supplier); setPurchaseDate(q.data.date.slice(0, 10));
    setLines((q.data.items ?? []).map((item) => ({ key: item.id, ingredientId: item.ingredientId, quantity: String(item.quantity), unit: item.unitCode, price: String(item.purchasePrice), total: String(item.total) })));
  }, [q.data]);
  const readonly = !!purchaseId && q.data?.status === 'cancelled';
  const lockedItems = !!purchaseId && q.data?.status !== 'draft';
  const options = (ingredients.data ?? []).filter((item) => item.isActive).map((item) => ({ value: item.id, label: item.name }));
  const pending = Object.values(mutations).some((m) => m.isPending);
  const updateLine = (key: string, body: Partial<PurchaseLine>) => setLines((rows) => rows.map((row) => row.key === key ? { ...row, ...body } : row));
  async function save() {
    if (purchaseId && q.data?.status === 'completed') {
      if (!supplier.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) { reportError(new Error('Укажите поставщика и дату')); return; }
      try { await mutations.update.mutateAsync({ id: purchaseId, supplier: supplier.trim(), date: purchaseDate }); onClose(); }
      catch (error) { reportError(error); }
      return;
    }
    if (!supplier.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) || !lines.length || lines.some((line) => !line.ingredientId || !Number.isFinite(number(line.quantity)) || number(line.quantity) <= 0 || !Number.isFinite(number(line.price)) || number(line.price) < 0 || (line.total !== '' && (!Number.isFinite(number(line.total)) || number(line.total) < 0)))) { reportError(new Error('Укажите поставщика, дату, ингредиенты и корректные количество и цену')); return; }
    try {
      const body = { supplier: supplier.trim(), date: purchaseDate, items: lines.map((line) => ({ ingredientId: line.ingredientId, quantity: number(line.quantity), unit: line.unit, purchasePrice: number(line.price), total: line.total === '' ? undefined : number(line.total) })) };
      if (purchaseId) { await mutations.update.mutateAsync({ id: purchaseId, ...body }); if (complete) await mutations.complete.mutateAsync(purchaseId); }
      else await mutations.create.mutateAsync({ ...body, complete });
      onClose();
    } catch (error) { reportError(error); }
  }
  function cancelPurchase() {
    if (!purchaseId) return;
    Alert.alert('Отменить закупку?', 'Черновик будет отменён.', [{ text: 'Назад', style: 'cancel' }, { text: 'Отменить закупку', style: 'destructive', onPress: () => { void mutations.cancel.mutateAsync(purchaseId).then(onClose).catch(reportError); } }]);
  }
  const total = lines.reduce((sum, line) => sum + (line.total === '' ? (number(line.quantity) || 0) * (number(line.price) || 0) : number(line.total) || 0), 0);
  return <ScrollableSheet visible onClose={onClose} maxHeight="92%" title={purchaseId ? 'Закупка' : 'Новая закупка'} footer={!readonly ? <Button title={lockedItems ? 'Сохранить реквизиты' : complete ? 'Сохранить и провести' : 'Сохранить черновик'} loading={pending} disabled={!!purchaseId && !q.data} onPress={() => void save()} /> : undefined}>{q.isLoading ? <ActivityIndicator color={colors.primary} /> : q.isError ? <Text style={{ color: colors.danger }}>{apiError(q.error)}</Text> : <View style={styles.stack}><Field label="Поставщик" value={supplier} onChangeText={setSupplier} editable={!readonly} /><DateField label="Дата закупки" value={purchaseDate} onChangeText={setPurchaseDate} editable={!readonly} />{lines.map((line, index) => {
    const ingredient = ingredients.data?.find((item) => item.id === line.ingredientId);
    return <Card key={line.key} style={styles.stack}><Text style={styles.label} translate>Позиция {index + 1}</Text>{lockedItems ? <Text style={styles.title}>{ingredient?.name ?? q.data?.items?.[index]?.ingredientName}</Text> : <Select value={line.ingredientId} options={options} onChange={(ingredientId) => { const selected = ingredients.data?.find((item) => item.id === ingredientId); updateLine(line.key, { ingredientId, unit: selected?.displayUnit ?? 'kg', price: String(selected?.avgCost ?? 0), total: lineTotal(line.quantity, String(selected?.avgCost ?? 0)) }); }} title="Ингредиент" />}<Field label="Количество" value={line.quantity} onChangeText={(quantity) => updateLine(line.key, { quantity, total: lineTotal(quantity, line.price) })} keyboardType="decimal-pad" editable={!lockedItems} />{lockedItems ? <Text style={styles.muted}>{line.unit}</Text> : <Select value={line.unit} options={ingredient ? unitsForType(ingredient.unitType) : UNIT_OPTIONS} onChange={(unit) => updateLine(line.key, { unit })} title="Единица" />}<Field label="Цена за единицу" value={line.price} onChangeText={(price) => updateLine(line.key, { price, total: lineTotal(line.quantity, price) })} keyboardType="decimal-pad" editable={!lockedItems} /><Field label="Сумма позиции" value={line.total} onChangeText={(total) => updateLine(line.key, { total, price: number(line.quantity) > 0 && total !== '' ? String(Math.round(number(total) / number(line.quantity) * 10000) / 10000) : line.price })} keyboardType="decimal-pad" editable={!lockedItems} />{!lockedItems ? <Button title="Убрать позицию" variant="secondary" size="md" onPress={() => setLines((rows) => rows.filter((r) => r.key !== line.key))} /> : null}</Card>;
  })}{!lockedItems ? <><Button title="+ Добавить позицию" variant="secondary" size="md" onPress={() => setLines((rows) => [...rows, blankLine()])} /><View style={styles.row}><Text style={styles.label} translate>Провести закупку</Text><Toggle checked={complete} onChange={setComplete} /></View></> : null}<Text style={styles.title} translate>Итого: {money(total)}</Text>{purchaseId && q.data?.status === 'draft' ? <Button title="Отменить закупку" variant="danger" disabled={pending} onPress={cancelPurchase} /> : null}</View>}</ScrollableSheet>;
}

export function RecipeEditor({ dish, onClose }: { dish: AdminDish; onClose: () => void }) {
  const q = useRecipe(dish.id);
  const ingredients = useIngredients('');
  const actions = useRecipeMutations(dish.id);
  const [ingredientId, setIngredientId] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('g');
  const [editing, setEditing] = useState<RecipeItem | null>(null);
  const reportError = useReportError();
  const selected = ingredients.data?.find((item) => item.id === ingredientId);
  async function save() {
    if ((!editing && !ingredientId) || !Number.isFinite(number(amount)) || number(amount) <= 0) { reportError(new Error('Выберите ингредиент и укажите количество больше нуля')); return; }
    try { if (editing) await actions.updateItem.mutateAsync({ id: editing.id, amount: number(amount), unit }); else await actions.addItem.mutateAsync({ ingredientId, amount: number(amount), unit }); setEditing(null); setAmount(''); setIngredientId(''); }
    catch (error) { reportError(error); }
  }
  return <ScrollableSheet visible onClose={onClose} title={`Техкарта · ${dish.name}`} maxHeight="90%"><View style={styles.stack}>{q.isLoading ? <ActivityIndicator color={colors.primary} /> : q.isError ? <Text style={{ color: colors.danger }}>{apiError(q.error)}</Text> : <><Text style={styles.title} translate>Себестоимость: {money(q.data?.foodCost ?? 0)}</Text><Text style={styles.muted} translate>Цена: {money(q.data?.price ?? 0)} · Маржа: {(q.data?.marginPercent ?? 0).toFixed(1)}%</Text>{(q.data?.items ?? []).map((item) => <Card key={item.id} style={styles.stack}><Text style={styles.label}>{item.name} · {item.amount} {item.unit} · {money(item.lineCost)}</Text><Text style={styles.muted} translate>Остаток: {item.stock} {item.unit}</Text><View style={styles.row}><Button title="Изменить" size="md" variant="secondary" onPress={() => { setEditing(item); setIngredientId(item.ingredientId); setAmount(String(item.amount)); setUnit(item.amountUnit); }} /><Button title="Удалить" size="md" variant="danger" disabled={actions.removeItem.isPending} onPress={() => void actions.removeItem.mutateAsync(item.id).catch(reportError)} /></View></Card>)}<Text style={styles.title} translate>{editing ? 'Изменить ингредиент' : 'Добавить ингредиент'}</Text>{editing ? <Text style={styles.label}>{editing.name}</Text> : <Select value={ingredientId} options={(ingredients.data ?? []).filter((item) => item.isActive && !q.data?.items.some((r) => r.ingredientId === item.id)).map((item) => ({ value: item.id, label: item.name , translate: false }))} onChange={(value) => { setIngredientId(value); setUnit(ingredients.data?.find((item) => item.id === value)?.displayUnit ?? 'g'); }} title="Ингредиент" />}<Field label="Количество на порцию" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" /><Select value={unit} options={selected ? unitsForType(selected.unitType) : UNIT_OPTIONS} onChange={setUnit} title="Единица" /><Button title={editing ? 'Сохранить' : 'Добавить'} loading={actions.addItem.isPending || actions.updateItem.isPending} onPress={() => void save()} />{editing ? <Button title="Отмена редактирования" variant="secondary" onPress={() => { setEditing(null); setIngredientId(''); setAmount(''); }} /> : null}</>}</View></ScrollableSheet>;
}

const styles = StyleSheet.create({ stack: { gap: spacing.md }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }, title: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' }, label: { color: colors.textPrimary, fontWeight: '600' }, muted: { color: colors.textMuted, fontSize: 13 } });
