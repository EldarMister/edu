import { BadRequestException } from '@nestjs/common';

// Фото блюда хранится как data URL в Dish.imageUrl (как QR-код оплаты в Settings).
// В списках меню отдаём не сам base64, а лёгкую ссылку на эндпоинт-картинку.

const DISH_IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;
// ~1.1 МБ base64 — клиент перед загрузкой сжимает изображение.
const MAX_DISH_IMAGE_CHARS = 1_500_000;

/**
 * Нормализует входящее фото для записи в БД:
 *  - undefined → не трогать (поле не передано);
 *  - '' → очистить (null);
 *  - валидный data URL → строка;
 *  - иначе — ошибка.
 */
export function normalizeDishImage(input: string | undefined): string | null | undefined {
  if (input === undefined) return undefined;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!DISH_IMAGE_DATA_URL_RE.test(trimmed)) {
    throw new BadRequestException('Фото блюда: поддерживаются только PNG, JPG или WEBP');
  }
  if (trimmed.length > MAX_DISH_IMAGE_CHARS) {
    throw new BadRequestException('Фото блюда слишком большое — уменьшите изображение');
  }
  return trimmed;
}

/** Лёгкая ссылка на картинку блюда (с версией для кэша) вместо тяжёлого base64. */
export function dishImageRef(id: string, updatedAt: Date, imageUrl: string | null): string | null {
  return imageUrl ? `/dishes/${id}/image?v=${updatedAt.getTime()}` : null;
}

/** Заменяет imageUrl блюда на лёгкую ссылку (для ответов со списком блюд). */
export function withDishImageRef<T extends { id: string; updatedAt: Date; imageUrl: string | null }>(
  dish: T,
): T {
  return { ...dish, imageUrl: dishImageRef(dish.id, dish.updatedAt, dish.imageUrl) };
}

/** Декодирует сохранённый data URL в бинарь для отдачи как картинку. */
export function decodeDishImage(imageUrl: string | null): { buffer: Buffer; mime: string } | null {
  if (!imageUrl) return null;
  const m = imageUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
}
