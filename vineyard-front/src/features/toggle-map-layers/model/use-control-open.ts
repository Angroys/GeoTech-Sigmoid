import { useCallback, useState } from "react";
import { z } from "zod";

import { readItem, writeItem } from "@/shared/lib/storage";

const STORAGE_KEY = "vineyard:layers-open:v1";
const WIDE_SCREEN = "(min-width: 768px)";

const initialOpen = () => {
  const stored = readItem(STORAGE_KEY, z.boolean());
  if (stored !== null) return stored;
  try {
    return window.matchMedia(WIDE_SCREEN).matches;
  } catch {
    return true;
  }
};

export const useControlOpen = () => {
  const [isOpen, setIsOpenState] = useState(initialOpen);

  const setIsOpen = useCallback((next: boolean) => {
    writeItem(STORAGE_KEY, next);
    setIsOpenState(next);
  }, []);

  return { isOpen, setIsOpen };
};
