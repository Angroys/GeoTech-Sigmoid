import type { Position } from "geojson";

import { projectToSurveyCrs, reprojectPosition, SURVEY_CRS_LONGITUDES } from "./reproject";

const EASTING = { min: 166_000, max: 834_000 };
const NORTHING = { min: 0, max: 9_330_000 };

type ReadPoint = { utm: Position; lngLat: Position };

export type CoordinateReading =
  | { kind: "empty" }
  | { kind: "invalid"; message: string }
  | ({ kind: "lat-lng"; latitude: number; longitude: number } & ReadPoint)
  | ({ kind: "utm"; easting: number; northing: number } & ReadPoint);

export type ReadCoordinates = Extract<CoordinateReading, { kind: "lat-lng" | "utm" }>;

export const isReadCoordinates = (reading: CoordinateReading): reading is ReadCoordinates =>
  reading.kind === "lat-lng" || reading.kind === "utm";

const extractNumbers = (text: string): number[] => {
  const cleaned = text.replace(/[°'"NnEe]/g, " ").trim();
  let parts = cleaned.split(/\s*;\s*|\s*\t\s*|,\s+|\s+/).filter(Boolean);
  if (parts.length === 1 && (cleaned.match(/,/g) ?? []).length === 1 && cleaned.includes(".")) {
    parts = cleaned.split(",");
  }
  return parts.map(part => (/^-?\d+([.,]\d+)?$/.test(part) ? Number(part.replace(",", ".")) : Number.NaN));
};

const isInSurveyZone = (longitude: number) =>
  longitude >= SURVEY_CRS_LONGITUDES.west && longitude <= SURVEY_CRS_LONGITUDES.east;

const readLatLng = (latitude: number, longitude: number): CoordinateReading => {
  if (!isInSurveyZone(longitude)) {
    const swapHint = isInSurveyZone(latitude) ? " If you pasted longitude first, swap the two numbers." : "";
    return {
      kind: "invalid",
      message: `Longitude ${longitude}° is outside EPSG:32635, which covers ${SURVEY_CRS_LONGITUDES.west}° to ${SURVEY_CRS_LONGITUDES.east}° east.${swapHint}`,
    };
  }
  const lngLat = [longitude, latitude];
  return { kind: "lat-lng", latitude, longitude, lngLat, utm: projectToSurveyCrs(lngLat) };
};

const readUtm = (easting: number, northing: number): CoordinateReading => {
  if (easting < EASTING.min || easting > EASTING.max || northing < NORTHING.min || northing > NORTHING.max) {
    return {
      kind: "invalid",
      message: "These look like metres but fall outside EPSG:32635. Paste the easting first, then the northing.",
    };
  }
  const utm = [easting, northing];
  return { kind: "utm", easting, northing, utm, lngLat: reprojectPosition(utm) };
};

export const readCoordinates = (text: string): CoordinateReading => {
  if (text.trim() === "") return { kind: "empty" };

  const numbers = extractNumbers(text);
  const [first, second] = numbers;
  if (numbers.length !== 2 || first === undefined || second === undefined || numbers.some(Number.isNaN)) {
    return { kind: "invalid", message: "Paste two numbers: latitude and longitude, or easting and northing." };
  }
  if (Math.abs(first) <= 90 && Math.abs(second) <= 180) return readLatLng(first, second);
  return readUtm(first, second);
};

const DEGREES = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 5, maximumFractionDigits: 5 });
const METRES = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const formatLngLat = ([longitude = 0, latitude = 0]: Position) =>
  `${DEGREES.format(latitude)}° N, ${DEGREES.format(longitude)}° E`;

export const formatUtm = ([easting = 0, northing = 0]: Position) =>
  `${METRES.format(easting)} m E, ${METRES.format(northing)} m N`;
