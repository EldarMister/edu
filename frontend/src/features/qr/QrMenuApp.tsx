import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@/components/Spinner';
import {
  joinSession,
  qrSessionKey,
  qrSubmittedOrderKey,
  useQrMenu,
  useQrSession,
  type QrDish,
  type QrJoinResult,
  type QrSession,
  type QrSessionItem,
  type QrSubmitResult,
} from './api';
import { useQrRealtime } from './socket';
import { MenuScreen } from './MenuScreen';
import { OrderScreen } from './OrderScreen';
import { ProductSheet } from './ProductSheet';
import { SubmittedScreen } from './SubmittedScreen';
import { ClosedScreen, EduMenuLogo } from './ui';

type Screen = 'menu' | 'order' | 'submitted';

interface SubmittedOrder {
  orderId: string;
  orderNumber: string;
  status: string;
  items: QrSessionItem[];
  totalAmount: string;
  itemCount: number;
}

const submittedOrderStorageKey = (token: string) => `edu_qr_submitted_order_${token}`;

function readSubmittedOrder(token: string): SubmittedOrder | null {
  try {
    const raw = window.localStorage.getItem(submittedOrderStorageKey(token));
    return raw ? (JSON.parse(raw) as SubmittedOrder) : null;
  } catch {
    return null;
  }
}

function saveSubmittedOrder(token: string, order: SubmittedOrder) {
  try {
    window.localStorage.setItem(submittedOrderStorageKey(token), JSON.stringify(order));
  } catch {
    // localStorage can be unavailable in private mode; in-memory state still works.
  }
}

function clearSubmittedOrder(token: string) {
  try {
    window.localStorage.removeItem(submittedOrderStorageKey(token));
  } catch {
    // localStorage can be unavailable in private mode.
  }
}

