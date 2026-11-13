import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import {
  CreateWarehouseDocumentDto, UpdateWarehouseDocumentDto, WarehouseDocumentRevisionDto,
  WarehouseDocumentsQueryDto, warehouseWriteoffReasons,
} from './documents.dto';
import { WarehouseDocumentsService } from './documents.service';

@Controller('admin/warehouse/documents')
@Roles(Role.OWNER, Role.ADMIN)
@RequirePermission('sections.warehouse')
export class WarehouseDocumentsController {
  constructor(private readonly documents: WarehouseDocumentsService, private readonly events: EventsGateway) {}

  @Get()
  list(@Query() query: WarehouseDocumentsQueryDto) {
    return this.documents.list(query.warehouseId, query.kind);
  }

  @Get('reasons')
  reasons() {
    return Object.entries(warehouseWriteoffReasons).map(([id, label]) => ({ id, label }));
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.documents.get(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWarehouseDocumentDto) {
    return this.documents.create(user, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateWarehouseDocumentDto) {
    return this.documents.update(user, id, dto);
  }

  @Post(':id/submit')
  async submit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WarehouseDocumentRevisionDto) {
    const document = await this.documents.submit(user, id, dto?.revision);
    this.events.emitToCafeAdmins(user.cafeId, SERVER_EVENTS.WAREHOUSE_UPDATED, {});
    return document;
  }

  @Post(':id/approve')
  @Roles(Role.OWNER)
  async approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WarehouseDocumentRevisionDto) {
    const document = await this.documents.approve(user, id, dto?.revision);
    this.events.emitToCafeAdmins(user.cafeId, SERVER_EVENTS.WAREHOUSE_UPDATED, {});
    return document;
  }

  @Post(':id/reopen')
  @Roles(Role.OWNER)
  async reopen(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WarehouseDocumentRevisionDto) {
    const document = await this.documents.reopen(user, id, dto?.revision);
    this.events.emitToCafeAdmins(user.cafeId, SERVER_EVENTS.WAREHOUSE_UPDATED, {});
    return document;
  }
}
