import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { fixedPositionWorkspace, resolvePositionPermissions, sanitizePermissionsInput, type EmployeePermissions, type FixedWorkspace, type OwnerOperations } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { lockFinance } from '../finance/finance-ledger';
import { salaryRates, type SalaryRates } from '../finance/payroll';
import { categoryCommissions } from '../finance/payroll-sales';
import { lockStationRouting, staffStation } from '../kitchen/preparation-stations';
import { assertNoActiveWorkShifts, assertStaffWorkspaceChange, disablesWorkTracking, losesOperationalAccess } from './staff-access';
import { futureSalaryDay, nextSalaryDay, syncEmployeeSalary } from '../finance/employee-salary';
import { warehouseDay } from '../warehouse/report-range';

const assignableRoles = [Role.ADMIN, Role.WAITER, Role.KITCHEN, Role.BAR];
const positionSelect = {
  id: true, name: true, role: true, permissions: true, isStarter: true, _count: { select: { users: true } },
  salaryRates: { orderBy: { effectiveDay: 'desc' }, take: 1 },
} satisfies Prisma.StaffPositionSelect;

type Position = Prisma.StaffPositionGetPayload<{ select: typeof positionSelect }>;

function positionView({ _count, salaryRates: history, ...position }: Position) {
  return { ...position, fixedWorkspace: fixedPositionWorkspace(position.role, position.permissions, position.isStarter),
    permissions: resolvePositionPermissions(position), employees: _count.users,
    salary: salaryRates(history[0]), salaryEffectiveDay: history[0]?.effectiveDay ?? null,
    salaryEffectiveMonth: history[0]?.effectiveDay.slice(0, 7) ?? null,
    categoryRates: history[0]?.categoryRates ?? [] };
}

export class PositionSalaryDto implements SalaryRates {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9_999_999_999.99) hourly!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9_999_999_999.99) perShift!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9_999_999_999.99) monthly!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) personalPercent!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) shiftPercent!: number;
}

class CategoryCommissionDto {
  @IsString() @MaxLength(128) categoryId!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) personalPercent?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) shiftPercent?: number;
}

function positionPermissions(role: Role, input: unknown, fixedWorkspace: FixedWorkspace | null = null, fallback?: EmployeePermissions) {
    const stored = input && typeof input === 'object' ? input : {};
    const permissions = sanitizePermissionsInput(role, { ...stored, fixedWorkspace }, fallback);
    permissions.actions.editMenu &&= permissions.sections.menu;
    permissions.actions.refundChecks &&= permissions.sections.checks;
    permissions.actions.manageStaff &&= permissions.sections.staff;
    permissions.actions.createDeliveryOrders &&= permissions.terminalAccess === true;
    permissions.actions.printReceipts &&= permissions.terminalAccess === true;
    for (const key of Object.keys(permissions.actions) as (keyof typeof permissions.actions)[]) {
      if (key.startsWith('warehouse')) permissions.actions[key] &&= permissions.sections.warehouse;
    }
    return fixedWorkspace ? { ...permissions, fixedWorkspace } : permissions;
}

class UpdatePositionDto {
  @IsString() @MaxLength(80)
  name!: string;

  @IsOptional() @IsObject()
  permissions?: Record<string, unknown>;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => PositionSalaryDto)
  salary?: PositionSalaryDto;

  @IsOptional() @IsString() @MaxLength(10)
  salaryEffectiveDay?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(500) @ArrayUnique((row: CategoryCommissionDto) => row.categoryId)
  @ValidateNested({ each: true }) @Type(() => CategoryCommissionDto)
  categoryRates?: CategoryCommissionDto[];
}

class CreatePositionDto extends UpdatePositionDto {
  @IsOptional() @IsIn(assignableRoles)
  role?: Role;
}

class RemovePositionDto {
  @IsOptional() @IsUUID()
  replacementPositionId?: string | null;
}

