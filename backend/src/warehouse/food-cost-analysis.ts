import {
  BadGatewayException, Body, Controller, ForbiddenException, Get, HttpCode, Injectable, Post,
  ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { getCafeId } from '../tenant/tenant-context';
import type { FoodCostReport } from './food-cost-report';
import { FoodCostReportQuery } from './reports.dto';
import { WarehouseReportsService } from './reports.service';
import { assertWarehousePermission } from './warehouse-permissions';

type Metric = FoodCostReport['current']['totals'];
type AiConfiguration = { apiKey: string; model: string };
type Analysis = { text: string };
type CodeKind = 'D' | 'C' | 'I';

const requestTimeoutMs = 25_000;
const maxOutputCharacters = 2400;
const responsesUrl = 'https://api.openai.com/v1/responses';
const instructions = [
  'Ты помогаешь владельцу кафе понять отчёт о фудкосте. Ответь по-русски в трёх коротких абзацах без таблиц и Markdown.',
  'Сравни показатели двух периодов, объясни наблюдаемые причины изменений и предложи, что проверить в первую очередь.',
  'Денежные значения указаны в сомах. foodCostPercent — себестоимость в процентах от выручки. Маржа уже учитывает налог.',
  'Используй только предоставленные числа. null означает отсутствие данных. Не рассчитывай изменение в процентах от нуля.',
  'Учитывай, что список позиций и ингредиентов сокращён. Изменение затрат ингредиента само по себе не доказывает изменение рецепта.',
  'Ссылайся на позиции, категории и ингредиенты только по их кодам, например D01, C01, I01. Не придумывай названия.',
  'Отдели наблюдаемые факты от вероятных причин. Не обещай будущий результат и не предлагай менять цены автоматически.',
].join(' ');

function configuration(): AiConfiguration | null {
  const apiKey = process.env.FOOD_COST_OPENAI_API_KEY?.trim();
  const model = process.env.FOOD_COST_OPENAI_MODEL?.trim();
  return apiKey && model ? { apiKey, model } : null;
}

@Injectable()
export class FoodCostAnalysisService {
  private readonly pending = new Map<string, Promise<Analysis>>();

  constructor(private readonly reports: WarehouseReportsService) {}

  available(cafeId: string | null) {
    return this.hasCafe(cafeId) && configuration() !== null;
  }

  async analyze(cafeId: string | null, query: FoodCostReportQuery): Promise<Analysis> {
    if (!this.hasCafe(cafeId)) throw new ForbiddenException('Заведение не назначено');
    const config = configuration();
    if (!config) throw new ServiceUnavailableException('ИИ-анализ фудкоста не настроен');

    const key = JSON.stringify([cafeId, query.from, query.to]);
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const work = this.generate(query, config).finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }

  private hasCafe(cafeId: string | null) {
    return !!cafeId && cafeId === getCafeId();
  }

  private async generate(query: FoodCostReportQuery, config: AiConfiguration): Promise<Analysis> {
    const report = await this.reports.foodCost(query);
    if (!report.positions.length && !report.ingredients.length)
      throw new UnprocessableEntityException('За выбранные периоды нет продаж или данных о поставках для анализа.');

    const { facts, names } = buildEvidence(report);
    try {
      const response = await fetch(responsesUrl, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(requestTimeoutMs),
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, store: false, max_output_tokens: 1100, instructions, input: JSON.stringify(facts) }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Responses API request failed');
      }
      const output = await response.json() as ResponseBody;
      const text = output.status === 'completed'
        ? output.output?.flatMap((item) => item.type === 'message' && item.role === 'assistant'
          ? item.content.flatMap((content) => content.type === 'output_text' && typeof content.text === 'string' ? [content.text] : [])
          : []).join('\n').trim()
        : null;
      if (!text) throw new Error('Responses API returned no completed explanation');
      const explanation = text.replace(/\b[CDI]\d{2}\b/g, (code) => names.get(code) ?? code);
      return { text: explanation.slice(0, maxOutputCharacters) };
    } catch {
      throw new BadGatewayException('Не удалось получить ИИ-анализ фудкоста. Попробуйте ещё раз.');
    }
  }
}

