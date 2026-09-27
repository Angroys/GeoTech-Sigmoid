import { z } from "zod";

import { createObjectStore } from "@/shared/lib/storage";

import { lngLatBoundsSchema, surveyIdSchema, type SurveySource } from "../config/sources";
import { surveyFilesSchema, type SurveyFiles } from "./schema";

const store = createObjectStore("vineyard", "uploaded-vineyards");
const UPLOADS_CHANGE_EVENT = "vineyard:uploads-change";

export const uploadedSourceSchema = z.object({
  id: surveyIdSchema,
  name: z.string().min(1),
  location: z.string().min(1),
  capturedOn: z.string().min(1),
  groundSampleCm: z.number().positive().nullable(),
  areaHectares: z.number().positive().nullable(),
  imagery: z
    .object({
      tileUrl: z.url(),
      thumbnailUrl: z.url(),
      cogUrl: z.url().nullable().default(null),
      attribution: z.string(),
      bounds: lngLatBoundsSchema,
    })
    .nullable(),
  data: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("uploaded") }),
    z.object({
      kind: z.literal("remote"),
      url: z.string().startsWith("/"),
      results: z
        .object({ origin: z.enum(["model", "fallback"]).nullable(), message: z.string().nullable() })
        .optional(),
    }),
    z.object({
      kind: z.literal("processing"),
      state: z.enum(["processing", "failed"]),
      tileCount: z.number().int().nonnegative(),
      submittedAt: z.iso.datetime(),
      message: z.string().nullable(),
    }),
  ]),
  uploadedBy: z.object({ accountId: z.string().min(1), fullName: z.string().min(1) }),
  parcelNumbers: z.array(z.string()).default([]),
});

const uploadedVineyardSchema = z.object({
  source: uploadedSourceSchema,
  files: surveyFilesSchema.nullable(),
  uploadedAt: z.iso.datetime(),
});

export type UploadedVineyard = z.output<typeof uploadedVineyardSchema>;

const announceChange = () => window.dispatchEvent(new Event(UPLOADS_CHANGE_EVENT));

export const subscribeToUploads = (onChange: () => void) => {
  window.addEventListener(UPLOADS_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(UPLOADS_CHANGE_EVENT, onChange);
};

export const listUploadedSources = async (): Promise<SurveySource[]> => {
  const records = await store.getAll();
  return records.flatMap(record => {
    const result = uploadedVineyardSchema.safeParse(record);
    return result.success ? [result.data.source] : [];
  });
};

export const readUploadedFiles = async (id: string): Promise<SurveyFiles | null> => {
  const result = uploadedVineyardSchema.safeParse(await store.get(id));
  return result.success ? result.data.files : null;
};

export const saveUploadedVineyard = async (vineyard: UploadedVineyard) => {
  await store.put(vineyard.source.id, vineyard);
  announceChange();
};

export const updateUploadedSource = async (id: string, changes: Pick<SurveySource, "data">) => {
  const result = uploadedVineyardSchema.safeParse(await store.get(id));
  if (!result.success) return;
  await store.put(id, { ...result.data, source: { ...result.data.source, ...changes } });
  announceChange();
};

export const removeUploadedVineyard = async (id: string) => {
  await store.remove(id);
  announceChange();
};
