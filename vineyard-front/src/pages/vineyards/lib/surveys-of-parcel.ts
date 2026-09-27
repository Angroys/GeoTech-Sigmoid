import type { SurveySource } from "@/entities/survey";

export const surveysOfParcel = (sources: readonly SurveySource[], cadastralNumber: string) =>
  sources.filter(source => source.parcelNumbers.includes(cadastralNumber));

export const surveysOutside = (sources: readonly SurveySource[], cadastralNumbers: readonly string[]) =>
  sources.filter(source => !source.parcelNumbers.some(number => cadastralNumbers.includes(number)));
