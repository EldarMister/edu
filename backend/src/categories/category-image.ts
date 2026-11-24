import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { decodeDishImage, normalizeDishImage, sniffImageMime } from '../dishes/dish-image';

export function categoryImageRef(id: string, imageKey: string | null) {
  return imageKey ? `/categories/${encodeURIComponent(id)}/image?v=${encodeURIComponent(imageKey)}` : null;
}

export async function categoryPhoto(input?: string) {
  if (input === undefined) return {};
  if (typeof input !== 'string') throw new BadRequestException('Выберите фотографию категории');
  const trimmed = input.trim();
  if (!trimmed) return { imageUrl: null, imageKey: null };
  if (!trimmed.startsWith('data:image/')) throw new BadRequestException('Загрузите фотографию категории в формате PNG, JPEG или WebP');
  const imageUrl = await normalizeDishImage(trimmed);
  const image = decodeDishImage(imageUrl ?? null);
  if (!image || sniffImageMime(image.buffer) !== image.mime.replace('image/jpg', 'image/jpeg')) throw new BadRequestException('Формат файла не соответствует фотографии');
  return { imageUrl, imageKey: randomUUID() };
}