export function QrMenuApp() {
  const { tableToken = '' } = useParams();
  const qc = useQueryClient();

  const menuQ = useQrMenu(tableToken);
  const [join, setJoin] = useState<QrJoinResult | null>(null);
  const joinedRef = useRef(false);

  const sessionQ = useQrSession(tableToken, !!join);
  const [screen, setScreen] = useState<Screen>('menu');
  const [dish, setDish] = useState<QrDish | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedOrder | null>(() => readSubmittedOrder(tableToken));
  // Визит закрыт официантом: гость больше не может заказывать до явного «нового заказа».
  const [closed, setClosed] = useState(false);
  const [reopening, setReopening] = useState(false);

  // Снимок состава заказа из текущей сессии — чтобы показать его на экране «Мои заказы».
  const captureSubmitted = (p: { orderId: string; orderNumber: string; status: string }): SubmittedOrder => {
    const cached = qc.getQueryData<QrSession>(qrSessionKey(tableToken));
    return {
      orderId: p.orderId,
      orderNumber: p.orderNumber,
      status: p.status,
      items: cached?.items ?? [],
      totalAmount: cached?.totalAmount ?? '0',
      itemCount: cached?.itemCount ?? 0,
    };
  };

  // Вход гостя один раз после загрузки меню (меню валидирует токен стола).
  useEffect(() => {
    if (!menuQ.data || joinedRef.current) return;
    joinedRef.current = true;
    joinSession(tableToken)
      .then((j) => {
        setJoin(j);
        if (j.status === 'closed') setClosed(true);
      })
      .catch(() => {
        joinedRef.current = false;
      });
  }, [menuQ.data, tableToken]);

  // Realtime: обновления общего заказа и статуса для всех гостей стола.
  useQrRealtime(menuQ.data?.table.id, {
    onCartUpdated: (payload) => qc.setQueryData(qrSessionKey(tableToken), payload as QrSession),
    onGuestChanged: () => qc.invalidateQueries({ queryKey: qrSessionKey(tableToken) }),
    onOrderSubmitted: (p) => {
      qc.invalidateQueries({ queryKey: qrSubmittedOrderKey(tableToken, p.orderId) });
      setSubmitted((prev) => {
        // Свой только что отправленный заказ с уже снятым составом — не затираем пустым.
        if (prev?.orderId === p.orderId && prev.items.length > 0) return prev;
        const order = captureSubmitted(p);
        saveSubmittedOrder(tableToken, order);
        return order;
      });
      setScreen('submitted');
      qc.invalidateQueries({ queryKey: qrSessionKey(tableToken) });
    },
    onOrderStatusChanged: (p) => {
      qc.invalidateQueries({ queryKey: qrSubmittedOrderKey(tableToken, p.orderId) });
      setSubmitted((prev) => {
        if (!prev || prev.orderId !== p.orderId) return prev;
        const next = { ...prev, status: p.status };
        saveSubmittedOrder(tableToken, next);
        return next;
      });
    },
    onSessionClosed: () => {
      // Официант закрыл стол → визит завершён, показываем «Заказ завершён».
      setClosed(true);
      clearSubmittedOrder(tableToken);
      qc.invalidateQueries({ queryKey: qrSessionKey(tableToken) });
    },
  });

  if (menuQ.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-primary">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  if (menuQ.isError || !menuQ.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <EduMenuLogo />
        <p className="text-[15px] text-text-secondary">Стол не найден или ссылка устарела.</p>
        <p className="text-[13px] text-text-muted">Отсканируйте QR-код на столе ещё раз.</p>
      </div>
    );
  }

  const menu = menuQ.data;
  const session = sessionQ.data;
  const hasSubmittedOrder = !!submitted?.orderId && submitted.itemCount > 0;
  const isClosed = closed || join?.status === 'closed' || session?.status === 'closed';

  // «Сделать новый заказ» — явно открываем новый визит после закрытия стола.
  const startNewOrder = () => {
    setReopening(true);
    joinSession(tableToken, true)
      .then((j) => {
        setJoin(j);
        setClosed(false);
        setSubmitted(null);
        clearSubmittedOrder(tableToken);
        setScreen('menu');
        qc.invalidateQueries({ queryKey: qrSessionKey(tableToken) });
      })
      .finally(() => setReopening(false));
  };

  const onSubmitted = (r: QrSubmitResult) => {
    const order = captureSubmitted(r);
    setSubmitted(order);
    saveSubmittedOrder(tableToken, order);
    setScreen('submitted');
    qc.invalidateQueries({ queryKey: qrSessionKey(tableToken) });
    qc.invalidateQueries({ queryKey: qrSubmittedOrderKey(tableToken, r.orderId) });
  };

  const backToMenu = () => {
    setScreen('menu');
    // Прошлый заказ отправлен → начинаем новый круг: заново входим, чтобы получить
    // свежий guestId в новой draft-сессии (иначе свои позиции не отредактировать).
    joinSession(tableToken)
      .then((j) => {
        setJoin(j);
        qc.invalidateQueries({ queryKey: qrSessionKey(tableToken) });
      })
      .catch(() => {
        void sessionQ.refetch();
      });
  };

  return (
    <div className="mx-auto flex h-full max-w-md flex-col bg-background">
      {isClosed ? (
        <ClosedScreen tableNumber={menu.table.number} busy={reopening} onNewOrder={startNewOrder} />
      ) : screen === 'submitted' && submitted ? (
        <SubmittedScreen
          token={tableToken}
          orderId={submitted.orderId}
          orderNumber={submitted.orderNumber}
          tableNumber={menu.table.number}
          status={submitted.status}
          items={submitted.items}
          totalAmount={submitted.totalAmount}
          itemCount={submitted.itemCount}
          menu={menu}
          onBackToMenu={backToMenu}
        />
      ) : screen === 'order' && session ? (
        <OrderScreen
          token={tableToken}
          menu={menu}
          session={session}
          guestId={join?.guestId ?? null}
          onBack={() => setScreen('menu')}
          onSubmitted={onSubmitted}
        />
      ) : (
        <MenuScreen
          menu={menu}
          session={session}
          hasSubmittedOrder={hasSubmittedOrder}
          onOpenDish={setDish}
          onOpenOrder={() => setScreen('order')}
          onOpenSubmittedOrder={() => hasSubmittedOrder && setScreen('submitted')}
        />
      )}

      <ProductSheet token={tableToken} dish={dish} geoRequired={menu.geo.required} onClose={() => setDish(null)} />
    </div>
  );
}
