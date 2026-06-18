import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { useNotifications } from '@/store/notifications';
import type { AdminTableItem } from '../api';

/** QR-код меню стола для владельца: просмотр, скачивание и печать. */
export function TableQrModal({
  table,
  hallName,
  onClose,
}: {
  table: AdminTableItem;
  hallName: string;
  onClose: () => void;
}) {
  const push = useNotifications((s) => s.push);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const menuUrl = `${window.location.origin}/menu/${table.qrToken ?? ''}`;

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(menuUrl, { width: 640, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (alive) setDataUrl(url);
      })
      .catch(() => {
        if (alive) setDataUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [menuUrl]);

  function download() {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `qr-stol-${table.number}.png`;
    a.click();
  }

  function copy() {
    navigator.clipboard?.writeText(menuUrl).then(
      () => push({ message: 'Ссылка скопирована', type: 'success', at: new Date().toISOString() }),
      () => push({ message: 'Не удалось скопировать', type: 'error', at: new Date().toISOString() }),
    );
  }

  function print() {
    if (!dataUrl) return;
    const w = window.open('', '_blank', 'width=420,height=620');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Стол ${table.number}</title>
      <style>
        @page { margin: 0; }
        body { font-family: 'Inter', sans-serif; text-align: center; padding: 28px 20px; color: #0F172A; }
        h1 { font-size: 26px; margin: 0 0 4px; }
        .sub { color: #64748B; font-size: 14px; margin-bottom: 18px; }
        img { width: 300px; height: 300px; }
        .hint { margin-top: 16px; font-size: 15px; font-weight: 600; }
        .hall { color: #64748B; font-size: 13px; margin-top: 4px; }
      </style></head><body>
        <h1>Стол ${table.number}</h1>
        <div class="sub">${escapeHtml(hallName)}</div>
        <img src="${dataUrl}" alt="QR" />
        <div class="hint">Отсканируйте — меню стола</div>
        <div class="hall">Закажите со своего телефона</div>
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  return (
    <Modal open onClose={onClose} title={`QR-код · Стол ${table.number}`}>
      <div className="flex flex-col items-center">
        <div className="flex h-64 w-64 items-center justify-center rounded-2xl border border-border bg-white p-3">
          {dataUrl ? (
            <img src={dataUrl} alt={`QR стола ${table.number}`} className="h-full w-full" />
          ) : (
            <Spinner className="h-6 w-6 text-primary" />
          )}
        </div>
        <p className="mt-3 text-center text-xs text-text-muted">{hallName} · Стол {table.number}</p>
        <button
          onClick={copy}
          className="mt-2 max-w-full break-all text-center text-xs text-primary hover:underline"
          title="Скопировать ссылку"
        >
          {menuUrl}
        </button>

        <div className="mt-5 grid w-full grid-cols-2 gap-3">
          <button className="btn-secondary btn-md" disabled={!dataUrl} onClick={download}>
            Скачать
          </button>
          <button className="btn-primary btn-md" disabled={!dataUrl} onClick={print}>
            Печать
          </button>
        </div>
        <p className="mt-3 text-center text-xs text-text-muted">
          Распечатайте и поставьте на стол — гости отсканируют и откроют меню этого стола.
        </p>
      </div>
    </Modal>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
