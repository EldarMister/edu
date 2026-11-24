import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { hasPermission, resolvePermissions } from '../common/permissions';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import {
  ReverseWarehouseDocumentDto, CreateWarehouseDocumentDto, UpdateWarehouseDocumentDto, WarehouseDocumentRevisionDto,
  WarehouseDocumentsQueryDto, WriteoffPreviewDto, warehouseWriteoffReasons,
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
    return this.documents.list(query.warehouseId, query.kind, query.search);
  }

  @Get('reasons')
  reasons() {
    return Object.entries(warehouseWriteoffReasons).map(([id, label]) => ({ id, label }));
  }

  @Get('writeoff-options')
  writeoffOptions() { return this.documents.writeoffOptions(); }

  @Post('writeoff-preview')
  @RequirePermission('actions.warehouseWriteoff')
  writeoffPreview(@Body() dto: WriteoffPreviewDto) { return this.documents.writeoffPreview(dto); }

  @Get(':id')
  get(@Param('id') id: string, @Query('includeInventoryContext') includeInventoryContext?: string,
    @Query('inventoryIngredientId') inventoryIngredientId?: string) {
    if (includeInventoryContext !== undefined && includeInventoryContext !== 'true' && includeInventoryContext !== 'false') {
      throw new BadRequestException('Параметр includeInventoryContext принимает true или false');
    }
    if (inventoryIngredientId && (typeof inventoryIngredientId !== 'string' || inventoryIngredientId.length > 160))
      throw new BadRequestException('Некорректный идентификатор складской позиции');
    return this.documents.get(id, includeInventoryContext === 'true', inventoryIngredientId);
  }

  @Get(':id/transfer-act.xlsx')
  @RequirePermission('actions.exportReports')
  async getTransferAct(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res() response: Response) {
    const showCosts = hasPermission(resolvePermissions(user.role as Role, user.permissions), 'actions.warehouseCosts');
    const workbook = await this.documents.transferAct(id, showCosts);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="transfer-act.xlsx"');
    response.send(workbook);
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
