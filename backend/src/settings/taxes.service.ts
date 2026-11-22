import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MenuTax, MenuTaxType, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { PrismaService } from '../prisma/prisma.service';
import type { RefundTaxReversal } from '../orders/order-refund-plan';
import { getCafeId } from '../tenant/tenant-context';
import { warehouseDateRange } from '../warehouse/report-range';
import { SaveTaxDto, TaxListQuery, type TaxReportKind, type TaxReportOperation, TaxReportQuery } from './taxes.dto';

const typeLabels: Record<MenuTaxType, string> = { vat: 'Добавленная стоимость', turnover: 'С оборота' };
const operationLabels: Record<TaxReportOperation, string> = {
  fiscal: 'Продажа с фискальным чеком', nonFiscal: 'Продажа без фискального чека',
  fiscalReversal: 'Возврат с чеком ККМ', nonFiscalReversal: 'Возврат без чека ККМ',
};
const columns = { name: 'Название', rate: 'Процент', type: 'Тип' } as const;
type ReportRow = {
  taxId: string; name: string; rate: number; type: MenuTaxType; kind: TaxReportKind;
  operation: TaxReportOperation;
  salesAmount: Prisma.Decimal; amount: Prisma.Decimal;
};

function workbook(title: string, headers: string[], rows: (string | number)[][], widths: number[]) {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, title);
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

@Injectable()
export class TaxesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  list(query: TaxListQuery = {}) {
    const search = query.search?.trim();
    return this.prisma.menuTax.findMany({
      where: {
        cafeId: getCafeId() ?? null, type: query.type, rate: query.rate,
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      select: { id: true, name: true, type: true, rate: true },
      orderBy: [{ name: query.sort ?? 'asc' }, { id: 'asc' }],
    });
  }

  async save(dto: SaveTaxDto, actor: AuditActor, id?: string) {
    const cafeId = getCafeId() ?? null;
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Укажите название налога');
    const before = id ? await this.find(id) : null;
    const data = { name, rate: dto.rate, type: dto.type };
    const saved = id
      ? await this.prisma.menuTax.update({ where: { id, cafeId }, data })
      : await this.prisma.menuTax.create({ data: { ...data, cafeId } });
    await this.log(actor, saved, before ? 'изменил' : 'добавил', before, saved);
    return saved;
  }

