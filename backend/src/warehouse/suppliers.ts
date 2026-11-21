import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { getCafeId } from '../tenant/tenant-context';

function cafeId() {
  const value = getCafeId();
  if (!value) throw new BadRequestException('Заведение не назначено');
  return value;
}

async function lockName(tx: Prisma.TransactionClient, tenant: string, name: string) {
  await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`supplier:${tenant}:${name.toLowerCase()}`}))) AS supplier_lock`;
}

/** Resolve once at document creation. The text remains an immutable supplier
 * snapshot even when the shared supplier card is renamed later. */
export async function resolveWarehouseSupplier(tx: Prisma.TransactionClient, input: {
  supplier?: string | null; supplierId?: string | null; required?: boolean;
}) {
  const tenant = cafeId();
  if (input.supplierId) {
    const record = await tx.warehouseSupplier.findFirst({ where: { id: input.supplierId, cafeId: tenant, isActive: true } });
    if (!record) throw new NotFoundException('Поставщик не найден или находится в архиве');
    return { supplierId: record.id, supplier: record.name };
  }
  const name = input.supplier?.trim();
  if (!name) {
    if (input.required) throw new BadRequestException('Укажите поставщика');
    return { supplierId: null, supplier: null };
  }
  await lockName(tx, tenant, name);
  const candidates = await tx.warehouseSupplier.findMany({ where: { cafeId: tenant }, orderBy: { isActive: 'desc' }, select: { id: true, name: true, isActive: true } });
  const existing = candidates.find((entry) => entry.name.trim().toLowerCase() === name.toLowerCase());
  if (existing && !existing.isActive) throw new BadRequestException('Поставщик находится в архиве. Восстановите его в настройках склада');
  const record = existing ?? await tx.warehouseSupplier.create({ data: { cafeId: tenant, name } });
  return { supplierId: record.id, supplier: record.name };
}

class SupplierDto {
  @IsOptional() @IsString() @MaxLength(500) address?: string | null;
  @IsOptional() @IsString() @MaxLength(80) taxId?: string | null;
  @IsString() @IsNotEmpty() @MaxLength(160)
  name: string;
  @IsOptional() @IsString() @MaxLength(80)
  phone?: string | null;
  @IsOptional() @IsString() @MaxLength(254)
  email?: string | null;
  @IsOptional() @IsString() @MaxLength(2000)
  note?: string | null;
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

@Injectable()
export class WarehouseSuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  list(includeInactive = false) {
    return this.prisma.warehouseSupplier.findMany({ where: { cafeId: cafeId(), ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  }

  async save(dto: SupplierDto, id?: string) {
    const tenant = cafeId(), name = dto.name.trim();
    if (!name) throw new BadRequestException('Укажите название поставщика');
    if (dto.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dto.email.trim())) throw new BadRequestException('Укажите корректный email');
    return this.prisma.$transaction(async (tx) => {
      await lockName(tx, tenant, name);
      if (id && !await tx.warehouseSupplier.findFirst({ where: { id, cafeId: tenant } })) throw new NotFoundException('Поставщик не найден');
      const candidates = await tx.warehouseSupplier.findMany({ where: { cafeId: tenant, id: id ? { not: id } : undefined, ...(id ? { isActive: true } : {}) }, select: { id: true, name: true } });
      const duplicate = candidates.find((entry) => entry.name.trim().toLowerCase() === name.toLowerCase());
      if (duplicate) throw new ConflictException('Поставщик с таким названием уже существует');
      const data = { name, address: dto.address === undefined ? undefined : dto.address?.trim() || null,
        taxId: dto.taxId === undefined ? undefined : dto.taxId?.trim() || null, phone: dto.phone === undefined ? undefined : dto.phone?.trim() || null,
        email: dto.email === undefined ? undefined : dto.email?.trim() || null,
        note: dto.note === undefined ? undefined : dto.note?.trim() || null, isActive: dto.isActive };
      return id ? tx.warehouseSupplier.update({ where: { id, cafeId: tenant }, data })
        : tx.warehouseSupplier.create({ data: { cafeId: tenant, ...data } });
    });
  }

  async archive(id: string) {
    const tenant = cafeId();
    const supplier = await this.prisma.warehouseSupplier.findFirst({ where: { id, cafeId: tenant } });
    if (!supplier) throw new NotFoundException('Поставщик не найден');
    return this.prisma.warehouseSupplier.update({ where: { id, cafeId: tenant }, data: { isActive: false } });
  }
}

@Controller('admin/warehouse/suppliers')
@Roles(Role.OWNER, Role.ADMIN)
@RequirePermission('sections.warehouse')
class WarehouseSuppliersController {
  constructor(private readonly suppliers: WarehouseSuppliersService) {}
  @Get() list(@Query('includeInactive') all?: string) { return this.suppliers.list(all === 'true'); }
  @Post() @RequirePermission('actions.warehouseSettings')
  create(@Body() dto: SupplierDto) { return this.suppliers.save(dto); }
  @Patch(':id') @RequirePermission('actions.warehouseSettings')
  update(@Param('id') id: string, @Body() dto: SupplierDto) { return this.suppliers.save(dto, id); }
  @Delete(':id') @RequirePermission('actions.warehouseSettings')
  archive(@Param('id') id: string) { return this.suppliers.archive(id); }
}

@Module({ controllers: [WarehouseSuppliersController], providers: [WarehouseSuppliersService] })
export class WarehouseSuppliersModule {}
