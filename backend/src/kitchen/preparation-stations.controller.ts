import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SERVER_EVENTS } from '../realtime/events';
import { EventsGateway } from '../realtime/events.gateway';
import { BUILTIN_STATIONS, lockStationRouting } from './preparation-stations';

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
    return [...BUILTIN_STATIONS, ...stations.map((station) => ({ ...station, isBuiltIn: false }))];
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
    if (BUILTIN_STATIONS.some((station) => station.id === id)) {
      throw new BadRequestException('Встроенную станцию нельзя изменить');
    }
    const name = dto.name == null ? undefined : this.stationName(dto.name);
    const station = await this.prisma.$transaction(async (tx) => {
      await lockStationRouting(tx, cafeId);
      const current = await tx.preparationStation.findFirst({ where: { id, cafeId } });
      if (!current) throw new NotFoundException('Станция не найдена');
      if (name !== undefined) await this.ensureUniqueName(tx, cafeId, name, id);
      if (dto.isActive === false && current.isActive) {
        const [categories, dishes] = await Promise.all([
          tx.category.count({ where: { cafeId, prepStation: id } }),
          tx.dish.count({ where: { cafeId, prepStation: id } }),
        ]);
        if (categories || dishes) throw new ConflictException('Сначала переназначьте блюда и категории станции');
      }
      return tx.preparationStation.update({
        where: { id },
        data: { name, isActive: dto.isActive ?? undefined },
      });
    });
    return this.publish(user, station);
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
    const reserved = [...BUILTIN_STATIONS.map((station) => station.name), 'Без отправки'];
    if (reserved.some((entry) => entry.toLowerCase() === name.toLowerCase()) || await tx.preparationStation.findFirst({
      where: { cafeId, name: { equals: name, mode: 'insensitive' }, id: excludeId ? { not: excludeId } : undefined },
      select: { id: true },
    })) throw new ConflictException('Станция с таким названием уже существует');
  }

  private async publish(user: AuthUser, station: { id: string; name: string; isActive: boolean }) {
    const record = { id: station.id, name: station.name, isActive: station.isActive, isBuiltIn: false };
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
