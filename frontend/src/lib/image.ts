import { API_URL } from './api';

/** Превращает относительную ссылку API (/dishes/:id/image) в абсолютный URL для <img>. */
export function resolveApiImage(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('data:') || url.startsWith('http')) return url;
  return `${API_URL}/api${url.startsWith('/') ? url : `/${url}`}`;
}

/**
 * Сжимает выбранное изображение на клиенте: вписывает в maxDim, кодирует в JPEG.
 * Возвращает data URL (для отправки в Dish.imageUrl). Так фото в БД остаётся лёгким.
 */
export function downscaleToDataUrl(file: File, maxDim = 900, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Не удалось обработать изображение'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось прочитать изображение'));
    };
    img.src = url;
  });
}
