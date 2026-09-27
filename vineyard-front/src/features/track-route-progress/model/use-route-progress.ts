import { useCallback, useEffect, useMemo, useState } from "react";

import { useSession } from "@/entities/session";
import type { RoutePurpose, TargetId } from "@/entities/survey";
import { removeItem } from "@/shared/lib/storage";

import { NOTE_MAX_LENGTH, type Finding } from "../config/findings";
import {
  EMPTY_RECORD,
  loadRecords,
  recordsStorageKey,
  saveRecords,
  type StopRecord,
  type StopRecords,
} from "./stop-records";

export const useRouteProgress = (surveyId: string, purpose: RoutePurpose, stopIds: readonly TargetId[]) => {
  const session = useSession();
  const accountId = session?.accountId ?? "guest";
  const key = useMemo(() => ({ accountId, surveyId, purpose }), [accountId, surveyId, purpose]);
  const [records, setRecords] = useState<StopRecords>(() => loadRecords(key, stopIds));

  useEffect(() => {
    setRecords(loadRecords(key, stopIds));
  }, [key, stopIds]);

  const updateRecord = useCallback(
    (targetId: TargetId, change: (record: StopRecord) => StopRecord) => {
      const next = new Map(records);
      next.set(targetId, change(records.get(targetId) ?? EMPTY_RECORD));
      saveRecords(key, next);
      setRecords(next);
    },
    [key, records],
  );

  const setStopReached = useCallback(
    (targetId: TargetId, isReached: boolean) =>
      updateRecord(targetId, record => ({
        ...record,
        isReached,
        reachedAt: isReached ? new Date().toISOString() : null,
      })),
    [updateRecord],
  );

  const setFinding = useCallback(
    (targetId: TargetId, finding: Finding | null) => updateRecord(targetId, record => ({ ...record, finding })),
    [updateRecord],
  );

  const setNote = useCallback(
    (targetId: TargetId, note: string) =>
      updateRecord(targetId, record => ({ ...record, note: note.slice(0, NOTE_MAX_LENGTH) })),
    [updateRecord],
  );

  const resetProgress = useCallback(() => {
    removeItem(recordsStorageKey(key));
    setRecords(new Map());
  }, [key]);

  const reached = useMemo(
    () => new Set([...records].filter(([, record]) => record.isReached).map(([targetId]) => targetId)),
    [records],
  );
  const recordOf = useCallback((targetId: TargetId) => records.get(targetId) ?? EMPTY_RECORD, [records]);

  return { reached, recordOf, setStopReached, setFinding, setNote, resetProgress };
};

export type RouteProgressState = ReturnType<typeof useRouteProgress>;
