import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { processingBases, processingMethods, type ProcessingBasis, type ProcessingOptionsDto, type ProcessingStage } from './recipe-processing.dto';
import { toBase, type UnitCode, type UnitType } from './units';

type SavedProcessing = { processingMethod: string | null; lossPercent: Prisma.Decimal; netAmount: Prisma.Decimal | null; amount: Prisma.Decimal;
  processingStages?: Prisma.JsonValue | null; processingBasis?: string | null; measuredNetWeightGrams?: Prisma.Decimal | null };

const zero = new Prisma.Decimal(0);
const one = new Prisma.Decimal(1);
const hundred = new Prisma.Decimal(100);
const retention = (loss: number | Prisma.Decimal) => one.sub(new Prisma.Decimal(loss).div(hundred));
const stageRetention = (stages: ProcessingStage[]) => stages.reduce((total, stage) => total.mul(retention(stage.lossPercent)), one);

export function stagedNetAmount(stages: ProcessingStage[], gross: Prisma.Decimal) {
  return gross.mul(stageRetention(stages)).toDecimalPlaces(3);
}

function baseQuantity(value: number, unit: UnitCode) {
  if (!Number.isFinite(value) || value < 0) throw new BadRequestException('Укажите неотрицательное количество');
  return checkedQuantity(new Prisma.Decimal(value).mul(toBase(1, unit)));
}

function checkedQuantity(value: Prisma.Decimal) {
  const amount = value.toDecimalPlaces(3);
  if (amount.gte(100_000_000_000)) throw new BadRequestException('Количество вне допустимого диапазона');
  return amount;
}

export function readProcessingStages(value: unknown): ProcessingStage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || !processingMethods.includes(entry.method) || typeof entry.lossPercent !== 'number'
        || !Number.isFinite(entry.lossPercent) || entry.lossPercent < -999.99 || entry.lossPercent > 100) return [];
    return [{ method: entry.method as ProcessingStage['method'], lossPercent: entry.lossPercent }];
  });
}

export function processingStageResults(stages: ProcessingStage[], gross: Prisma.Decimal, unit: UnitCode) {
  const scale = toBase(1, unit);
  let amount = gross;
  return stages.map((stage) => {
    const inputAmount = Number(amount.toDecimalPlaces(3).div(scale));
    amount = amount.mul(retention(stage.lossPercent));
    return { ...stage, inputAmount, outputAmount: Number(amount.toDecimalPlaces(3).div(scale)) };
  });
}

export function processingSnapshot(row: Pick<SavedProcessing, 'processingStages' | 'processingBasis' | 'measuredNetWeightGrams'>) {
  const stages = readProcessingStages(row.processingStages);
  return { ...(stages.length ? { processingStages: stages } : {}), ...(row.processingBasis ? { processingBasis: row.processingBasis } : {}),
    ...(row.measuredNetWeightGrams != null ? { measuredNetWeightGrams: row.measuredNetWeightGrams.toString() } : {}) };
}

export function measuredVolumeNetWeight(unitType: UnitType, gross: Prisma.Decimal, input: number | null | undefined,
  previous: Prisma.Decimal | null | undefined) {
  if (unitType !== 'volume') {
    if (input != null) throw new BadRequestException('Измеренное нетто в граммах доступно для объёмных ингредиентов');
    return null;
  }
  if (input === null) return null;
  let weight = previous ?? null;
  if (input !== undefined) {
    if (!Number.isFinite(input) || input < 0) throw new BadRequestException('Укажите неотрицательное нетто в граммах');
    weight = new Prisma.Decimal(input);
    if (weight.decimalPlaces() > 3 || weight.gte(100_000_000_000)) throw new BadRequestException('Укажите нетто в граммах с точностью до 0,001 г');
  }
  if (weight?.gt(0) && gross.isZero()) throw new BadRequestException('Укажите брутто больше нуля для положительного нетто в граммах');
  return weight;
}

export function volumeNetWeightForGross(measured: Prisma.Decimal | null, baseGross: Prisma.Decimal, gross: Prisma.Decimal) {
  if (measured == null) return null;
  if (baseGross.eq(gross)) return measured;
  if (gross.isZero()) return zero;
  return baseGross.gt(0) ? measured.mul(gross).div(baseGross).toDecimalPlaces(3) : null;
}

