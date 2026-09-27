import type { SurveySource } from "../config/sources";

export const describeCapture = (source: SurveySource) => {
  const area = source.areaHectares === null ? "" : ` of ${source.areaHectares} ha`;
  const resolution = source.groundSampleCm === null ? "" : `, at ${source.groundSampleCm} cm per pixel`;
  return `Aerial survey${area} from ${source.capturedOn}${resolution}.`;
};
