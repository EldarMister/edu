import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { OrderItemStatus, Prisma, Role } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SERVER_EVENTS } from '../realtime/events';
import { EventsGateway } from '../realtime/events.gateway';
import { BUILTIN_STATIONS, lockStationRouting, PrepStation, stationCatalog, stationRecordId } from './preparation-stations';

class CreateStationDto {
  @IsString() @MaxLength(80)
  name!: string;
}

class UpdateStationDto {
  @IsOptional() @IsString() @MaxLength(80)
  name?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

@Controller('prep-stations')
export class PreparationStationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles(Role.OWNER, Role.ADMIN, Role.KITCHEN, Role.BAR, Role.WAITER)
  async list(@CurrentUser() user: AuthUser) {
    const stations = user.cafeId
      ? await this.prisma.preparationStation.findMany({
          where: { cafeId: user.cafeId },
          select: { id: true, name: true, isActive: true },
          orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        })
      : [];
    return user.cafeId ? stationCatalog(stations, user.cafeId) : BUILTIN_STATIONS;
  }

  @Post()
  @Roles(Role.OWNER)
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateStationDto) {
    const cafeId = this.cafeId(user);
    const name = this.stationName(dto.name);
    const station = await this.prisma.$transaction(async (tx) => {
      await lockStationRouting(tx, cafeId);
      await this.ensureUniqueName(tx, cafeId, name);
      return tx.preparationStation.create({ data: { cafeId, name } });
    });
    return this.publish(user, station);
  }

  @Patch(':id')
  @Roles(Role.OWNER)
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateStationDto) {
    const cafeId = this.cafeId(user);
    if (id.startsWith('builtin:')) throw new NotFoundException('Станция не найдена');
    const builtin = BUILTIN_STATIONS.find((station) => station.id === id);
    const recordId = stationRecordId(cafeId, id);
    const name = dto.name == null ? undefined : this.stationName(dto.name);
    const station = await this.prisma.$transaction(async (tx) => {
      await lockStationRouting(tx, cafeId);
      const record = await tx.preparationStation.findFirst({ where: { id: recordId, cafeId } });
      const current = record ?? builtin;
      if (!current) throw new NotFoundException('Станция не найдена');
      if (name !== undefined) await this.ensureUniqueName(tx, cafeId, name, id);
      if (dto.isActive === false && current.isActive) {
        const [categories, dishes, staff, pending] = await Promise.all([
          tx.category.count({ where: { cafeId, prepStation: id } }),
          tx.dish.count({ where: { cafeId, prepStation: id } }),
          tx.user.count({ where: {
            cafeId,
            OR: [
              { prepStation: id },
              ...(builtin ? [{ prepStation: null, role: id === PrepStation.bar ? Role.BAR : Role.KITCHEN }] : []),
            ],
          } }),
          tx.orderItem.count({ where: {
            cafeId, prepStation: id,
            status: { in: [OrderItemStatus.new, OrderItemStatus.accepted, OrderItemStatus.cooking] },
          } }),
        ]);
        if (categories || dishes) throw new ConflictException('Сначала переназначьте блюда и категории станции');
        if (staff) throw new ConflictException('Сначала переназначьте сотрудников станции');
        if (pending) throw new ConflictException('Сначала завершите текущие заказы станции');
      }
      const data = { name: name ?? current.name, isActive: dto.isActive ?? current.isActive };
      if (record) return tx.preparationStation.update({ where: { id: recordId, cafeId }, data });
      return tx.preparationStation.create({ data: { id: recordId, cafeId, ...data } });
    });
    return this.publish(user, { ...station, id }, !!builtin);
  }

  private cafeId(user: AuthUser) {
    if (!user.cafeId) throw new BadRequestException('Заведение не назначено');
    return user.cafeId;
  }

  private stationName(value: string) {
    const name = value.trim();
    if (!name) throw new BadRequestException('Укажите название станции');
    return name;
  }

  private async ensureUniqueName(tx: Prisma.TransactionClient, cafeId: string, name: string, excludeId?: string) {
    const records = await tx.preparationStation.findMany({ where: { cafeId }, select: { id: true, name: true, isActive: true } });
    const normalized = name.toLowerCase();
    if (normalized === 'без отправки' || stationCatalog(records, cafeId).some((station) =>
      station.id !== excludeId && station.name.toLowerCase() === normalized
    )) throw new ConflictException('Станция с таким названием уже существует');
  }

  private async publish(user: AuthUser, station: { id: string; name: string; isActive: boolean }, isBuiltIn = false) {
    const record = { id: station.id, name: station.name, isActive: station.isActive, isBuiltIn };
    await this.audit.log({
      actor: user,
      actionType: AuditAction.SETTINGS_UPDATED,
      entityType: AuditEntity.SETTINGS,
      entityId: station.id,
      description: `Настройки станции «${station.name}» обновлены`,
      newValue: record,
    });
    this.events.emitBroadcast(SERVER_EVENTS.SETTINGS_UPDATED, { cafeId: user.cafeId });
    return record;
  }
}
