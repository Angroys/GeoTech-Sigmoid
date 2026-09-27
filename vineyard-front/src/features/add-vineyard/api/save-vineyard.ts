import type { Session } from "@/entities/session";
import {
  imageryFromCog,
  saveUploadedVineyard,
  SIRET3,
  type LngLatBounds,
  type SurveyId,
} from "@/entities/survey";
import { ApiError } from "@/shared/api";

import { formatSurveyDate, type AddVineyardValues } from "../model/validation";

type StoredSource = Parameters<typeof saveUploadedVineyard>[0]["source"];

type Imagery = { url: string; bounds: LngLatBounds } | null;

type NewVineyard = {
  id: SurveyId;
  values: AddVineyardValues;
  imagery: Imagery;
  session: Session;
  parcelNumbers: readonly string[];
};

const STORAGE_REFUSED = "This browser refused to store the vineyard. Allow site data, or free some space, and try again.";

const baseSource = ({ id, values, imagery, session, parcelNumbers }: NewVineyard): Omit<StoredSource, "data"> => {
  const name = values.name.trim();
  return {
    id,
    name,
    location: values.location.trim(),
    capturedOn: formatSurveyDate(values.capturedOn),
    groundSampleCm: null,
    areaHectares: null,
    imagery: imagery
      ? imageryFromCog(imagery.url, {
          bounds: imagery.bounds,
          focus: imagery.bounds,
          attribution: `${name} aerial survey, added by ${session.fullName}`,
        })
      : null,
    uploadedBy: { accountId: session.accountId, fullName: session.fullName },
    parcelNumbers: [...parcelNumbers],
  };
};

const store = async (source: StoredSource) => {
  try {
    await saveUploadedVineyard({ source, files: null, uploadedAt: new Date().toISOString() });
  } catch {
    throw new ApiError(STORAGE_REFUSED);
  }
};

export const saveProcessingVineyard = async (vineyard: NewVineyard, tileCount: number) => {
  await store({
    ...baseSource(vineyard),
    data: { kind: "processing", state: "processing", tileCount, submittedAt: new Date().toISOString(), message: null },
  });
};

export const saveSampleVineyard = async (vineyard: NewVineyard) => {
  const source = baseSource(vineyard);
  await store({
    ...source,
    groundSampleCm: SIRET3.groundSampleCm,
    imagery: source.imagery ?? SIRET3.imagery,
    data: SIRET3.data,
  });
};
