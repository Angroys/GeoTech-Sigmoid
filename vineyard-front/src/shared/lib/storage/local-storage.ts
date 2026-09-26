import type { z } from "zod";

export const readRawItem = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const parseStoredItem = <S extends z.ZodType>(raw: string | null, schema: S): z.output<S> | null => {
  if (raw === null) return null;
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

export const readItem = <S extends z.ZodType>(key: string, schema: S): z.output<S> | null =>
  parseStoredItem(readRawItem(key), schema);

export const writeItem = (key: string, value: unknown): boolean => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const removeItem = (key: string) => {
  try {
    window.localStorage.removeItem(key);
  } catch {
  }
};
