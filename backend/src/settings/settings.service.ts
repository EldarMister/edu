import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentMethod, Settings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto';

const SINGLETON_ID = 'default';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

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

  async update(dto: UpdateSettingsDto): Promise<Settings> {
    const current = await this.ensure();

    // Проверка: хотя бы один способ оплаты должен остаться включённым.
    const payQr = dto.payQr ?? current.payQr;
    const payCash = dto.payCash ?? current.payCash;
    const payCard = dto.payCard ?? current.payCard;
    if (!payQr && !payCash && !payCard) {
      throw new BadRequestException('Должен быть включён хотя бы один способ оплаты');
    }

    return this.prisma.settings.update({
      where: { id: SINGLETON_ID },
      data: { ...dto },
    });
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
