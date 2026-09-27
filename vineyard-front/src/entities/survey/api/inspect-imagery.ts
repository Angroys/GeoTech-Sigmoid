import { z } from "zod";

import { COG_INFO_URL, lngLatBoundsSchema, type LngLatBounds } from "../config/sources";

export class ImageryCheckError extends Error {
  override name = "ImageryCheckError";
}

const cogInfoSchema = z.object({ bbox: lngLatBoundsSchema });

const UNREADABLE = "This image could not be read. Check that the link is a public Cloud Optimized GeoTIFF.";

export const inspectImagery = async (cogUrl: string): Promise<LngLatBounds> => {
  let response: Response;
  try {
    response = await fetch(COG_INFO_URL(cogUrl));
  } catch {
    throw new ImageryCheckError("The imagery service could not be reached. Check your connection and try again.");
  }
  if (!response.ok) throw new ImageryCheckError(UNREADABLE);

  const result = cogInfoSchema.safeParse(await response.json());
  if (!result.success) throw new ImageryCheckError(UNREADABLE);
  return result.data.bbox;
};
