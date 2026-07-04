import { create } from 'zustand';

/**
 * Видимость плавающей кнопки рации у официанта. WaiterApp обновляет флаг под
 * текущий экран, а App/PttOverlay прячут кнопку на подробном заказе, в меню и
 * личном кабинете — кнопка есть только на «Столах», «Заказах» и «Профиле».
 * Сам оверлей остаётся смонтированным, поэтому приём аудио не прерывается.
 */
type RadioVisibilityState = {
  waiterButtonVisible: boolean;
  setWaiterButtonVisible: (visible: boolean) => void;
};

export const useRadioVisibility = create<RadioVisibilityState>((set) => ({
  waiterButtonVisible: true,
  setWaiterButtonVisible: (waiterButtonVisible) => set({ waiterButtonVisible }),
}));
