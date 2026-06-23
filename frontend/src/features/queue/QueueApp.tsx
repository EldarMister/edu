import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Spinner } from '@/components/Spinner';
import { useQueueBoard, type QueueBoard, type QueueOrder, type QueueStatus } from './api';
import { queueVoice } from './voice';

/** Подпись статуса позиции в колонке «Готовятся». */
const STATUS_LABEL: Record<QueueStatus, string> = {
  sent_to_kitchen: 'Новый',
  accepted_by_kitchen: 'Принят',
  cooking: 'Готовится',
  partially_rejected: 'Изменён',
  ready: 'Готов',
};

/** Прошедшее время «X мин» от метки времени до сейчас. */
function elapsedLabel(from: string, now: number): string {
  const min = Math.floor((now - new Date(from).getTime()) / 60_000);
  if (min < 1) return 'сейчас';
  return `${min} мин`;
}

/** Двузначное отображение номера (06, 11) — как на референсе. */
function padNumber(value: string | number): string {
  const s = String(value);
  return s.length === 1 ? `0${s}` : s;
}

export function QueueApp() {
  const { code: codeParam } = useParams();
  const [searchParams] = useSearchParams();
  const code = codeParam ?? searchParams.get('code');
  const cafe = searchParams.get('cafe');
  const { data, isLoading, isError } = useQueueBoard({ code, cafe });
  const [now, setNow] = useState(() => Date.now());
  const [soundOn, setSoundOn] = useState(false);
  // id заказов, уже попавших в «Готовы», — чтобы озвучивать только новые.
  const announcedReady = useRef<Set<string> | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Озвучка только что приготовленных заказов. При первой загрузке ничего не
  // объявляем (запоминаем текущие готовые), дальше — только появившиеся.
  useEffect(() => {
    if (!data?.enabled) return;
    const readyIds = data.ready.map((o) => o.id);
    if (announcedReady.current === null) {
      announcedReady.current = new Set(readyIds);
      return;
    }
    for (const o of data.ready) {
      if (!announcedReady.current.has(o.id)) {
        announcedReady.current.add(o.id);
        queueVoice.enqueue({ code, cafe }, o.id);
      }
    }
    // Чистим ушедшие, чтобы повторное появление номера снова озвучилось.
    announcedReady.current = new Set(
      [...announcedReady.current].filter((id) => readyIds.includes(id)),
    );
  }, [data, code, cafe]);

  function toggleSound() {
    if (soundOn) {
      queueVoice.disable();
      setSoundOn(false);
    } else {
      queueVoice.unlock();
      setSoundOn(true);
    }
  }

  const clock = new Date(now).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-white text-primary">
        <Spinner className="h-9 w-9" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-full items-center justify-center bg-white px-6 text-center text-xl text-text-muted">
        Не удалось загрузить табло очереди
      </div>
    );
  }

  if (!data.enabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-white px-6 text-center">
        <p className="text-2xl font-semibold text-text-primary">Экран очереди отключён</p>
        <p className="text-base text-text-muted">
          Включите его в настройках кафе (раздел «Экран очереди заказов»).
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Шапка: «Готовятся» — часы — «Готовы» */}
      <header className="grid shrink-0 grid-cols-3 items-center border-b-2 border-border px-6 py-4 sm:px-10 sm:py-5">
        <h1 className="text-2xl font-extrabold tracking-tight text-text-primary sm:text-4xl">
          Готовятся
        </h1>
        <span className="text-center text-xl font-semibold tabular-nums tracking-tight text-text-secondary sm:text-3xl">
          {clock}
        </span>
        <div className="flex items-center justify-end gap-4">
          <button
            type="button"
            onClick={toggleSound}
            title={soundOn ? 'Звук включён' : 'Включить звук'}
            className={`shrink-0 rounded-full border p-2 transition-colors ${
              soundOn
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border text-text-muted hover:bg-background'
            }`}
          >
            {soundOn ? <IconSpeaker className="h-5 w-5" /> : <IconSpeakerOff className="h-5 w-5" />}
          </button>
          <h1 className="text-2xl font-extrabold tracking-tight text-text-primary sm:text-4xl">
            Готовы
          </h1>
        </div>
      </header>

      {/* Две колонки */}
      <main className="grid min-h-0 flex-1 grid-cols-2">
        <QueueColumn board={data} orders={data.preparing} now={now} side="preparing" />
        <QueueColumn board={data} orders={data.ready} now={now} side="ready" />
      </main>

      {/* Подвал */}
      <footer className="shrink-0 bg-text-primary py-3 text-center text-lg font-semibold tracking-wide text-white sm:py-4 sm:text-2xl">
        Очередь заказов
      </footer>
    </div>
  );
}

function QueueColumn({
  board,
  orders,
  now,
  side,
}: {
  board: QueueBoard;
  orders: QueueOrder[];
  now: number;
  side: 'preparing' | 'ready';
}) {
  const isReady = side === 'ready';
  const borderClass = isReady ? '' : 'border-r-2 border-border';

  if (orders.length === 0) {
    return (
      <div className={`flex items-center justify-center ${borderClass} text-lg text-text-muted`}>
        {isReady ? 'Готовых заказов нет' : 'Заказов в работе нет'}
      </div>
    );
  }

  return (
    <div className={`app-scrollbar-subtle min-h-0 overflow-y-auto ${borderClass}`}>
      {orders.map((o, idx) => (
        <QueueRow
          key={o.id}
          order={o}
          now={now}
          mode={board.mode}
          isReady={isReady}
          highlight={isReady && idx === 0}
        />
      ))}
    </div>
  );
}

function QueueRow({
  order,
  now,
  mode,
  isReady,
  highlight,
}: {
  order: QueueOrder;
  now: number;
  mode: 'table' | 'number';
  isReady: boolean;
  highlight: boolean;
}) {
  const number = mode === 'table' ? order.tableNumber : order.orderNumber;
  const since = isReady ? order.updatedAt : order.createdAt;

  return (
    <div
      className={`flex items-center justify-between gap-4 border-b border-border px-6 py-4 sm:px-10 sm:py-5 ${
        highlight ? 'bg-success text-white' : ''
      }`}
    >
      <div className="flex min-w-0 items-baseline gap-4 sm:gap-6">
        <span
          className={`w-16 shrink-0 text-sm font-medium tabular-nums sm:w-20 sm:text-base ${
            highlight ? 'text-white/80' : 'text-text-muted'
          }`}
        >
          {elapsedLabel(since, now)}
        </span>
        <span className={`truncate text-base sm:text-xl ${highlight ? 'text-white/90' : 'text-text-secondary'}`}>
          {STATUS_LABEL[order.status]}
        </span>
      </div>
      <span
        className={`shrink-0 text-4xl font-extrabold tabular-nums tracking-tight sm:text-6xl ${
          highlight ? 'text-white' : isReady ? 'text-success' : 'text-text-primary'
        }`}
      >
        {padNumber(number)}
      </span>
    </div>
  );
}

function IconSpeaker({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
    </svg>
  );
}

function IconSpeakerOff({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="m22 9-6 6M16 9l6 6" />
    </svg>
  );
}
