import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { IngredientUnitType, Prisma, Role, WarehousePackage } from '@prisma/client';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { getCafeId } from '../tenant/tenant-context';
import { normalizeUnit, toBase, unitType, unitLabel } from './units';
import { purchaseUnitsFor } from './purchase-units';

function tenant() { const id = getCafeId(); if (!id) throw new BadRequestException('Заведение не назначено'); return id; }
async function lockPackages(tx: Prisma.TransactionClient, cafeId: string) {
  await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`warehouse-packages:${cafeId}`}))) AS package_lock`;
}
function definition(nameInput: string, unitInput: string, value: number) {
  const name = nameInput?.trim(), unit = normalizeUnit(unitInput);
  if (!name || name.length > 80) throw new BadRequestException('Укажите название фасовки');
  if (!Number.isFinite(value) || value <= 0) throw new BadRequestException('Количество в фасовке должно быть больше нуля');
  const quantity = new Prisma.Decimal(value).toDecimalPlaces(6);
  const quantityBase = quantity.mul(toBase(1, unit)).toDecimalPlaces(3);
  if (quantityBase.lte(0) || quantityBase.gte(100_000_000) || quantity.gte(100_000_000)) throw new BadRequestException('Количество фасовки вне допустимого диапазона');
  return { name, unit, unitType: unitType(unit), quantity, quantityBase };
}
function same(a: Pick<WarehousePackage, 'name' | 'unitType' | 'quantityBase'>, b: ReturnType<typeof definition>) {
  return a.name.trim().toLowerCase() === b.name.toLowerCase() && a.unitType === b.unitType && a.quantityBase.eq(b.quantityBase);
}
function serialize(item: WarehousePackage) { return { ...item, quantity: Number(item.quantity), quantityBase: Number(item.quantityBase), unitLabel: unitLabel(normalizeUnit(item.unit)) }; }

/** Compatibility input from old item cards is promoted to the same shared catalog. */
export async function syncIngredientPackages(tx: Prisma.TransactionClient, ingredient: Prisma.IngredientGetPayload<{}>) {
  if (!ingredient.cafeId) return;
  const entries = purchaseUnitsFor(ingredient);
  if (!entries.length) return;
  await lockPackages(tx, ingredient.cafeId);
  const existing = await tx.warehousePackage.findMany({ where: { cafeId: ingredient.cafeId } });
  for (const entry of entries) {
    const data = definition(entry.name, ingredient.displayUnit, entry.factor);
    if (!existing.some((item) => same(item, data))) existing.push(await tx.warehousePackage.create({ data: { cafeId: ingredient.cafeId, ...data } }));
  }
}

class PackageDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @IsString() @IsNotEmpty() @MaxLength(16) unit: string;
  @IsNumber() @Min(0.000001) quantity: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Injectable()
export class WarehousePackagesService {
  constructor(private readonly prisma: PrismaService) {}
  async list(type?: string, includeInactive = false) {
    if (type && !['mass', 'volume', 'count'].includes(type)) throw new BadRequestException('Выберите тип единицы измерения');
    const rows = await this.prisma.warehousePackage.findMany({ where: { cafeId: tenant(), unitType: type as IngredientUnitType | undefined,
      ...(includeInactive ? {} : { isActive: true }) }, orderBy: [{ name: 'asc' }, { quantityBase: 'asc' }] });
    return rows.map(serialize);
  }
  async save(dto: PackageDto, id?: string) {
    const cafeId = tenant(), data = definition(dto.name, dto.unit, dto.quantity);
    return this.prisma.$transaction(async (tx) => {
      await lockPackages(tx, cafeId);
      if (id && !await tx.warehousePackage.findFirst({ where: { id, cafeId } })) throw new NotFoundException('Фасовка не найдена');
      const others = await tx.warehousePackage.findMany({ where: { cafeId, id: id ? { not: id } : undefined } });
      if (others.some((item) => same(item, data))) throw new ConflictException('Такая фасовка уже существует; проверьте также архив');
      return serialize(id ? await tx.warehousePackage.update({ where: { id, cafeId }, data: { ...data, isActive: dto.isActive } })
        : await tx.warehousePackage.create({ data: { cafeId, ...data, isActive: dto.isActive } }));
    });
  }
  async archive(id: string) {
    const cafeId = tenant();
    if (!await this.prisma.warehousePackage.findFirst({ where: { id, cafeId } })) throw new NotFoundException('Фасовка не найдена');
    return serialize(await this.prisma.warehousePackage.update({ where: { id, cafeId }, data: { isActive: false } }));
  }
}

@Controller('admin/warehouse/packages')
@Roles(Role.OWNER, Role.ADMIN)
@RequirePermission('sections.warehouse')
class WarehousePackagesController {
  constructor(private readonly packages: WarehousePackagesService) {}
  @Get() list(@Query('unitType') type?: string, @Query('includeInactive') all?: string) { return this.packages.list(type, all === 'true'); }
  @Post() @RequirePermission('actions.warehouseSettings') create(@Body() dto: PackageDto) { return this.packages.save(dto); }
  @Patch(':id') @RequirePermission('actions.warehouseSettings') update(@Param('id') id: string, @Body() dto: PackageDto) { return this.packages.save(dto, id); }
  @Delete(':id') @RequirePermission('actions.warehouseSettings') archive(@Param('id') id: string) { return this.packages.archive(id); }
}
@Module({ controllers: [WarehousePackagesController], providers: [WarehousePackagesService] })
export class WarehousePackagesModule {}
