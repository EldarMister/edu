import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentMethod, Prisma, Settings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { UpdateSettingsDto } from './dto';

/** Человекочитаемые названия полей настроек для описаний аудита. */
const SETTINGS_FIELD_LABELS: Record<string, string> = {
  cafeName: 'название кафе',
  address: 'адрес',
  phone: 'телефон',
  phone2: 'второй телефон',
  instagram: 'instagram',
  website: 'сайт',
  receiptText: 'текст чека',
  serviceChargeAmount: 'обслуживание',
  language: 'язык',
  payQr: 'оплата QR',
  payCash: 'оплата наличными',
  payCard: 'оплата картой',
  allowNegativeIngredientStock: 'минусовой остаток сырья',
  queueDisplayEnabled: 'экран очереди заказов',
  queueDisplayMode: 'режим экрана очереди',
  qrGeoEnabled: 'гео-проверка QR',
  qrGeoLat: 'широта кафе',
  qrGeoLng: 'долгота кафе',
  qrGeoRadius: 'радиус гео-проверки',
  qrImageUrl: 'QR-код',
  printerConnected: 'принтер',
  fiscalProvider: 'провайдер ККМ',
  fiscalEkassaApiKey: 'API-ключ eKassa',
  fiscalEkassaUrl: 'URL eKassa',
  fiscalEkassaInn: 'ИНН (eKassa)',
  fiscalYakassaApiKey: 'API-ключ YaKassa',
  fiscalYakassaUrl: 'URL YaKassa',
};

