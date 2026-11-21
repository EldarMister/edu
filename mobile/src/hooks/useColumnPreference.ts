import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';

export function useColumnPreference<T extends string>(table: string, defaults: T[]) {
  const userId = useAuth((state) => state.user?.id);
  const key = `edu-pos:columns:v1:${userId ?? ''}:${table}`;
  const [stored, setStored] = useState<{ key: string; values: T[] }>();

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(key).then((value) => {
      if (!active || !value) return;
      const values: unknown = JSON.parse(value);
      if (Array.isArray(values) && values.every((column) => typeof column === 'string')) {
        setStored((current) => current?.key === key ? current : { key, values: values as T[] });
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [key]);

  const save = useCallback((values: T[]) => {
    setStored({ key, values });
    void AsyncStorage.setItem(key, JSON.stringify(values)).catch(() => undefined);
  }, [key]);

  return [stored?.key === key ? stored.values : defaults, save] as const;
}
