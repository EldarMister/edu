import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toBase, type UnitCode } from './units';

type ProcessingInput = { processingMethod?: string | null; lossPercent?: number; netAmount?: number | null };
type SavedProcessing = { processingMethod: string | null; lossPercent: Prisma.Decimal; netAmount: Prisma.Decimal | null; amount: Prisma.Decimal };

const zero = new Prisma.Decimal(0);

/** Volume and count support an explicit consumption/yield pair, without automatic processing defaults. */
export function nonMassProcessing(amount: Prisma.Decimal, unit: UnitCode, input: ProcessingInput, previous?: SavedProcessing) {
  const savedMethod = previous?.processingMethod ?? null;
  const savedLoss = previous?.lossPercent ?? zero;
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
