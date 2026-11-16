import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { getDefaultPermissionsByRole, sanitizePermissionsInput } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { lockFinance } from '../finance/finance-ledger';
import { currentPayrollMonth, salaryRates, type SalaryRates } from '../finance/payroll';

const assignableRoles = [Role.ADMIN, Role.WAITER, Role.KITCHEN, Role.BAR];
const positionSelect = {
  id: true, name: true, role: true, permissions: true, _count: { select: { users: true } },
  salaryRates: { orderBy: { effectiveMonth: 'desc' }, take: 1 },
} satisfies Prisma.StaffPositionSelect;

type Position = Prisma.StaffPositionGetPayload<{ select: typeof positionSelect }>;

function positionView({ _count, salaryRates: history, ...position }: Position) {
  return { ...position, employees: _count.users, salary: salaryRates(history[0]), salaryEffectiveMonth: history[0]?.effectiveMonth ?? null };
}

class PositionSalaryDto implements SalaryRates {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9_999_999_999.99) hourly!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9_999_999_999.99) perShift!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9_999_999_999.99) monthly!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) personalPercent!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) shiftPercent!: number;
}

function positionPermissions(role: Role, input: unknown) {
  if (role === Role.ADMIN) return sanitizePermissionsInput(role, input);
  const defaults = getDefaultPermissionsByRole(role);
  if (role === Role.WAITER) defaults.actions.financeCashShifts = sanitizePermissionsInput(role, input).actions.financeCashShifts;
  return defaults;
}

class UpdatePositionDto {
  @IsString() @MaxLength(80)
  name!: string;

  @IsOptional() @IsObject()
  permissions?: Record<string, unknown>;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => PositionSalaryDto)
  salary?: PositionSalaryDto;
}

class CreatePositionDto extends UpdatePositionDto {
  @IsIn(assignableRoles)
  role!: Role;
}

class RemovePositionDto {
  @IsOptional() @IsUUID()
  replacementPositionId?: string | null;
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
    if (!assignableRoles.includes(dto.role as (typeof assignableRoles)[number])) throw new BadRequestException('Выберите базовую роль сотрудника');
    const permissions = positionPermissions(dto.role, dto.permissions);
    const salary = dto.salary && Object.values(dto.salary).some((amount) => amount > 0) ? dto.salary : undefined;
    const row = await this.withUniqueName(() => this.prisma.$transaction(async (db) => {
      const position = await db.staffPosition.create({
        data: { cafeId, name, role: dto.role, permissions: permissions as unknown as Prisma.InputJsonValue },
        select: positionSelect,
      });
      if (salary) position.salaryRates = [await db.staffPositionSalaryRate.create({
        data: { ...salary, cafeId, positionId: position.id, effectiveMonth: currentPayrollMonth() },
      })];
      return position;
    }));
    await this.audit.log({ actor, actionType: AuditAction.POSITION_CREATED, entityType: AuditEntity.POSITION,
      entityId: row.id, description: `Создана должность «${name}»`,
      newValue: { name, role: row.role, permissions: permissions as unknown as Prisma.InputJsonValue, salary: salaryRates(row.salaryRates[0]) } });
    return positionView(row);
  }

  @Patch(':id')
  async update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: UpdatePositionDto) {
    const cafeId = this.cafe(actor);
    const name = this.name(dto.name);
    const { before, row } = await this.withUniqueName(() => this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const before = await this.find(cafeId, id, db);
      const permissions = positionPermissions(before.role, dto.permissions ?? before.permissions);
      const oldSalary = salaryRates(before.salaryRates[0]);
      if (dto.salary && (Object.keys(oldSalary) as (keyof SalaryRates)[]).some((key) => dto.salary![key] !== oldSalary[key])) {
        const effectiveMonth = currentPayrollMonth();
        await db.staffPositionSalaryRate.upsert({
          where: { cafeId_positionId_effectiveMonth: { cafeId, positionId: id, effectiveMonth } },
          create: { ...dto.salary, cafeId, positionId: id, effectiveMonth }, update: dto.salary,
        });
      }
      const row = await db.staffPosition.update({
        where: { cafeId_id: { cafeId, id } },
        data: { name, permissions: permissions as unknown as Prisma.InputJsonValue },
        select: positionSelect,
      });
      return { before, row };
    }));
    await this.audit.log({ actor, actionType: AuditAction.POSITION_UPDATED, entityType: AuditEntity.POSITION,
      entityId: id, description: `Изменена должность «${name}»`,
      oldValue: { name: before.name, permissions: before.permissions, salary: salaryRates(before.salaryRates[0]) },
      newValue: { name, permissions: row.permissions, salary: salaryRates(row.salaryRates[0]) } });
    return positionView(row);
  }

  @Delete(':id')
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: RemovePositionDto = {}) {
    const cafeId = this.cafe(actor);
    const { before, replacement, transferred } = await this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const before = await this.find(cafeId, id, db);
      if (before._count.users && dto.replacementPositionId === undefined) {
        throw new ConflictException('Выберите должность, на которую будут переведены сотрудники');
      }
      const replacementId = dto.replacementPositionId;
      const replacement = replacementId ? await this.find(cafeId, replacementId, db) : null;
      if (replacement && (replacement.id === before.id || replacement.role !== before.role)) {
        throw new BadRequestException('Выберите другую должность с той же базовой ролью');
      }
      const transferred = replacementId !== undefined ? (await db.user.updateMany({
        where: { cafeId, positionId: id, role: before.role },
        data: { positionId: replacement?.id ?? null, permissions: Prisma.DbNull },
      })).count : 0;
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
