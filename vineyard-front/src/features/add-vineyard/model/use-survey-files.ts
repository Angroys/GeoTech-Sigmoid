import { useCallback, useMemo, useState } from "react";

import {
  checkSurveyFile,
  isServerPlanned,
  SURVEY_FILE_KEYS,
  SURVEY_FILE_NAMES,
  surveyFileKeyOf,
  surveyFilesSchema,
  type SurveyFileCheck,
  type SurveyFileKey,
  type SurveyFiles,
} from "@/entities/survey";

import { SAMPLE_DATA_URL } from "../config/survey-file-labels";

export type SurveyFileEntry = { fileName: string; json: unknown; check: SurveyFileCheck };

type Entries = Partial<Record<SurveyFileKey, SurveyFileEntry>>;

const MAX_FILE_BYTES = 100 * 1024 * 1024;

const readEntry = async (file: File): Promise<SurveyFileEntry & { key: SurveyFileKey }> => {
  const key = surveyFileKeyOf(file.name);
  if (!key) throw new Error("not a survey file");

  if (file.size > MAX_FILE_BYTES) {
    return { key, fileName: file.name, json: null, check: { status: "invalid", message: "Larger than 100 MB." } };
  }
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return { key, fileName: file.name, json: null, check: { status: "invalid", message: "Not valid JSON." } };
  }
  return { key, fileName: file.name, json, check: checkSurveyFile(key, json) };
};

export const useSurveyFiles = (startOverride: SurveyFiles["start"] | null) => {
  const [entries, setEntries] = useState<Entries>({});
  const [ignored, setIgnored] = useState<string[]>([]);
  const [isReading, setIsReading] = useState(false);

  const addFiles = useCallback(async (files: readonly File[]) => {
    const surveyFiles = files.filter(file => surveyFileKeyOf(file.name) !== null);
    setIgnored(files.filter(file => surveyFileKeyOf(file.name) === null).map(file => file.name));
    setIsReading(true);
    try {
      const read = await Promise.all(surveyFiles.map(readEntry));
      setEntries(current => {
        const next = { ...current };
        for (const { key, ...entry } of read) next[key] = entry;
        return next;
      });
    } finally {
      setIsReading(false);
    }
  }, []);

  const removeFile = useCallback((key: SurveyFileKey) => {
    setEntries(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const addSampleFiles = useCallback(async () => {
    const files = await Promise.all(
      SURVEY_FILE_KEYS.map(async key => {
        const fileName = SURVEY_FILE_NAMES[key];
        const response = await fetch(`${SAMPLE_DATA_URL}/${fileName}`);
        return new File([await response.blob()], fileName, { type: "application/geo+json" });
      }),
    );
    await addFiles(files);
  }, [addFiles]);

  const summary = useMemo(() => {
    const needed = SURVEY_FILE_KEYS.filter(key => !(key === "start" && startOverride));
    const missing = needed.filter(key => !entries[key] && !isServerPlanned(key));
    const invalid = needed.filter(key => entries[key]?.check.status === "invalid");
    return { missing, invalid, isComplete: missing.length === 0 && invalid.length === 0 };
  }, [entries, startOverride]);

  const toSurveyFiles = useCallback((): SurveyFiles | null => {
    const raw = Object.fromEntries(
      SURVEY_FILE_KEYS.map(key => [key, entries[key]?.json ?? (isServerPlanned(key) ? null : undefined)]),
    );
    const result = surveyFilesSchema.safeParse(startOverride ? { ...raw, start: startOverride } : raw);
    return result.success ? result.data : null;
  }, [entries, startOverride]);

  return { entries, ignored, isReading, summary, addFiles, addSampleFiles, removeFile, toSurveyFiles };
};

export type SurveyFilesState = ReturnType<typeof useSurveyFiles>;
