import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseDto, PurchaseItemInputDto, UpdatePurchaseDto } from './dto';

@Injectable()
export class PurchasesService {
  constructor(private prisma: PrismaService) {}

  private serializeItem(item: {
    id: string;
    ingredientId: string;
    quantity: Prisma.Decimal;
    purchasePrice: Prisma.Decimal;
    total: Prisma.Decimal;
    ingredient?: { name: string; unit: string } | null;
  }) {
    return {
      id: item.id,
      ingredientId: item.ingredientId,
      ingredientName: item.ingredient?.name ?? '',
      unit: item.ingredient?.unit ?? '',
      quantity: Number(item.quantity),
      purchasePrice: Number(item.purchasePrice),
      total: Number(item.total),
    };
  }

  private serialize(p: any) {
    return {
      id: p.id,
      number: p.number,
      date: p.date,
      supplier: p.supplier,
      totalAmount: Number(p.totalAmount),
      status: p.status as PurchaseStatus,
      itemsCount: p._count?.items ?? p.items?.length ?? 0,
      items: p.items ? p.items.map((i: any) => this.serializeItem(i)) : undefined,
      createdAt: p.createdAt,
    };
  }

  async findAll(params: { status?: PurchaseStatus; search?: string; from?: string; to?: string }) {
    const where: Prisma.PurchaseWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.search
        ? { supplier: { contains: params.search, mode: 'insensitive' } }
        : {}),
      ...(this.dateRange(params.from, params.to)),
    };
    const purchases = await this.prisma.purchase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true } } },
    });
    return purchases.map((p) => this.serialize(p));
  }

  async overview(params: { from?: string; to?: string }) {
    const where: Prisma.PurchaseWhereInput = {
      status: PurchaseStatus.completed,
      ...(this.dateRange(params.from, params.to)),
    };
    const completed = await this.prisma.purchase.findMany({
      where,
      select: { supplier: true, totalAmount: true },
    });
    const suppliers = new Set(completed.map((p) => p.supplier.trim().toLowerCase()));
    const sum = completed.reduce((acc, p) => acc + Number(p.totalAmount), 0);
    return { count: completed.length, suppliers: suppliers.size, sum };
  }

  async findOne(id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: { items: { include: { ingredient: { select: { name: true, unit: true } } } } },
    });
    if (!purchase) throw new NotFoundException('Закупка не найдена');
    return this.serialize(purchase);
  }

  async create(dto: CreatePurchaseDto) {
    const items = this.normalizeItems(dto.items);
    const total = items.reduce((acc, i) => acc + i.total, 0);

    const purchase = await this.prisma.purchase.create({
      data: {
        date: dto.date ? new Date(dto.date) : new Date(),
        supplier: dto.supplier.trim(),
        totalAmount: new Prisma.Decimal(total),
        items: {
          create: items.map((i) => ({
            ingredientId: i.ingredientId,
            quantity: new Prisma.Decimal(i.quantity),
            purchasePrice: new Prisma.Decimal(i.purchasePrice),
            total: new Prisma.Decimal(i.total),
          })),
        },
      },
    });

    if (dto.complete) {
      return this.complete(purchase.id);
    }
    return this.findOne(purchase.id);
  }

  async update(id: string, dto: UpdatePurchaseDto) {
    const purchase = await this.prisma.purchase.findUnique({ where: { id } });
    if (!purchase) throw new NotFoundException('Закупка не найдена');
    if (purchase.status === PurchaseStatus.cancelled) {
      throw new BadRequestException('Отменённую закупку нельзя редактировать');
    }
    // У проведённой закупки можно менять только поставщика и дату — состав
    // трогать нельзя, иначе разъедутся остатки и средневзвешенная себестоимость.
    if (purchase.status === PurchaseStatus.completed && dto.items !== undefined) {
      throw new BadRequestException(
        'Состав проведённой закупки изменить нельзя. Можно изменить поставщика и дату.',
      );
    }

    const items = dto.items ? this.normalizeItems(dto.items) : undefined;
    const total = items ? items.reduce((acc, i) => acc + i.total, 0) : undefined;

    await this.prisma.$transaction(async (tx) => {
      if (items) {
        await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
        for (const i of items) {
          await tx.purchaseItem.create({
            data: {
              purchaseId: id,
              ingredientId: i.ingredientId,
              quantity: new Prisma.Decimal(i.quantity),
              purchasePrice: new Prisma.Decimal(i.purchasePrice),
              total: new Prisma.Decimal(i.total),
            },
          });
        }
      }
      await tx.purchase.update({
        where: { id },
        data: {
          ...(dto.date !== undefined ? { date: new Date(dto.date) } : {}),
          ...(dto.supplier !== undefined ? { supplier: dto.supplier.trim() } : {}),
          ...(total !== undefined ? { totalAmount: new Prisma.Decimal(total) } : {}),
        },
      });
    });
    return this.findOne(id);
  }

  /**
   * Проведение закупки: увеличиваем остатки и пересчитываем средневзвешенную
   * себестоимость, пишем движения. Идемпотентно — повторное проведение
   * уже проведённой закупки запрещено.
   *
   *   newAvg = (oldStock × oldAvg + qty × purchasePrice) / (oldStock + qty)
   */
  async complete(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!purchase) throw new NotFoundException('Закупка не найдена');
      if (purchase.status === PurchaseStatus.completed) {
        throw new ConflictException('Закупка уже проведена');
      }
      if (purchase.status === PurchaseStatus.cancelled) {
        throw new BadRequestException('Отменённую закупку нельзя провести');
      }
      if (purchase.items.length === 0) {
        throw new BadRequestException('В закупке нет позиций');
      }

      let total = 0;
      for (const item of purchase.items) {
        const ingredient = await tx.ingredient.findUnique({
          where: { id: item.ingredientId },
          select: { stock: true, avgCost: true },
        });
        if (!ingredient) {
          throw new NotFoundException('Сырьё закупки не найдено');
        }

        const before = Number(ingredient.stock);
        const qty = Number(item.quantity);
        // Авторитетная сумма позиции (фактически уплаченная) — основа себестоимости.
        const lineTotal = Number(item.total);
        const after = before + qty;
        const newAvg =
          after > 0 ? (before * Number(ingredient.avgCost) + lineTotal) / after : Number(ingredient.avgCost);
        total += lineTotal;

        await tx.ingredient.update({
          where: { id: item.ingredientId },
          data: {
            stock: new Prisma.Decimal(after),
            avgCost: new Prisma.Decimal(newAvg),
          },
        });

        await tx.stockMovement.create({
          data: {
            ingredientId: item.ingredientId,
            type: 'purchase',
            sourceType: 'purchase',
            sourceId: purchase.id,
            beforeStock: new Prisma.Decimal(before),
            change: new Prisma.Decimal(qty),
            afterStock: new Prisma.Decimal(after),
            costAtMoment: new Prisma.Decimal(newAvg),
            comment: `Закупка от ${purchase.supplier}`,
          },
        });
      }

      await tx.purchase.update({
        where: { id },
        data: { status: PurchaseStatus.completed, totalAmount: new Prisma.Decimal(total) },
      });
    });
    return this.findOne(id);
  }

  async cancel(id: string) {
    const purchase = await this.prisma.purchase.findUnique({ where: { id } });
    if (!purchase) throw new NotFoundException('Закупка не найдена');
    if (purchase.status === PurchaseStatus.completed) {
      throw new BadRequestException('Проведённую закупку нельзя отменить');
    }
    await this.prisma.purchase.update({
      where: { id },
      data: { status: PurchaseStatus.cancelled },
    });
    return this.findOne(id);
  }

  private normalizeItems(items: PurchaseItemInputDto[]) {
    if (!items || items.length === 0) {
      throw new BadRequestException('Добавьте хотя бы одну позицию');
    }
    return items.map((i) => {
      const quantity = Number(i.quantity);
      if (!i.ingredientId) throw new BadRequestException('Выберите сырьё в каждой позиции');
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException('Количество должно быть больше 0');
      }

      // Если задана сумма — она авторитетна, цену за единицу выводим из неё.
      const hasTotal = i.total != null && Number.isFinite(Number(i.total)) && Number(i.total) >= 0;
      let total: number;
      let purchasePrice: number;
      if (hasTotal) {
        total = Math.round(Number(i.total) * 100) / 100;
        purchasePrice = quantity > 0 ? total / quantity : 0;
      } else {
        purchasePrice = Number(i.purchasePrice);
        if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
          throw new BadRequestException('Укажите цену за единицу или сумму позиции');
        }
        total = Math.round(quantity * purchasePrice * 100) / 100;
      }
      // purchasePrice хранится с округлением до копеек (для отображения);
      // в расчёте себестоимости используется авторитетный total.
      return {
        ingredientId: i.ingredientId,
        quantity,
        purchasePrice: Math.round(purchasePrice * 100) / 100,
        total,
      };
    });
  }

  private dateRange(from?: string, to?: string): Prisma.PurchaseWhereInput {
    if (!from && !to) return {};
    const gte = from ? new Date(from) : undefined;
    const lte = to ? new Date(`${to}T23:59:59.999`) : undefined;
    return { date: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } };
  }
}
