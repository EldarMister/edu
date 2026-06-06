import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentMethod, Prisma, Settings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { UpdateSettingsDto } from './dto';

const SINGLETON_ID = 'default';

/** Человекочитаемые названия полей настроек для описаний аудита. */
const SETTINGS_FIELD_LABELS: Record<string, string> = {
  cafeName: 'название кафе',
  address: 'адрес',
  phone: 'телефон',
  phone2: 'второй телефон',
  receiptText: 'текст чека',
  language: 'язык',
  payQr: 'оплата QR',
  payCash: 'оплата наличными',
  payCard: 'оплата картой',
  printerConnected: 'принтер',
};

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** Возвращает singleton-настройки, создавая их при первом обращении. */
  async ensure(): Promise<Settings> {
    return this.prisma.settings.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
    });
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
      receiptText: s.receiptText,
      language: s.language,
      paymentMethods: this.enabledMethodsOf(s),
      printerConnected: s.printerConnected,
    };
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

    const updated = await this.prisma.settings.update({
      where: { id: SINGLETON_ID },
      data: { ...dto },
    });

    // Считаем, какие именно поля реально изменились.
    const changed: string[] = [];
    const oldValue: Record<string, Prisma.InputJsonValue> = {};
    const newValue: Record<string, Prisma.InputJsonValue> = {};
    for (const key of Object.keys(dto) as (keyof UpdateSettingsDto)[]) {
      const before = (current as Record<string, unknown>)[key];
      const after = (updated as Record<string, unknown>)[key];
      if (before !== after) {
        changed.push(SETTINGS_FIELD_LABELS[key] ?? key);
        oldValue[key] = before as Prisma.InputJsonValue;
        newValue[key] = after as Prisma.InputJsonValue;
      }
    }

    if (changed.length > 0) {
      await this.audit.log({
        actor,
        actionType: AuditAction.SETTINGS_UPDATED,
        entityType: AuditEntity.SETTINGS,
        entityId: SINGLETON_ID,
        description: `${actor.name ?? 'Владелец'} изменил настройки: ${changed.join(', ')}`,
        oldValue,
        newValue,
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
    const enabled = await this.enabledMethods();
    if (!enabled.includes(method)) {
      throw new BadRequestException('Этот способ оплаты отключён в настройках');
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
