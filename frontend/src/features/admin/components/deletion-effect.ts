const fragmentCount = 14;
const targetTileCount = 1800;
const reducedMotion = '(prefers-reduced-motion: reduce)';

type Bounds = { left: number; top: number; right: number; bottom: number };

function visibleBounds(target: HTMLElement, rect: DOMRect): Bounds {
  const viewport = document.documentElement;
  const bounds = {
    left: Math.max(rect.left, 0), top: Math.max(rect.top, 0),
    right: Math.min(rect.right, viewport.clientWidth), bottom: Math.min(rect.bottom, viewport.clientHeight),
  };
  for (let parent = target.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(parent);
    if (overflowX === 'visible' && overflowY === 'visible') continue;
    const frame = parent.getBoundingClientRect();
    if (overflowX !== 'visible') {
      const left = frame.left + parent.clientLeft;
      bounds.left = Math.max(bounds.left, left);
      bounds.right = Math.min(bounds.right, left + parent.clientWidth);
    }
    if (overflowY !== 'visible') {
      const top = frame.top + parent.clientTop;
      bounds.top = Math.max(bounds.top, top);
      bounds.bottom = Math.min(bounds.bottom, top + parent.clientHeight);
    }
  }
  return bounds;
}

function previewOf(target: HTMLElement, rect: DOMRect) {
  const copy = target.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'));

  const { backgroundColor } = getComputedStyle(target);
  copy.style.backgroundColor = backgroundColor;
  copy.style.margin = '0';
  if (!(target instanceof HTMLTableRowElement) || !(copy instanceof HTMLTableRowElement)) {
    Object.assign(copy.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    return copy;
  }

  const table = target.closest('table');
  if (!table) return copy;
  const preview = table.cloneNode(false) as HTMLTableElement;
  preview.removeAttribute('id');
  Object.assign(preview.style, {
    tableLayout: 'fixed', width: `${rect.width}px`, minWidth: '0', height: `${rect.height}px`, margin: '0',
  });
  // Freeze the column widths so the detached row keeps its original layout.
  const columns = document.createElement('colgroup');
  Array.from(target.cells).forEach((cell, index) => {
    const column = document.createElement('col');
    column.style.width = `${cell.getBoundingClientRect().width}px`;
    columns.append(column);
    copy.cells[index].colSpan = 1;
  });
  preview.append(columns);
  preview.createTBody().append(copy);
  return preview;
}

function fragmentPaths(rect: DOMRect, bounds: Bounds) {
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const size = Math.max(4, Math.ceil(Math.sqrt(width * height / targetTileCount)));
  const paths = Array.from({ length: fragmentCount }, () => '');
  const startX = Math.ceil(bounds.left - rect.left);
  const startY = Math.ceil(bounds.top - rect.top);
  const endX = Math.floor(bounds.right - rect.left);
  const endY = Math.floor(bounds.bottom - rect.top);
  for (let y = startY; y < endY; y += size) {
    const tileHeight = Math.min(size, endY - y);
    for (let x = startX; x < endX; x += size) {
      const tileWidth = Math.min(size, endX - x);
      const sweep = (endX - x) / width;
      const fragment = Math.floor(sweep * (fragmentCount - 5) + Math.random() * 5);
      paths[fragment] += `M${x} ${y}h${tileWidth}v${tileHeight}h-${tileWidth}Z`;
    }
  }
  return paths;
}

/** Capture the visible row before the request, when cache updates can still remove it. */
export function captureDeletionEffect(elementId: string) {
  if (window.matchMedia(reducedMotion).matches || !CSS.supports('clip-path', 'path("M0 0h1v1Z")')
    || typeof HTMLElement.prototype.animate !== 'function') return;
  const target = document.getElementById(elementId);
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const bounds = visibleBounds(target, rect);
  if (bounds.right - bounds.left < 4 || bounds.bottom - bounds.top < 4) return;

  const url = window.location.href;
  const preview = previewOf(target, rect);
  const isWorkspaceRow = !!target.closest('.poster-workspace');

  return () => {
    requestAnimationFrame(() => {
      if (url !== window.location.href || window.matchMedia(reducedMotion).matches) return;

      const overlay = document.createElement('div');
      overlay.dataset.deletionEffect = '';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.inert = true;
      if (isWorkspaceRow) overlay.classList.add('poster-workspace');
      const fragments = fragmentPaths(rect, bounds).flatMap((path, index) => {
        if (!path) return [];
        const layer = document.createElement('div');
        layer.className = 'deletion-fragment';
        Object.assign(layer.style, {
          left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
          clipPath: `path("${path}")`,
        });
        layer.append(preview.cloneNode(true));
        overlay.append(layer);
        return [{ layer, index }];
      });
      document.body.append(overlay);
      const animations = fragments.map(({ layer, index }) => {
        const x = 26 + Math.random() * 84;
        const y = -14 - Math.random() * 58;
        return layer.animate([
          { transform: 'translate(0, 0)', opacity: 1 },
          { transform: `translate(${x * .36}px, ${y * .3}px)`, opacity: .76, offset: .42 },
          { transform: `translate(${x}px, ${y}px) scale(.97)`, opacity: 0 },
        ], { duration: 460 + Math.random() * 60, delay: index * 11, easing: 'ease-out', fill: 'both' });
      });
      void Promise.allSettled(animations.map(({ finished }) => finished)).then(() => overlay.remove());
    });
  };
}
