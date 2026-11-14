import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import {
  ReverseWarehouseDocumentDto, CreateWarehouseDocumentDto, UpdateWarehouseDocumentDto, WarehouseDocumentRevisionDto,
  WarehouseDocumentsQueryDto, warehouseWriteoffReasons,
} from './documents.dto';
import { WarehouseDocumentsService } from './documents.service';
import { assertWarehousePermission } from './warehouse-permissions';

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
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateWarehouseDocumentDto) {
    this.assertDocumentPermission(user, dto.kind);
    this.assertFinalizePermission(user, dto.kind, dto.finalize);
    const document = await this.documents.create(user, dto);
    if (dto.finalize) this.events.emitToCafeAdmins(user.cafeId, SERVER_EVENTS.WAREHOUSE_UPDATED, {});
    return document;
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateWarehouseDocumentDto) {
    const kind = (await this.documents.get(id)).kind;
    this.assertDocumentPermission(user, kind);
    this.assertFinalizePermission(user, kind, dto.finalize);
    const document = await this.documents.update(user, id, dto);
    if (dto.finalize) this.events.emitToCafeAdmins(user.cafeId, SERVER_EVENTS.WAREHOUSE_UPDATED, {});
    return document;
  }

  @Post(':id/submit')
  async submit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WarehouseDocumentRevisionDto) {
    this.assertDocumentPermission(user, (await this.documents.get(id)).kind);
    const document = await this.documents.submit(user, id, dto?.revision);
    this.events.emitToCafeAdmins(user.cafeId, SERVER_EVENTS.WAREHOUSE_UPDATED, {});
    return document;
  }

  @Post(':id/approve')
  async approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WarehouseDocumentRevisionDto) {
    const kind = (await this.documents.get(id)).kind;
    if (kind === 'inventory' || kind === 'writeoff') assertWarehousePermission(user, 'warehouseApprove');
    else this.assertDocumentPermission(user, kind);
    const document = await this.documents.approve(user, id, dto?.revision);
    this.events.emitToCafeAdmins(user.cafeId, SERVER_EVENTS.WAREHOUSE_UPDATED, {});
    return document;
  }

  @Post(':id/reverse')
  @RequirePermission('actions.warehouseApprove')
  async reverse(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReverseWarehouseDocumentDto) {
    const document = await this.documents.reverse(user, id, dto.note, dto.revision);
    this.events.emitToCafeAdmins(user.cafeId, SERVER_EVENTS.WAREHOUSE_UPDATED, {});
    return document;
  }

  @Post(':id/reopen')
  @RequirePermission('actions.warehouseApprove')
  async reopen(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WarehouseDocumentRevisionDto) {
    const document = await this.documents.reopen(user, id, dto?.revision);
    this.events.emitToCafeAdmins(user.cafeId, SERVER_EVENTS.WAREHOUSE_UPDATED, {});
    return document;
  }

  private assertFinalizePermission(user: AuthUser, kind: string, finalize?: 'submit' | 'post') {
    if (finalize === 'post' && (kind === 'inventory' || kind === 'writeoff')) {
      assertWarehousePermission(user, 'warehouseApprove');
    }
    if (kind === 'supplier_return') assertWarehousePermission(user, 'warehouseCosts');
  }

  private assertDocumentPermission(user: AuthUser, kind: string) {
    assertWarehousePermission(user, kind === 'inventory' ? 'warehouseCount' : kind === 'writeoff' ? 'warehouseWriteoff'
      : kind === 'transfer' ? 'warehouseTransfer' : 'warehouseReceive');
  }
}
