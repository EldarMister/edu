import { create } from 'zustand';

/**
 * Признак, что у официанта открыт «Личный кабинет» (внутренний экран вкладки
 * «Профиль», не отдельный маршрут). PttOverlay прячет кнопку рации, пока кабинет
 * открыт. Остальные экраны (меню, подробный заказ) определяются по навигации.
 */
type RadioVisibilityState = {
  cabinetOpen: boolean;
  setCabinetOpen: (open: boolean) => void;
};

export const useRadioVisibility = create<RadioVisibilityState>((set) => ({
  cabinetOpen: false,
  setCabinetOpen: (cabinetOpen) => set({ cabinetOpen }),
}));
