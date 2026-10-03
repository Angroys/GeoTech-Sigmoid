import { imageryCropUrl, type LngLatBounds, type SurveySource } from "@/entities/survey";

const CROP_SIZE_PX = 256;

export const parcelImageryOf = (surveys: readonly SurveySource[]) => {
  const imagery = surveys.find(source => source.imagery?.cogUrl)?.imagery;
  if (!imagery) return null;
  return (bounds: LngLatBounds) => imageryCropUrl(imagery, bounds, CROP_SIZE_PX);
};
