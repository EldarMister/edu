import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import { PurchasesService } from './purchases.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CreatePurchaseDto, UpdatePurchaseDto } from './dto';
import { PurchaseExportQuery, PurchaseListQuery } from './purchases-query.dto';
import { canViewFinance } from '../finance/finance-access';
import { PurchasePaymentsDto, PurchaseSettlementReasonDto, ReconcilePurchaseDto } from './purchase-settlement.dto';
import { PurchaseSettlementService } from './purchase-settlement';

@Controller('admin/warehouse/purchases')
@Roles(Role.ADMIN, Role.OWNER)
@RequirePermission('sections.warehouse')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService, private readonly settlement: PurchaseSettlementService) {}

  @Get('overview')
  @RequirePermission('actions.warehouseCosts')
  overview(@Query('from') from?: string, @Query('to') to?: string, @Query('warehouseId') warehouseId?: string) {
    return this.purchases.overview({ from, to, warehouseId });
  }

  @Get()
  @RequirePermission('actions.warehouseCosts')
  findAll(@Query() query: PurchaseListQuery, @CurrentUser() user: AuthUser) {
    return this.purchases.findAll(query, canViewFinance(user));
  }

  @Get('export.xlsx')
  @RequirePermission('actions.warehouseCosts', 'actions.exportReports')
  async exportXlsx(@Query() query: PurchaseExportQuery, @CurrentUser() user: AuthUser, @Res() response: Response) {
    const workbook = await this.purchases.exportXlsx(query, canViewFinance(user));
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="warehouse-purchases.xlsx"');
    response.send(workbook);
  }

  @Get('last-prices')
  @RequirePermission('actions.warehouseCosts')
  lastPrices(@Query('ingredientIds') ingredientIds?: string, @Query('warehouseId') warehouseId?: string,
    @Query('excludePurchaseId') excludePurchaseId?: string, @Query('before') before?: string) {
    return this.purchases.lastPrices({ ingredientIds, warehouseId, excludePurchaseId, before });
  }

  @Get('tax-options')
  @RequirePermission('actions.warehouseCosts')
  taxOptions() {
    return this.purchases.taxOptions();
  }

  @Get(':id')
  @RequirePermission('actions.warehouseCosts')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.purchases.findOne(id, canViewFinance(user));
  }

  @Get('settlement/accounts')
  @RequirePermission('sections.finance', 'actions.warehouseReceive', 'actions.warehouseCosts')
  settlementAccounts(@CurrentUser() user: AuthUser) {
    return this.settlement.accounts(user);
  }

  @Post(':id/payments')
  @RequirePermission('sections.finance', 'actions.warehouseReceive', 'actions.warehouseCosts')
  pay(@Param('id') id: string, @Body() dto: PurchasePaymentsDto, @CurrentUser() user: AuthUser) {
    return this.settlement.pay(user, id, dto);
  }

  @Post(':id/settlement/reconcile')
  @RequirePermission('sections.finance', 'actions.warehouseReceive', 'actions.warehouseCosts')
  reconcile(@Param('id') id: string, @Body() dto: ReconcilePurchaseDto, @CurrentUser() user: AuthUser) {
    return this.settlement.reconcile(user, id, dto);
  }

  @Post(':id/payments/:paymentId/reverse')
  @RequirePermission('sections.finance', 'actions.warehouseReceive', 'actions.warehouseCosts')
  reversePayment(@Param('id') id: string, @Param('paymentId') paymentId: string,
    @Body() dto: PurchaseSettlementReasonDto, @CurrentUser() user: AuthUser) {
    return this.settlement.reverse(user, id, paymentId, dto.reason);
  }

  @Post()
  @RequirePermission('actions.warehouseReceive', 'actions.warehouseCosts')
  create(@Body() dto: CreatePurchaseDto, @CurrentUser() user: AuthUser) {
    return this.purchases.create(dto, user);
  }

  @Patch(':id')
  @RequirePermission('actions.warehouseReceive', 'actions.warehouseCosts')
  update(@Param('id') id: string, @Body() dto: UpdatePurchaseDto, @CurrentUser() user: AuthUser) {
    return this.purchases.update(id, dto, user);
  }

  @Post(':id/complete')
  @RequirePermission('actions.warehouseReceive', 'actions.warehouseCosts')
  complete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.purchases.complete(id, user);
  }

  @Post(':id/cancel')
  @RequirePermission('actions.warehouseReceive', 'actions.warehouseCosts')
  cancel(@Param('id') id: string) {
    return this.purchases.cancel(id);
  }
}
