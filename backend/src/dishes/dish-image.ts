import { BadRequestException } from '@nestjs/common';

// Фото блюда хранится как data URL в Dish.imageUrl (как QR-код оплаты в Settings).
// В списках меню отдаём не сам base64, а лёгкую ссылку на эндпоинт-картинку.

const DISH_IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;
// ~1.1 МБ base64 — клиент перед загрузкой сжимает изображение.
const MAX_DISH_IMAGE_CHARS = 1_500_000;
const MAX_REMOTE_IMAGE_BYTES = Math.floor(MAX_DISH_IMAGE_CHARS * 0.75);
const DISH_IMAGE_FETCH_TIMEOUT_MS = 10_000;
const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Нормализует входящее фото для записи в БД:
 *  - undefined → не трогать (поле не передано);
 *  - '' → очистить (null);
 *  - валидный data URL → строка;
 *  - http(s)-ссылка → скачать картинку и сохранить как data URL;
 *  - иначе — ошибка.
 */
export async function normalizeDishImage(input: string | undefined): Promise<string | null | undefined> {
  if (input === undefined) return undefined;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const remoteUrl = parseRemoteImageUrl(trimmed);
  if (remoteUrl) return downloadDishImage(remoteUrl);
  if (!DISH_IMAGE_DATA_URL_RE.test(trimmed)) {
    throw new BadRequestException('Фото блюда: вставьте ссылку (https://...) или загрузите файл PNG, JPG, WEBP');
  }
  if (trimmed.length > MAX_DISH_IMAGE_CHARS) {
    throw new BadRequestException('Фото блюда слишком большое — уменьшите изображение');
  }
  return trimmed;
}

/** Лёгкая ссылка на картинку блюда (с версией для кэша) вместо тяжёлого base64. */
export function dishImageRef(id: string, updatedAt: Date, imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  // Старые записи могли хранить внешний URL напрямую. Новые ссылки при сохранении скачиваются в data URL.
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return `/dishes/${id}/image?v=${updatedAt.getTime()}`;
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

function parseRemoteImageUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

async function downloadDishImage(url: URL): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISH_IMAGE_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: 'image/png,image/jpeg,image/webp,image/*;q=0.8' },
    });
  } catch {
    throw new BadRequestException('Не удалось загрузить фото по ссылке. Проверьте, что ссылка открывается без авторизации');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new BadRequestException('Не удалось загрузить фото по ссылке. Сервер с картинкой вернул ошибку');
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_REMOTE_IMAGE_BYTES) {
    throw new BadRequestException('Фото по ссылке слишком большое — используйте изображение до 1 МБ');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_REMOTE_IMAGE_BYTES) {
    throw new BadRequestException('Фото по ссылке слишком большое — используйте изображение до 1 МБ');
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  const mime = sniffImageMime(buffer) ?? (contentType && ALLOWED_IMAGE_MIMES.has(contentType) ? contentType : null);
  if (!mime) {
    throw new BadRequestException('Ссылка должна вести прямо на PNG, JPG или WEBP');
  }

  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function sniffImageMime(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
