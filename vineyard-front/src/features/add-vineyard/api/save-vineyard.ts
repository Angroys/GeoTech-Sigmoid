import type { Session } from "@/entities/session";
import {
  blocksBounds,
  createSurveyId,
  imageryFromCog,
  saveUploadedVineyard,
  type LngLatBounds,
  type SurveyFiles,
  type SurveyId,
} from "@/entities/survey";
import { ApiError } from "@/shared/api";

import { formatSurveyDate, parseGroundSample, type AddVineyardValues } from "../model/validation";

const THUMBNAIL_MARGIN_DEGREES = 0.0005;

const padded = ([west, south, east, north]: LngLatBounds): LngLatBounds => [
  west - THUMBNAIL_MARGIN_DEGREES,
  south - THUMBNAIL_MARGIN_DEGREES,
  east + THUMBNAIL_MARGIN_DEGREES,
  north + THUMBNAIL_MARGIN_DEGREES,
];

type SaveVineyardRequest = {
  values: AddVineyardValues;
  files: SurveyFiles;
  imageryBounds: LngLatBounds | null;
  session: Session;
};

export const saveVineyard = async ({
  values,
  files,
  imageryBounds,
  session,
}: SaveVineyardRequest): Promise<SurveyId> => {
  const name = values.name.trim();
  const id = createSurveyId(name);
  const imageryUrl = values.imageryUrl.trim();

  try {
    await saveUploadedVineyard({
      source: {
        id,
        name,
        location: values.location.trim(),
        capturedOn: formatSurveyDate(values.capturedOn),
        groundSampleCm: parseGroundSample(values.groundSampleCm),
        areaHectares: null,
        imagery:
          imageryBounds && imageryUrl
            ? imageryFromCog(imageryUrl, {
                bounds: imageryBounds,
                focus: padded(blocksBounds(files)),
                attribution: `${name} aerial survey, added by ${session.fullName}`,
              })
            : null,
        data: { kind: "uploaded" },
        uploadedBy: { accountId: session.accountId, fullName: session.fullName },
      },
      files,
      uploadedAt: new Date().toISOString(),
    });
  } catch {
    throw new ApiError("This browser refused to store the survey. Allow site data, or free some space, and try again.");
  }
  return id;
};