/** Разрешённые форматы загружаемого QR-кода. */
const QR_DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private events: EventsGateway,
  ) {}

  /** Настройки текущего кафе, создавая их при первом обращении.
   *  findFirst/create скоупятся по cafeId middleware'ом (контекст тенанта).
   *  Без контекста (фоновые/публичные) — вернётся единственная строка. */
  async ensure(): Promise<Settings> {
    const existing = await this.prisma.settings.findFirst();
    if (existing) return existing;
    return this.prisma.settings.create({ data: {} });
  }

  /** Полные настройки (для страницы владельца). */
  get() {
    return this.ensure();
  }

  /** Публичная часть: реквизиты кафе, включённые способы оплаты, язык, статус принтера.
   *  Доступна всем ролям (нужна официанту на экране оплаты и в чеке). */
  async getPublic() {
    const s = await this.ensure();
    return {
      cafeName: s.cafeName,
      address: s.address,
      phone: s.phone,
      phone2: s.phone2,
      instagram: s.instagram,
      website: s.website,
      receiptText: s.receiptText,
      serviceChargeAmount: s.serviceChargeAmount,
      language: s.language,
      paymentMethods: this.enabledMethodsOf(s),
      // Лёгкая версионированная ссылка вместо тяжёлого base64 — кэшируется браузером.
      qrImageUrl: s.qrImageUrl ? `/settings/qr?v=${s.updatedAt.getTime()}` : null,
      printerConnected: s.printerConnected,
      // Включена ли ККМ — без раскрытия ключей (нужно фронтенду для подсказок/гейтинга).
      fiscalEnabled: !!s.fiscalProvider,
    };
  }

  /** Конфиг гео-проверки QR-меню. enabled=true только если включена И заданы координаты. */
  async getQrGeoConfig() {
    const s = await this.ensure();
    const hasCoords = s.qrGeoLat != null && s.qrGeoLng != null;
    return {
      enabled: s.qrGeoEnabled && hasCoords,
      lat: s.qrGeoLat,
      lng: s.qrGeoLng,
      radius: s.qrGeoRadius,
    };
  }

  /** Декодирует сохранённый data URL QR-кода в бинарь для отдачи как картинка. */
  async getQrImage(): Promise<{ buffer: Buffer; mime: string } | null> {
    const s = await this.ensure();
    if (!s.qrImageUrl) return null;
    const m = s.qrImageUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (!m) return null;
    return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
  }

  async update(dto: UpdateSettingsDto, actor: AuditActor): Promise<Settings> {
    const current = await this.ensure();

    // Проверка: хотя бы один способ оплаты должен остаться включённым.
    const payQr = dto.payQr ?? current.payQr;
    const payCash = dto.payCash ?? current.payCash;
    const payCard = dto.payCard ?? current.payCard;
    if (!payQr && !payCash && !payCard) {
      throw new BadRequestException('Должен быть включён хотя бы один способ оплаты');
    }

    const data: Prisma.SettingsUpdateInput = { ...dto };
    if (dto.serviceChargeAmount !== undefined) {
      data.serviceChargeAmount = new Prisma.Decimal(round2(dto.serviceChargeAmount));
    }

    // ККМ: пустой провайдер = выключить (храним null, чтобы isEnabled() был false).
    if (dto.fiscalProvider !== undefined) {
      data.fiscalProvider = dto.fiscalProvider.trim() === '' ? null : dto.fiscalProvider;
    }

    // QR-код: пустая строка = удалить; иначе проверяем формат data URL.
    if (dto.qrImageUrl !== undefined) {
      const trimmed = dto.qrImageUrl.trim();
      if (trimmed === '') {
        data.qrImageUrl = null;
      } else if (!QR_DATA_URL_RE.test(trimmed)) {
        throw new BadRequestException('Поддерживаются только изображения PNG, JPG или WEBP');
      } else {
        data.qrImageUrl = trimmed;
      }
    }

    const updated = await this.prisma.settings.update({
      where: { id: current.id },
      data,
    });

    // Считаем, какие именно поля реально изменились.
    const changed: string[] = [];
    const oldValue: Record<string, Prisma.InputJsonValue> = {};
    const newValue: Record<string, Prisma.InputJsonValue> = {};
    for (const key of Object.keys(dto) as (keyof UpdateSettingsDto)[]) {
      const before = (current as Record<string, unknown>)[key];
      const after = (updated as Record<string, unknown>)[key];
      if (before === after) continue;
      changed.push(SETTINGS_FIELD_LABELS[key] ?? key);
      // QR-код — это огромный data URL, в журнал пишем только факт изменения.
      if (key === 'qrImageUrl') {
        oldValue[key] = before ? 'загружен' : 'нет';
        newValue[key] = after ? 'загружен' : 'удалён';
      } else if (key === 'fiscalEkassaApiKey' || key === 'fiscalYakassaApiKey') {
        // Секретные ключи ККМ не пишем в журнал — только факт изменения.
        oldValue[key] = before ? 'задан' : 'нет';
        newValue[key] = after ? 'задан' : 'удалён';
      } else {
        oldValue[key] = before as Prisma.InputJsonValue;
        newValue[key] = after as Prisma.InputJsonValue;
      }
    }

    if (changed.length > 0) {
      await this.audit.log({
        actor,
        actionType: AuditAction.SETTINGS_UPDATED,
        entityType: AuditEntity.SETTINGS,
        entityId: current.id,
        description: `${actor.name ?? 'Владелец'} изменил настройки: ${changed.join(', ')}`,
        oldValue,
        newValue,
      });
      this.events.emitBroadcast(SERVER_EVENTS.SETTINGS_UPDATED, {
        changed: Object.keys(newValue),
        updatedAt: updated.updatedAt,
      });
    }

    return updated;
  }

  /** Список включённых способов оплаты. */
  async enabledMethods(): Promise<PaymentMethod[]> {
    return this.enabledMethodsOf(await this.ensure());
  }

  /** Бросает ошибку, если способ оплаты отключён в настройках. */
  async assertMethodEnabled(method: PaymentMethod) {
    const settings = await this.ensure();
    const enabled = this.enabledMethodsOf(settings);
    if (!enabled.includes(method)) {
      throw new BadRequestException('Этот способ оплаты отключён в настройках');
    }
    if (method === PaymentMethod.qr && !settings.qrImageUrl) {
      throw new BadRequestException('QR-оплата недоступна: QR-код не загружен в настройках');
    }
  }

  private enabledMethodsOf(s: Settings): PaymentMethod[] {
    const list: PaymentMethod[] = [];
    if (s.payQr) list.push(PaymentMethod.qr);
    if (s.payCash) list.push(PaymentMethod.cash);
    if (s.payCard) list.push(PaymentMethod.card);
    return list;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
