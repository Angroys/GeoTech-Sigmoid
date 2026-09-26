import { useSyncExternalStore } from "react";

import { parseStoredItem, readRawItem, removeItem, writeItem } from "@/shared/lib/storage";

import { sessionSchema } from "./schema";
import type { Session } from "./types";

const SESSION_KEY = "vineyard:session:v1";
const SESSION_CHANGE_EVENT = "vineyard:session-change";

const isExpired = (session: Session) => Date.parse(session.expiresAt) <= Date.now();

const parseSession = (raw: string | null): Session | null => {
  const session = parseStoredItem(raw, sessionSchema);
  return session && !isExpired(session) ? session : null;
};

let snapshot: { raw: string | null; session: Session | null } = { raw: null, session: null };

const readSession = (): Session | null => {
  const raw = readRawItem(SESSION_KEY);
  if (raw !== snapshot.raw) snapshot = { raw, session: parseSession(raw) };
  return snapshot.session;
};

const announceChange = () => window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));

export const saveSession = (session: Session): boolean => {
  const isSaved = writeItem(SESSION_KEY, session);
  announceChange();
  return isSaved;
};

export const clearSession = () => {
  removeItem(SESSION_KEY);
  announceChange();
};

const subscribe = (onChange: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SESSION_KEY || event.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(SESSION_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SESSION_CHANGE_EVENT, onChange);
  };
};

export const useSession = (): Session | null => useSyncExternalStore(subscribe, readSession);
