import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { getDefaultPermissionsByRole, sanitizePermissionsInput } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';

const assignableRoles = [Role.ADMIN, Role.WAITER, Role.KITCHEN, Role.BAR];
const positionSelect = {
  id: true, name: true, role: true, permissions: true, _count: { select: { users: true } },
} satisfies Prisma.StaffPositionSelect;

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
}

class CreatePositionDto extends UpdatePositionDto {
  @IsIn(assignableRoles)
  role!: Role;
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
    return rows.map(({ _count, ...row }) => ({ ...row, employees: _count.users }));
  }

  @Post()
  async create(@CurrentUser() actor: AuthUser, @Body() dto: CreatePositionDto) {
    const cafeId = this.cafe(actor);
    const name = this.name(dto.name);
    if (!assignableRoles.includes(dto.role as (typeof assignableRoles)[number])) throw new BadRequestException('Выберите базовую роль сотрудника');
    const permissions = positionPermissions(dto.role, dto.permissions);
    const row = await this.withUniqueName(() => this.prisma.staffPosition.create({
      data: { cafeId, name, role: dto.role, permissions: permissions as unknown as Prisma.InputJsonValue },
      select: positionSelect,
    }));
    await this.audit.log({ actor, actionType: AuditAction.POSITION_CREATED, entityType: AuditEntity.POSITION,
      entityId: row.id, description: `Создана должность «${name}»`,
      newValue: { name, role: row.role, permissions: permissions as unknown as Prisma.InputJsonValue } });
    const { _count, ...position } = row;
    return { ...position, employees: _count.users };
  }

  @Patch(':id')
  async update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: UpdatePositionDto) {
    const cafeId = this.cafe(actor);
    const before = await this.find(cafeId, id);
    const name = this.name(dto.name);
    const permissions = positionPermissions(before.role, dto.permissions ?? before.permissions);
    const row = await this.withUniqueName(() => this.prisma.staffPosition.update({
      where: { cafeId_id: { cafeId, id } },
      data: { name, permissions: permissions as unknown as Prisma.InputJsonValue },
      select: positionSelect,
    }));
    await this.audit.log({ actor, actionType: AuditAction.POSITION_UPDATED, entityType: AuditEntity.POSITION,
      entityId: id, description: `Изменена должность «${name}»`,
      oldValue: { name: before.name, permissions: before.permissions },
      newValue: { name, permissions: permissions as unknown as Prisma.InputJsonValue } });
    const { _count, ...position } = row;
    return { ...position, employees: _count.users };
  }

  @Delete(':id')
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    const cafeId = this.cafe(actor);
    const before = await this.find(cafeId, id);
    if (before._count.users) throw new ConflictException('Сначала назначьте сотрудникам другую должность');
    try {
      await this.prisma.staffPosition.delete({ where: { cafeId_id: { cafeId, id } } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2003', 'P2014'].includes(error.code)) {
        throw new ConflictException('Сначала назначьте сотрудникам другую должность');
      }
      throw error;
    }
    await this.audit.log({ actor, actionType: AuditAction.POSITION_DELETED, entityType: AuditEntity.POSITION,
      entityId: id, description: `Удалена должность «${before.name}»`, oldValue: { name: before.name, role: before.role } });
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

  private async find(cafeId: string, id: string) {
    const row = await this.prisma.staffPosition.findFirst({ where: { cafeId, id }, select: positionSelect });
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
