type CommonsImage = {
  url?: string;
  thumburl?: string;
  mime?: string;
  extmetadata?: { LicenseShortName?: { value?: string } };
};

type CommonsSearch = {
  error?: unknown;
  query?: { pages?: { pageid: number; title: string; index?: number; imageinfo?: CommonsImage[] }[] };
};

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const reusableLicenses = new Set(['CC0', 'Public domain', 'PDM']);
const imageHosts = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);

function commonsImageUrl(value: string | undefined) {
  if (!value) return;
  const url = new URL(value);
  if (url.protocol === 'https:' && imageHosts.has(url.hostname)) {
    return url.origin + url.pathname;
  }
}

export async function searchMenuPhotos(query: string, signal: AbortSignal) {
  const endpoint = new URL('https://commons.wikimedia.org/w/api.php');
  endpoint.search = new URLSearchParams({
    action: 'query', origin: '*', format: 'json', formatversion: '2',
    generator: 'search', gsrsearch: query + ' filetype:bitmap', gsrnamespace: '6', gsrlimit: '36',
    prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '500', iiextmetadatafilter: 'LicenseShortName',
  }).toString();
  const response = await fetch(endpoint, {
    signal, credentials: 'omit', headers: { 'Api-User-Agent': 'EDUPOS/1.0 (https://github.com/EldarMister/edu)' },
  });
  if (!response.ok) throw new Error('Не удалось выполнить поиск');
  const result: CommonsSearch = await response.json();
  if (result.error) throw new Error('Не удалось выполнить поиск');

  const pages = result.query?.pages ?? [];
  return pages.sort((left, right) => (left.index ?? 0) - (right.index ?? 0)).flatMap((page) => {
    const image = page.imageinfo?.[0];
    const license = image?.extmetadata?.LicenseShortName?.value;
    if (!image?.mime || !imageTypes.has(image.mime) || !license || !reusableLicenses.has(license)) return [];
    const url = commonsImageUrl(image.thumburl ?? image.url);
    return url ? [{ id: page.pageid, title: page.title.replace(/^File:/, '').replace(/\.(?:jpe?g|png|webp)$/i, ''), url }] : [];
  }).slice(0, 16);
}

export async function downloadMenuPhoto(url: string) {
  const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('Не удалось загрузить выбранное фото. Попробуйте другое.');
  const blob = await response.blob();
  if (!imageTypes.has(blob.type)) throw new Error('Этот файл нельзя использовать как фото.');
  return new File([blob], 'cover', { type: blob.type });
}
