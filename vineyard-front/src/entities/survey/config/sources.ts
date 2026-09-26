import { z } from "zod";

export const lngLatBoundsSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type LngLatBounds = [west: number, south: number, east: number, north: number];

export const surveyIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .brand<"SurveyId">();
export type SurveyId = z.infer<typeof surveyIdSchema>;

export type SurveyImagery = {
  tileUrl: string;
  thumbnailUrl: string;
  attribution: string;
  bounds: LngLatBounds;
};

export type SurveyDataLocation = { kind: "remote"; url: string } | { kind: "uploaded" };

export type SurveySource = {
  id: SurveyId;
  name: string;
  location: string;
  capturedOn: string;
  groundSampleCm: number | null;
  areaHectares: number | null;
  imagery: SurveyImagery | null;
  data: SurveyDataLocation;
  uploadedBy: { accountId: string; fullName: string } | null;
};

const TITILER = "https://titiler.hotosm.org/cog";

const formatBbox = (bounds: LngLatBounds) => bounds.map(value => value.toFixed(6)).join(",");

export const imageryFromCog = (
  cogUrl: string,
  { bounds, focus, attribution }: { bounds: LngLatBounds; focus: LngLatBounds; attribution: string },
): SurveyImagery => {
  const url = encodeURIComponent(cogUrl);
  return {
    tileUrl: `${TITILER}/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?url=${url}`,
    thumbnailUrl: `${TITILER}/bbox/${formatBbox(focus)}/640x400.jpg?url=${url}`,
    attribution,
    bounds,
  };
};

export const COG_INFO_URL = (cogUrl: string) => `${TITILER}/info.geojson?url=${encodeURIComponent(cogUrl)}`;

const SIRET3_GEOTIFF =
  "https://oin-hotosm-temp.s3.us-east-1.amazonaws.com/68305aa2025981aa41124bc7/0/68305aa2025981aa41124bc8.tif";

export const SIRET3: SurveySource = {
  id: surveyIdSchema.parse("siret3"),
  name: "Sireț3",
  location: "Sireți, Moldova",
  capturedOn: "20 May 2025",
  groundSampleCm: 3.52,
  areaHectares: 145,
  imagery: imageryFromCog(SIRET3_GEOTIFF, {
    bounds: [28.700935, 47.113536, 28.723167, 47.131247],
    focus: [28.70683, 47.12041, 28.71156, 47.12377],
    attribution: "Sireț3 © 3DATA COLLECT, CC BY 4.0, via OpenAerialMap",
  }),
  data: { kind: "remote", url: "/data/siret3" },
  uploadedBy: null,
};

export const BUILT_IN_SOURCES: readonly SurveySource[] = [SIRET3];
