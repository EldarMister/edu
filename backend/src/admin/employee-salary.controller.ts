import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { lockFinance } from '../finance/finance-ledger';
import { futureSalaryDay } from '../finance/employee-salary';
import { salaryRates } from '../finance/payroll';
import { warehouseDay } from '../warehouse/report-range';
import { PositionSalaryDto } from './positions.controller';

class EmployeeSalaryDto {
  @IsBoolean() usePosition!: boolean;
  @IsString() @MaxLength(10) effectiveDay!: string;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => PositionSalaryDto)
  salary?: PositionSalaryDto;
}

@Controller('admin/staff/:id/salary')
@Roles(Role.OWNER)
export class EmployeeSalaryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@Param('id') userId: string, @CurrentUser() actor: AuthUser) {
    const cafeId = actor.cafeId;
    if (!cafeId || !await this.prisma.user.findFirst({ where: { cafeId, id: userId, role: { not: Role.OWNER } }, select: { id: true } })) {
      throw new NotFoundException('Сотрудник не найден');
    }
    const scope = { cafeId, userId };
    const today = warehouseDay(new Date());
    const [overrides, position] = await Promise.all([
      this.prisma.employeeSalaryOverride.findMany({ where: scope, orderBy: { effectiveDay: 'desc' } }),
      this.prisma.employeeSalaryRate.findFirst({ where: { ...scope, effectiveDay: { lte: today } }, orderBy: { effectiveDay: 'desc' } }),
    ]);
    const view = (row: typeof overrides[number]) => ({
      effectiveDay: row.effectiveDay, usePosition: row.usePosition, salary: salaryRates(row),
    });
    const current = overrides.find((row) => row.effectiveDay <= today);
    return { current: current ? view(current) : null, scheduled: overrides.filter((row) => row.effectiveDay > today).map(view),
      positionSalary: salaryRates(position) };
  }

  @Patch()
  async save(@Param('id') userId: string, @Body() dto: EmployeeSalaryDto, @CurrentUser() actor: AuthUser) {
    const cafeId = actor.cafeId;
    if (!cafeId) throw new NotFoundException('Заведение не найдено');
    if (!dto.usePosition && !dto.salary) throw new BadRequestException('Укажите личные ставки');
    const effectiveDay = futureSalaryDay(dto.effectiveDay);
    const rates = dto.usePosition ? salaryRates() : dto.salary!;
    await this.prisma.$transaction(async (tx) => {
      await lockFinance(tx, cafeId);
      if (!await tx.user.findFirst({ where: { cafeId, id: userId, role: { not: Role.OWNER } }, select: { id: true } })) {
        throw new NotFoundException('Сотрудник не найден');
      }
      const key = { cafeId, userId, effectiveDay };
      const data = { ...rates, usePosition: dto.usePosition };
      await tx.employeeSalaryOverride.upsert({ where: { cafeId_userId_effectiveDay: key }, create: { ...key, ...data }, update: data });
      await tx.auditLog.create({ data: { cafeId, userId: actor.id, userName: actor.name, userRole: actor.role,
        actionType: 'STAFF_SALARY_CHANGED', entityType: 'USER', entityId: userId,
        description: dto.usePosition ? 'Назначены ставки должности' : 'Назначены личные ставки сотрудника',
        newValue: { effectiveDay, ...data } } });
    });
    return this.get(userId, actor);
  }
}
