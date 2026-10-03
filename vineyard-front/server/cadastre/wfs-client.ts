import { z } from "zod";

const REQUEST_TIMEOUT_MS = 20_000;
const SURVEY_CRS = "EPSG:32635";

const positionSchema = z.array(z.number()).min(2);
const ringSchema = z.array(positionSchema);

const geometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: z.array(ringSchema) }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(ringSchema)) }),
]);

export type WfsGeometry = z.infer<typeof geometrySchema>;

const featureSchema = z.object({
  geometry: geometrySchema.nullable(),
  properties: z.record(z.string(), z.unknown()),
});

export type WfsFeature = z.infer<typeof featureSchema>;

const featureCollectionSchema = z.object({
  features: z.array(featureSchema),
  numberMatched: z.union([z.number(), z.literal("unknown")]).optional(),
});

export type WfsQuery = { typeName: string; filter: string; count: number; propertyNames?: readonly string[] };

export type WfsResult = { features: WfsFeature[]; matched: number | null };

export class WfsError extends Error {}

export const quoteCql = (value: string) => `'${value.replaceAll("'", "''")}'`;

export const createWfsClient = (baseUrl: string) => {
  const urlFor = ({ typeName, filter, count, propertyNames }: WfsQuery) => {
    const url = new URL(baseUrl);
    url.search = new URLSearchParams({
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      outputFormat: "application/json",
      srsName: SURVEY_CRS,
      typeNames: typeName,
      count: String(count),
      CQL_FILTER: filter,
      ...(propertyNames ? { propertyName: propertyNames.join(",") } : {}),
    }).toString();
    return url;
  };

  const getFeatures = async (query: WfsQuery): Promise<WfsResult> => {
    let response: Response;
    try {
      response = await fetch(urlFor(query), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new WfsError("The national geoportal did not answer.");
    }
    if (!response.ok) throw new WfsError(`The national geoportal answered HTTP ${response.status}.`);
    const parsed = featureCollectionSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new WfsError("The national geoportal answered with data the app cannot read.");
    const { features, numberMatched } = parsed.data;
    return { features, matched: typeof numberMatched === "number" ? numberMatched : null };
  };

  return { getFeatures };
};

export type WfsClient = ReturnType<typeof createWfsClient>;