export function massProcessing(gross: Prisma.Decimal, unit: UnitCode, input: ProcessingOptionsDto, previous?: SavedProcessing,
  defaults?: Prisma.JsonValue | null) {
  const charge = input.netAmount == null ? input.netAmount : baseQuantity(input.netAmount, unit);
  const stagesChanged = input.processingStages !== undefined;
  const savedStages = readProcessingStages(previous?.processingStages);
  const stages = stagesChanged ? readProcessingStages(input.processingStages) : savedStages;
  if (input.processingStages && (input.processingStages.length > 10 || input.processingStages.length !== stages.length
      || stages.some(({ lossPercent }) => new Prisma.Decimal(lossPercent).decimalPlaces() > 2))) {
    throw new BadRequestException('Проверьте способ, порядок и процент этапов обработки');
  }
  const savedBasis = processingBases.includes(previous?.processingBasis as ProcessingBasis) ? previous!.processingBasis as ProcessingBasis : null;
  const sameNet = previous && previous.amount.eq(gross) && (charge === null ? previous.netAmount === null
    : charge !== undefined && previous.netAmount?.eq(charge) === true);
  const inferredBasis = charge !== undefined && (stagesChanged || !sameNet) ? 'manual' : stagesChanged ? 'gross' : savedBasis;
  const basis = input.processingBasis ?? inferredBasis;
  const clearedStages = stagesChanged && !stages.length && !!savedStages.length;
  const method = stages.length ? stages.length === 1 ? stages[0].method : null
    : input.processingMethod === undefined ? clearedStages ? null : previous?.processingMethod ?? null : input.processingMethod;
  const usesSavedLoss = previous && !clearedStages && (input.processingMethod === undefined || input.processingMethod === previous.processingMethod);
  const defaultLoss = (defaults ?? {}) as Record<string, number>;
  const legacyLoss = input.lossPercent ?? (usesSavedLoss ? Number(previous.lossPercent) : method && !stages.length ? Number(defaultLoss[method] ?? 0) : 0);
  if (!Number.isFinite(legacyLoss) || legacyLoss > 100 || legacyLoss < -10_000_000_000_000_000) throw new BadRequestException('Укажите допустимый процент обработки');
  const factor = stages.length ? stageRetention(stages) : retention(legacyLoss);
  let amount = gross;
  let netAmount: Prisma.Decimal | null;
  if (input.processingBasis === 'net' && charge == null) throw new BadRequestException('Укажите нетто для расчёта брутто');
  if (basis === 'net' && charge != null) {
    if (factor.isZero()) throw new BadRequestException('Брутто не рассчитывается при потере 100%');
    amount = checkedQuantity(charge.div(factor));
    netAmount = charge;
  } else if ((basis === 'manual' || basis == null) && charge !== undefined) netAmount = charge;
  else if (basis === 'manual' && previous?.netAmount != null && previous.amount.gt(0))
    netAmount = checkedQuantity(gross.mul(previous.netAmount).div(previous.amount));
  else if (basis === 'manual' && previous?.netAmount === null) netAmount = null;
  else if (basis === 'net' && previous?.amount.eq(gross) && !stagesChanged && input.lossPercent === undefined && input.processingMethod === undefined)
    netAmount = previous.netAmount;
  else netAmount = checkedQuantity(gross.mul(factor));
  if (amount.isZero() && netAmount?.gt(0)) throw new BadRequestException('Укажите брутто больше нуля для положительного нетто');
  const calculatedLoss = stages.length ? hundred.mul(one.sub(factor)).toDecimalPlaces(2) : new Prisma.Decimal(legacyLoss);
  const lossPercent = amount.gt(0) && netAmount != null && (basis === 'manual' || (basis == null && charge !== undefined))
    ? hundred.sub(netAmount.mul(hundred).div(amount)).toDecimalPlaces(2) : calculatedLoss;
  return { amount, netAmount, processingMethod: method, lossPercent,
    processingStages: stages, processingBasis: input.processingBasis ?? (stages.length ? basis ?? 'gross' : basis) };
}

/** Volume and count support an explicit consumption/yield pair, without automatic processing defaults. */
export function nonMassProcessing(amount: Prisma.Decimal, unit: UnitCode, input: ProcessingOptionsDto, previous?: SavedProcessing) {
  const savedMethod = previous?.processingMethod ?? null;
  const savedLoss = previous?.lossPercent ?? zero;
  if (input.processingStages?.length || input.processingBasis === 'net') {
    throw new BadRequestException('Этапы обработки доступны только для весовых ингредиентов');
  }
  if (input.processingMethod != null && input.processingMethod !== savedMethod) {
    throw new BadRequestException('Способ обработки доступен только для весовых ингредиентов');
  }
  if (input.lossPercent != null && (!Number.isFinite(input.lossPercent) || input.lossPercent < 0 || input.lossPercent > 100)) {
    throw new BadRequestException('Потери должны быть от 0 до 100%');
  }
  if (input.netAmount == null && input.lossPercent != null && input.lossPercent !== 0 && !savedLoss.eq(input.lossPercent)) {
    throw new BadRequestException('Автоматические потери применяются только к весовым ингредиентам. Укажите нетто вручную');
  }

  let netAmount: Prisma.Decimal | null;
  if (input.netAmount !== undefined) {
    if (input.netAmount != null && (!Number.isFinite(input.netAmount) || input.netAmount < 0)) {
      throw new BadRequestException('Нетто должно быть от нуля до брутто');
    }
    netAmount = input.netAmount == null ? null : new Prisma.Decimal(input.netAmount).mul(toBase(1, unit)).toDecimalPlaces(3);
  } else if (!previous) netAmount = amount;
  else if (previous.amount.eq(amount)) netAmount = previous.netAmount;
  else netAmount = previous.netAmount != null && previous.amount.gt(0) ? amount.mul(previous.netAmount).div(previous.amount).toDecimalPlaces(3) : null;
  if (netAmount != null && (netAmount.lt(0) || netAmount.gt(amount))) throw new BadRequestException('Нетто должно быть от нуля до брутто');

  const samePair = previous?.amount.eq(amount) && previous.netAmount != null && netAmount?.eq(previous.netAmount);
  const lossPercent = input.netAmount != null && netAmount != null && amount.gt(0) && !samePair
    ? new Prisma.Decimal(100).sub(netAmount.mul(100).div(amount)).toDecimalPlaces(2) : savedLoss;
  return { processingMethod: savedMethod, netAmount, lossPercent };
}