class OwnerOperationsDto implements OwnerOperations {
  @IsBoolean() refunds!: boolean;
  @IsBoolean() cancelOrders!: boolean;
  @IsBoolean() cancelItems!: boolean;
  @IsBoolean() printRequests!: boolean;
}

@Controller('admin/positions')
@Roles(Role.OWNER)
export class PositionsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  async list(@CurrentUser() actor: AuthUser) {
    const rows = await this.prisma.staffPosition.findMany({
      where: { cafeId: this.cafe(actor) }, select: positionSelect, orderBy: { name: 'asc' },
    });
    return rows.map(positionView);
  }

  @Post()
  async create(@CurrentUser() actor: AuthUser, @Body() dto: CreatePositionDto) {
    const cafeId = this.cafe(actor);
    const name = this.name(dto.name);
    const role = dto.role ?? Role.ADMIN;
    if (!assignableRoles.includes(role as (typeof assignableRoles)[number])) throw new BadRequestException('Выберите тип должности');
    const permissions = positionPermissions(role, dto.permissions);
    const salary = dto.salary ?? salaryRates();
    const row = await this.withUniqueName(() => this.prisma.$transaction(async (db) => {
      const position = await db.staffPosition.create({
        data: { cafeId, name, role, permissions: permissions as unknown as Prisma.InputJsonValue },
        select: positionSelect,
      });
      const categoryRates = await this.categoryRates(db, cafeId, dto.categoryRates ?? []);
      if (categoryRates.length || Object.values(salary).some((amount) => amount > 0)) position.salaryRates = [await db.staffPositionSalaryRate.create({
        data: { ...salary, cafeId, positionId: position.id,
          effectiveDay: dto.salaryEffectiveDay ? futureSalaryDay(dto.salaryEffectiveDay) : warehouseDay(new Date()), categoryRates },
      })];
      return position;
    }));
    await this.audit.log({ actor, actionType: AuditAction.POSITION_CREATED, entityType: AuditEntity.POSITION,
      entityId: row.id, description: `Создана должность «${name}»`,
      newValue: { name, role: row.role, permissions: permissions as unknown as Prisma.InputJsonValue, salary: salaryRates(row.salaryRates[0]) } });
    return positionView(row);
  }

  @Patch('owner-operations')
  async updateOwnerOperations(@CurrentUser() actor: AuthUser, @Body() dto: OwnerOperationsDto) {
    const cafeId = this.cafe(actor);
    const ownerOperations: OwnerOperations = { ...dto };
    await this.prisma.user.update({ where: { id: actor.id, cafeId, role: Role.OWNER },
      data: { permissions: { ownerOperations } } });
    await this.audit.log({ actor, actionType: AuditAction.POSITION_UPDATED, entityType: AuditEntity.POSITION,
      entityId: 'system:OWNER', description: 'Изменены права владельца',
      oldValue: { ownerOperations: actor.permissions.ownerOperations ?? null }, newValue: { ownerOperations } });
    return ownerOperations;
  }

  @Patch(':id')
  async update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: UpdatePositionDto) {
    const cafeId = this.cafe(actor);
    const name = this.name(dto.name);
    const { before, row, scheduledSalary } = await this.withUniqueName(() => this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const before = await this.find(cafeId, id, db);
      const permissions = positionPermissions(before.role, dto.permissions,
        fixedPositionWorkspace(before.role, before.permissions, before.isStarter), resolvePositionPermissions(before));
      const next = { role: before.role, permissions };
      const losesAccess = losesOperationalAccess(before, next);
      const disablesTracking = disablesWorkTracking(before, next);
      if (losesAccess || disablesTracking) {
        const users = await db.user.findMany({ where: { cafeId, positionId: id }, select: { id: true } });
        const userIds = users.map(({ id }) => id);
        if (losesAccess) await assertStaffWorkspaceChange(db, cafeId, userIds, 'отключением рабочего доступа');
        else await assertNoActiveWorkShifts(db, userIds);
      }
      const editsSalary = dto.salary !== undefined || dto.categoryRates !== undefined;
      const effectiveDay = editsSalary ? futureSalaryDay(dto.salaryEffectiveDay) : nextSalaryDay();
      const previousRate = editsSalary ? await db.staffPositionSalaryRate.findFirst({
        where: { cafeId, positionId: id, effectiveDay: { lte: effectiveDay } },
        orderBy: { effectiveDay: 'desc' },
      }) : before.salaryRates[0];
      const oldSalary = salaryRates(previousRate);
      const salary = dto.salary ?? oldSalary;
      const priorCategories = (previousRate?.categoryRates ?? []) as Prisma.InputJsonArray;
      const categoryRates = dto.categoryRates === undefined ? priorCategories :
        await this.categoryRates(db, cafeId, dto.categoryRates, priorCategories);
      const salaryChanged = editsSalary && (
        (Object.keys(oldSalary) as (keyof SalaryRates)[]).some((key) => salary[key] !== oldSalary[key])
        || JSON.stringify(categoryCommissions(categoryRates)) !== JSON.stringify(categoryCommissions(priorCategories))
      );
      if (salaryChanged) {
        await db.staffPositionSalaryRate.upsert({
          where: { cafeId_positionId_effectiveDay: { cafeId, positionId: id, effectiveDay } },
          create: { ...salary, categoryRates, cafeId, positionId: id, effectiveDay }, update: { ...salary, categoryRates },
        });
      }
      const row = await db.staffPosition.update({
        where: { cafeId_id: { cafeId, id } },
        data: { name, permissions: permissions as unknown as Prisma.InputJsonValue },
        select: positionSelect,
      });
      if (salaryChanged || before.name !== row.name) {
        const users = await db.user.findMany({ where: { cafeId, positionId: id }, select: { id: true } });
        await syncEmployeeSalary(db, cafeId, users.map((user) => user.id), before.name !== row.name ? nextSalaryDay() : effectiveDay);
      }
      return { before, row, scheduledSalary: salaryChanged ? { effectiveDay, previous: oldSalary, salary, categoryRates } : null };
    }));
    await this.audit.log({ actor, actionType: AuditAction.POSITION_UPDATED, entityType: AuditEntity.POSITION,
      entityId: id, description: `Изменена должность «${name}»`,
      oldValue: { name: before.name, permissions: before.permissions, salary: salaryRates(before.salaryRates[0]),
        categoryRates: before.salaryRates[0]?.categoryRates ?? [], effectiveDay: before.salaryRates[0]?.effectiveDay ?? null },
      newValue: { name, permissions: row.permissions, salary: salaryRates(row.salaryRates[0]),
        categoryRates: row.salaryRates[0]?.categoryRates ?? [], effectiveDay: row.salaryRates[0]?.effectiveDay ?? null },
      metadata: scheduledSalary ? { scheduledSalary } : undefined });
    return positionView(row);
  }

  @Delete(':id')
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: RemovePositionDto = {}) {
    const cafeId = this.cafe(actor);
    const { before, replacement, transferred } = await this.prisma.$transaction(async (db) => {
      await lockStationRouting(db, cafeId);
      await lockFinance(db, cafeId);
      const before = await this.find(cafeId, id, db);
      if (before._count.users && !dto.replacementPositionId) {
        throw new ConflictException('Выберите должность, на которую будут переведены сотрудники');
      }
      const replacementId = dto.replacementPositionId;
      const replacement = replacementId ? await this.find(cafeId, replacementId, db) : null;
      if (replacement?.id === before.id) {
        throw new BadRequestException('Выберите другую должность');
      }
      const users = await db.user.findMany({ where: { cafeId, positionId: id }, select: { id: true, role: true } });
      const losesAccess = replacement && losesOperationalAccess(before, replacement);
      const changedUsers = replacement ? users.filter((user) => user.role !== replacement.role).map((user) => user.id) : [];
      if (losesAccess) await assertStaffWorkspaceChange(db, cafeId, users.map((user) => user.id), 'сменой должности');
      else if (replacement && disablesWorkTracking(before, replacement)) await assertNoActiveWorkShifts(db, users.map(({ id }) => id));
      if (changedUsers.length) await assertStaffWorkspaceChange(db, cafeId, changedUsers);
      const prepStation = replacement && changedUsers.length ? await staffStation(db, replacement.role) : undefined;
      const transferred = replacement ? (await db.user.updateMany({
        where: { cafeId, positionId: id },
        data: { positionId: replacement.id, role: replacement.role, permissions: Prisma.DbNull,
          ...(changedUsers.length === users.length && changedUsers.length ? { prepStation } : {}) },
      })).count : 0;
      if (changedUsers.length && changedUsers.length !== users.length) {
        await db.user.updateMany({ where: { cafeId, id: { in: changedUsers } }, data: { prepStation } });
      }
      if (replacement && transferred) await syncEmployeeSalary(db, cafeId, users.map((user) => user.id));
      if (transferred !== before._count.users) {
        throw new ConflictException('Проверьте должности сотрудников и попробуйте ещё раз');
      }
      await db.$executeRaw`
        UPDATE finance_categories
        SET position_ids = array_remove(position_ids, ${id})
        WHERE cafe_id = ${cafeId} AND position_ids @> ARRAY[${id}]::text[]
      `;
      await db.staffPosition.delete({ where: { cafeId_id: { cafeId, id } } });
      return { before, replacement, transferred };
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2003', 'P2014'].includes(error.code)) {
        throw new ConflictException('Список сотрудников изменился. Повторите удаление');
      }
      throw error;
    });
    await this.audit.log({ actor, actionType: AuditAction.POSITION_DELETED, entityType: AuditEntity.POSITION,
      entityId: id, description: `Удалена должность «${before.name}»`, oldValue: { name: before.name, role: before.role },
      metadata: { replacementPositionId: replacement?.id ?? null, transferred } });
    return { ok: true };
  }

  private cafe(actor: AuthUser) {
    if (!actor.cafeId || actor.role !== Role.OWNER) throw new ForbiddenException('Должностями управляет владелец заведения');
    return actor.cafeId;
  }

  private name(value: string) {
    const name = value.trim();
    if (!name) throw new BadRequestException('Введите название должности');
    return name;
  }

  private async categoryRates(db: Prisma.TransactionClient, cafeId: string, rows: CategoryCommissionDto[], previous: Prisma.InputJsonArray = []) {
    if (rows.some(({ personalPercent, shiftPercent }) => personalPercent == null && shiftPercent == null)) {
      throw new BadRequestException('Укажите хотя бы один процент для каждой категории');
    }
    const categoryIds = rows.map(({ categoryId }) => categoryId);
    const existing = await db.category.findMany({ where: { cafeId, id: { in: categoryIds } }, select: { id: true } });
    const allowed = new Set(existing.map(({ id }) => id));
    for (const entry of previous) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const categoryId = (entry as Prisma.InputJsonObject).categoryId;
        if (typeof categoryId === 'string') allowed.add(categoryId);
      }
    }
    if (categoryIds.some((id) => !allowed.has(id))) throw new BadRequestException('Категория меню не найдена');
    return rows.map(({ categoryId, personalPercent, shiftPercent }) => ({
      categoryId, ...(personalPercent == null ? {} : { personalPercent }), ...(shiftPercent == null ? {} : { shiftPercent }),
    })).sort((a, b) => a.categoryId.localeCompare(b.categoryId)) satisfies Prisma.InputJsonArray;
  }

  private async find(cafeId: string, id: string, db: Prisma.TransactionClient = this.prisma) {
    const row = await db.staffPosition.findFirst({ where: { cafeId, id }, select: positionSelect });
    if (!row) throw new NotFoundException('Должность не найдена');
    return row;
  }

  private async withUniqueName<T>(run: () => Promise<T>) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Должность с таким названием уже есть');
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Должность не найдена');
      }
      throw error;
    }
  }
}