  async remove(id: string, actor: AuditActor) {
    const before = await this.find(id);
    try {
      await this.prisma.menuTax.delete({ where: { id, cafeId: getCafeId() ?? null } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('Налог используется в меню. Сначала измените его в позициях и категориях.');
      }
      throw error;
    }
    await this.log(actor, before, 'удалил', before, null);
    return { ok: true };
  }

  async exportList(query: TaxListQuery) {
    const selected = (query.columns ?? 'name,rate,type').split(',');
    if (selected.some((key) => !Object.prototype.hasOwnProperty.call(columns, key)) || new Set(selected).size !== selected.length) {
      throw new BadRequestException('Укажите допустимые столбцы налогов без повторов');
    }
    const keys = selected as (keyof typeof columns)[];
    const taxes = await this.list(query);
    return workbook('Налоги', keys.map((key) => columns[key]), taxes.map((tax) => {
      const values = { name: tax.name, rate: tax.rate.toNumber(), type: typeLabels[tax.type] };
      return keys.map((key) => values[key]);
    }), keys.map((key) => key === 'rate' ? 14 : 28));
  }

  async report(query: TaxReportQuery) {
    const range = warehouseDateRange(query.from, query.to);
    const cafeId = getCafeId() ?? null;
    const where: Prisma.OrderTaxWhereInput = { cafeId };
    if (range) where.OR = [{ soldAt: range }, { reversedAt: range }];
    const includesRefunds = query.kind !== 'fiscal' && query.kind !== 'nonFiscal';
    const [entries, refunds] = await Promise.all([
      this.prisma.orderTax.findMany({
        where, select: { taxId: true, name: true, rate: true, type: true, salesAmount: true, amount: true,
          fiscalizedAt: true, soldAt: true, reversedAt: true },
      }),
      includesRefunds ? this.prisma.orderRefund.findMany({
        where: { cafeId, status: 'approved', decidedAt: range },
        select: { taxReversals: true, fiscalRefundReference: true },
      }) : [],
    ]);
    const inRange = (date: Date | null) => date != null
      && (!range?.gte || date >= range.gte) && (!range?.lte || date <= range.lte);
    const grouped = new Map<string, ReportRow>();
    function add(entry: Omit<ReportRow, 'kind' | 'operation' | 'rate'> & { rate: Prisma.Decimal }, operation: TaxReportOperation) {
      const kind = operation === 'fiscal' || operation === 'nonFiscal' ? operation : 'reversal';
      if (query.kind && query.kind !== kind && query.kind !== operation) return;
      const sign = kind === 'reversal' ? -1 : 1;
      const rate = entry.rate.toNumber();
      const key = JSON.stringify([entry.taxId, entry.name, rate, entry.type, operation]);
      const row = grouped.get(key);
      const salesAmount = entry.salesAmount.mul(sign);
      const amount = entry.amount.mul(sign);
      grouped.set(key, {
        taxId: entry.taxId, name: entry.name, rate, type: entry.type, kind, operation,
        salesAmount: row ? row.salesAmount.add(salesAmount) : salesAmount,
        amount: row ? row.amount.add(amount) : amount,
      });
    }
    for (const entry of entries) {
      if (inRange(entry.soldAt)) add(entry, entry.fiscalizedAt ? 'fiscal' : 'nonFiscal');
      if (inRange(entry.reversedAt)) add(entry, 'nonFiscalReversal');
    }
    for (const refund of refunds) {
      const reference = refund.fiscalRefundReference?.trim();
      const operation = reference && !reference.startsWith('MOCK-') ? 'fiscalReversal' : 'nonFiscalReversal';
      for (const entry of refund.taxReversals as RefundTaxReversal[]) {
        add({ ...entry, rate: new Prisma.Decimal(entry.rate), salesAmount: new Prisma.Decimal(entry.salesAmount),
          amount: new Prisma.Decimal(entry.amount) }, operation);
      }
    }
    const sort = query.sort ?? 'name';
    return Array.from(grouped.values()).sort((a, b) => {
      const order = sort === 'name' ? a.name.localeCompare(b.name, 'ru')
        : sort === 'rate' ? a.rate - b.rate : a[sort].comparedTo(b[sort]);
      return order * (query.direction === 'desc' ? -1 : 1);
    });
  }

  async exportReport(query: TaxReportQuery) {
    const rows = await this.report(query);
    return workbook('Налоги с продаж', ['Название', 'Процент', 'Тип', 'Операция', 'Сумма продаж', 'Сумма налога'],
      rows.map((row) => [row.name, row.rate, typeLabels[row.type], operationLabels[row.operation], row.salesAmount.toNumber(), row.amount.toNumber()]),
      [28, 14, 25, 31, 18, 18]);
  }

  private async find(id: string) {
    const tax = await this.prisma.menuTax.findFirst({ where: { id, cafeId: getCafeId() ?? null } });
    if (!tax) throw new NotFoundException('Налог не найден');
    return tax;
  }

  private log(actor: AuditActor, tax: MenuTax, action: string, before: MenuTax | null, after: MenuTax | null) {
    const snapshot = (row: MenuTax) => ({ name: row.name, rate: row.rate.toNumber(), type: row.type });
    return this.audit.log({
      actor, actionType: AuditAction.SETTINGS_UPDATED, entityType: AuditEntity.SETTINGS, entityId: tax.id,
      description: `${actor.name ?? 'Сотрудник'} ${action} налог «${tax.name}»`,
      oldValue: before ? snapshot(before) : undefined, newValue: after ? snapshot(after) : undefined,
    });
  }
}
