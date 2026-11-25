import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
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
  WarehouseDocumentsQueryDto, WriteoffPreviewDto, WriteoffReasonDto,
} from './documents.dto';
import { WarehouseDocumentsService } from './documents.service';
import { assertWarehousePermission } from './warehouse-permissions';
import { WarehouseRegisterExportDto, sendWarehouseWorkbook } from './warehouse-register-xlsx';

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
  reasons(@Query('includeArchived') includeArchived?: string) {
    return this.documents.reasons(includeArchived === 'true');
  }

  @Post('reasons')
  @RequirePermission('sections.warehouse', 'actions.warehouseSettings')
  createReason(@Body() dto: WriteoffReasonDto) {
    return this.documents.saveWriteoffReason(dto);
  }

  @Patch('reasons/:id')
  @RequirePermission('sections.warehouse', 'actions.warehouseSettings')
  updateReason(@Param('id') id: string, @Body() dto: WriteoffReasonDto) {
    return this.documents.saveWriteoffReason(dto, id);
  }

  @Delete('reasons/:id')
  @RequirePermission('sections.warehouse', 'actions.warehouseSettings')
  removeReason(@Param('id') id: string) {
    return this.documents.removeWriteoffReason(id);
  }

  @Get('writeoff-options')
  writeoffOptions(@Query('effectiveAt') effectiveAt?: string) { return this.documents.writeoffOptions(effectiveAt); }

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

  @Post('transfer-register.xlsx')
  @RequirePermission('actions.exportReports')
  async exportTransfers(@CurrentUser() user: AuthUser, @Body() dto: WarehouseRegisterExportDto, @Res() response: Response) {
    const showCosts = hasPermission(resolvePermissions(user.role as Role, user.permissions), 'actions.warehouseCosts');
    sendWarehouseWorkbook(response, await this.documents.transferRegister(dto, showCosts), 'transfers.xlsx');
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

  @Get(':id/inventory.xlsx')
  @RequirePermission('actions.exportReports')
  async getInventoryWorkbook(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res() response: Response) {
    const showCosts = hasPermission(resolvePermissions(user.role as Role, user.permissions), 'actions.warehouseCosts');
    const workbook = await this.documents.inventoryWorkbook(id, showCosts);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="inventory.xlsx"');
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

  @Delete('writeoffs/:id')
  async removeWriteoff(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WarehouseDocumentRevisionDto) {
    const result = await this.documents.removeWriteoff(user, id, dto?.revision);
    this.events.emitToCafeAdmins(user.cafeId, SERVER_EVENTS.WAREHOUSE_UPDATED, {});
    return result;
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
