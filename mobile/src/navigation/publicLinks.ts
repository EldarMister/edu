export type PublicLink = { screen: 'QrMenu'; params: { tableToken: string } } | { screen: 'Queue'; params: { code?: string; cafe?: string } } | { screen: 'Platform'; params: undefined };

/** Parse paths only; never follow an arbitrary URL received in a push payload. */
export function parsePublicLink(value: string): PublicLink | null {
  let path = value.trim();
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) path = path.replace(/^https?:\/\/[^/]+/i, '');
  else if (/^edupos:\/\//i.test(path)) path = `/${path.slice('edupos://'.length)}`;
  if (!path.startsWith('/')) return null;
  const [pathname, query = ''] = path.split('?');
  const menu = /^\/menu\/([^/?#]+)\/?$/.exec(pathname);
  try {
    if (menu) { const tableToken = decodeURIComponent(menu[1]); return /^[a-zA-Z0-9_-]+$/.test(tableToken) ? { screen: 'QrMenu', params: { tableToken } } : null; }
    const queue = /^\/q\/([a-zA-Z0-9_-]+)\/?$/.exec(pathname);
    if (queue) return { screen: 'Queue', params: { code: queue[1] } };
    if (/^\/queue\/?$/.test(pathname)) {
      const params = Object.fromEntries(query.split('&').filter(Boolean).map(pair => pair.split('=').map(decodeURIComponent)));
      return { screen: 'Queue', params: { code: params.code, cafe: params.cafe } };
    }
    if (/^\/platform(?:\/.*)?$/.test(pathname)) return { screen: 'Platform', params: undefined };
  } catch { return null; }
  return null;
}
