import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Lang = 'ru' | 'ky';

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

/** Выбранный язык интерфейса. Сохраняется между перезагрузками. */
export const useLang = create<LangState>()(
  persist(
    (set) => ({
      lang: 'ru',
      setLang: (lang) => set({ lang }),
    }),
    { name: 'edu-pos-lang' },
  ),
);
