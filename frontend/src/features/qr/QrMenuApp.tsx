import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@/components/Spinner';
import {
  joinSession,
  qrSessionKey,
  useQrMenu,
  useQrSession,
  type QrDish,
  type QrJoinResult,
  type QrSession,
  type QrSubmitResult,
} from './api';
import { useQrRealtime } from './socket';
import { MenuScreen } from './MenuScreen';
import { OrderScreen } from './OrderScreen';
import { ProductSheet } from './ProductSheet';
import { SubmittedScreen } from './SubmittedScreen';
import { EduMenuLogo } from './ui';

type Screen = 'menu' | 'order' | 'submitted';

interface SubmittedOrder {
  orderId: string;
  orderNumber: string;
  status: string;
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
  const [submitted, setSubmitted] = useState<SubmittedOrder | null>(null);

  // Вход гостя один раз после загрузки меню (меню валидирует токен стола).
  useEffect(() => {
    if (!menuQ.data || joinedRef.current) return;
    joinedRef.current = true;
    joinSession(tableToken)
      .then(setJoin)
      .catch(() => {
        joinedRef.current = false;
      });
  }, [menuQ.data, tableToken]);

  // Realtime: обновления общего заказа и статуса для всех гостей стола.
  useQrRealtime(menuQ.data?.table.id, {
    onCartUpdated: (payload) => qc.setQueryData(qrSessionKey(tableToken), payload as QrSession),
    onGuestChanged: () => qc.invalidateQueries({ queryKey: qrSessionKey(tableToken) }),
    onOrderSubmitted: (p) => {
      setSubmitted({ orderId: p.orderId, orderNumber: p.orderNumber, status: p.status });
      setScreen('submitted');
      qc.invalidateQueries({ queryKey: qrSessionKey(tableToken) });
    },
    onOrderStatusChanged: (p) => {
      setSubmitted((prev) => (prev && prev.orderId === p.orderId ? { ...prev, status: p.status } : prev));
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

  const onSubmitted = (r: QrSubmitResult) => {
    setSubmitted({ orderId: r.orderId, orderNumber: r.orderNumber, status: r.status });
    setScreen('submitted');
    qc.invalidateQueries({ queryKey: qrSessionKey(tableToken) });
  };

  const backToMenu = () => {
    setSubmitted(null);
    setScreen('menu');
    void sessionQ.refetch();
  };

  return (
    <div className="mx-auto flex h-full max-w-md flex-col bg-background">
      {screen === 'submitted' && submitted ? (
        <SubmittedScreen
          orderNumber={submitted.orderNumber}
          tableNumber={menu.table.number}
          status={submitted.status}
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
          onOpenDish={setDish}
          onOpenOrder={() => setScreen('order')}
        />
      )}

      <ProductSheet token={tableToken} dish={dish} onClose={() => setDish(null)} />
    </div>
  );
}