@Controller('admin/warehouse/reports/food-cost/analysis')
@Roles(Role.ADMIN, Role.OWNER)
export class FoodCostAnalysisController {
  constructor(private readonly analysis: FoodCostAnalysisService) {}

  @Get('availability')
  availability(@CurrentUser() user: AuthUser) {
    assertWarehousePermission(user, 'warehouseCosts');
    return { available: this.analysis.available(user.cafeId) };
  }

  @Post() @HttpCode(200)
  analyze(@Body() query: FoodCostReportQuery, @CurrentUser() user: AuthUser) {
    assertWarehousePermission(user, 'warehouseCosts');
    return this.analysis.analyze(user.cafeId, query);
  }
}

type ResponseBody = {
  status?: string;
  output?: Array<{ type: string; role?: string; content: Array<{ type: string; text?: string }> }>;
};

function metrics({ revenue, cost, tax, margin, foodCostPercent }: Metric) {
  return { revenue, cost, tax, margin, foodCostPercent };
}

function buildEvidence(report: FoodCostReport) {
  const names = new Map<string, string>();
  const codes = new Map<string, string>();
  const counts = { D: 0, C: 0, I: 0 };
  function code(kind: CodeKind, id: string, name: string) {
    const key = kind + id;
    const existing = codes.get(key);
    if (existing) return existing;
    const alias = kind + String(++counts[kind]).padStart(2, '0');
    names.set(alias, name);
    codes.set(key, alias);
    return alias;
  }

  const categories = new Map<string, { name: string; currentRevenue: number; previousRevenue: number }>();
  for (const position of report.positions) {
    const row = categories.get(position.categoryId) ?? { name: position.category, currentRevenue: 0, previousRevenue: 0 };
    row.currentRevenue += position.current.revenue;
    row.previousRevenue += position.previous.revenue;
    categories.set(position.categoryId, row);
  }
  const categorySamples = [...categories].sort(([, a], [, b]) =>
    Math.max(b.currentRevenue, b.previousRevenue) - Math.max(a.currentRevenue, a.previousRevenue)).slice(0, 5)
    .map(([id, { name, currentRevenue, previousRevenue }]) => ({
      code: code('C', id, name), currentRevenue: Number(currentRevenue.toFixed(2)), previousRevenue: Number(previousRevenue.toFixed(2)),
    }));

  const positionSamples = [...report.positions].sort((a, b) =>
    Math.max(b.current.revenue, b.previous.revenue) - Math.max(a.current.revenue, a.previous.revenue)).slice(0, 8)
    .map((row) => ({ code: code('D', row.id, row.name), category: code('C', row.categoryId, row.category),
      current: { ...metrics(row.current), quantity: row.current.quantity },
      previous: { ...metrics(row.previous), quantity: row.previous.quantity },
      components: row.ingredients.slice(0, 2).map((ingredient) => ({
        code: code('I', ingredient.id, ingredient.name),
        currentCost: ingredient.currentCost, previousCost: ingredient.previousCost,
      })),
    }));

  const ingredientMetrics = ({ quantity, cost, purchasePrice }: FoodCostReport['ingredients'][number]['current']) =>
    ({ quantity, cost, purchasePrice });
  const ingredientSamples = [...report.ingredients].sort((a, b) => purchaseImpact(b) - purchaseImpact(a) ||
    (b.current.cost ?? 0) - (a.current.cost ?? 0)).slice(0, 8)
    .map((row) => ({ code: code('I', row.id, row.name), unit: row.unit,
      current: ingredientMetrics(row.current), previous: ingredientMetrics(row.previous) }));
  const period = ({ from, to, totals }: FoodCostReport['current']) => ({ from, to, ...metrics(totals) });
  return { names, facts: { current: period(report.current), previous: period(report.previous),
    categories: categorySamples, positions: positionSamples, ingredients: ingredientSamples } };
}

function purchaseImpact(row: FoodCostReport['ingredients'][number]) {
  const { current, previous } = row;
  return current.purchasePrice == null || previous.purchasePrice == null
    ? 0 : Math.abs(current.purchasePrice - previous.purchasePrice) * Math.abs(current.quantity);
}
