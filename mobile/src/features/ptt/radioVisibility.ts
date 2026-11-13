import { useLayoutEffect } from 'react';
import { create } from 'zustand';

/**
 * Признак, что у официанта открыт «Личный кабинет» (внутренний экран вкладки
 * «Профиль», не отдельный маршрут). PttOverlay прячет кнопку рации, пока кабинет
 * открыт. Остальные экраны (меню, подробный заказ) определяются по навигации.
 */
type RadioVisibilityState = {
  cabinetOpen: boolean;
  shiftGateOpen: boolean;
  adminTablesOpen: boolean;
  blockingOverlays: number;
  setCabinetOpen: (open: boolean) => void;
  setShiftGateOpen: (open: boolean) => void;
};

export const useRadioVisibility = create<RadioVisibilityState>((set) => ({
  cabinetOpen: false,
  shiftGateOpen: false,
  adminTablesOpen: false,
  blockingOverlays: 0,
  setCabinetOpen: (cabinetOpen) => set({ cabinetOpen }),
  setShiftGateOpen: (shiftGateOpen) => set({ shiftGateOpen }),
}));

/** Tracks overlays outside the shared BottomPanel lifecycle. */
export function useRadioOverlayBlocker(open: boolean) {
  useLayoutEffect(() => {
    if (!open) return;
    useRadioVisibility.setState(state => ({ blockingOverlays: state.blockingOverlays + 1 }));
    return () => {
      useRadioVisibility.setState(state => ({ blockingOverlays: state.blockingOverlays - 1 }));
    };
  }, [open]);
}
