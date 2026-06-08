import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminWarehouseService {
  constructor(private prisma: PrismaService) {}

  async overview() {
    const dishes = await this.prisma.dish.findMany({
      where: { trackInventory: true, isActive: true },
      include: { variants: true },
    });

    let totalProducts = dishes.length;
    let totalDrinks = 0; // If they are all drinks, or we can check category
    let lowStockCount = 0;
    let totalUnits = 0;

    for (const d of dishes) {
      if (d.variants.length > 0) {
        let hasLowStockVariant = false;
        for (const v of d.variants) {
          totalUnits += v.stock ?? 0;
          if ((v.stock ?? 0) <= 0.2 * (v.initialStock ?? 0)) {
            hasLowStockVariant = true;
          }
        }
        if (hasLowStockVariant) lowStockCount++;
      } else {
        totalUnits += d.stock ?? 0;
        if ((d.stock ?? 0) <= 0.2 * (d.initialStock ?? 0)) {
          lowStockCount++;
        }
      }
    }

    return {
      totalProducts,
      totalDrinks: totalProducts, // Using total products for now as requested
      lowStockCount,
      totalUnits,
    };
  }

  async getItems(search?: string, categoryId?: string) {
    const where: any = { trackInventory: true, isActive: true };
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (categoryId) {
      where.categoryId = categoryId;
    }

    return this.prisma.dish.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        category: { select: { id: true, name: true } },
        variants: { orderBy: { sortOrder: 'asc' } },
      },
    });
  }
}
