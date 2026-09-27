import { z } from "zod";

import type { RoutePurpose, TargetId } from "@/entities/survey";
import { readItem, writeItem } from "@/shared/lib/storage";

import { FINDINGS, NOTE_MAX_LENGTH, type Finding } from "../config/findings";

export type StopRecord = {
  isReached: boolean;
  reachedAt: string | null;
  finding: Finding | null;
  note: string;
};

export type StopRecords = ReadonlyMap<TargetId, StopRecord>;

export const EMPTY_RECORD: StopRecord = { isReached: false, reachedAt: null, finding: null, note: "" };

const stopRecordSchema = z.object({
  isReached: z.boolean(),
  reachedAt: z.iso.datetime().nullable(),
  finding: z.enum(FINDINGS).nullable(),
  note: z.string().max(NOTE_MAX_LENGTH),
});

const storedRecordsSchema = z.record(z.string(), stopRecordSchema);
const legacyProgressSchema = z.object({ reached: z.array(z.string()) });

type RecordsKey = { accountId: string; surveyId: string; purpose: RoutePurpose };

export const recordsStorageKey = ({ accountId, surveyId, purpose }: RecordsKey) =>
  `vineyard:route-progress:v2:${accountId}:${surveyId}:${purpose}`;

const legacyStorageKey = ({ accountId, purpose }: RecordsKey) => `vineyard:route-progress:v1:${accountId}:${purpose}`;

const onlyStops = (entries: [string, StopRecord][], stopIds: readonly TargetId[]): StopRecords => {
  const byId = new Map(entries);
  const records = new Map<TargetId, StopRecord>();
  for (const stopId of stopIds) {
    const record = byId.get(stopId);
    if (record) records.set(stopId, record);
  }
  return records;
};

const fromLegacy = (key: RecordsKey): [string, StopRecord][] => {
  const legacy = readItem(legacyStorageKey(key), legacyProgressSchema);
  if (!legacy) return [];
  return legacy.reached.map(stopId => [stopId, { ...EMPTY_RECORD, isReached: true }]);
};

export const loadRecords = (key: RecordsKey, stopIds: readonly TargetId[]): StopRecords => {
  const stored = readItem(recordsStorageKey(key), storedRecordsSchema);
  const entries = stored ? Object.entries(stored) : fromLegacy(key);
  return onlyStops(entries, stopIds);
};

export const saveRecords = (key: RecordsKey, records: StopRecords) =>
  writeItem(recordsStorageKey(key), Object.fromEntries(records));
