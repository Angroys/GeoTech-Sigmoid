import type { WfsFeature, WfsGeometry } from "./wfs-client";

type Ring = [number, number][];

export type ParcelOutline = { type: "Polygon"; coordinates: Ring[] };

export type CadastreParcel = {
  cadastral_number: string;
  area_ha: number;
  land_use: string;
  location: string;
  geometry: ParcelOutline;
};

const SQUARE_METRES_PER_HECTARE = 10_000;
const CADASTRAL_NUMBER = /^\d{10,11}$/;

const toRing = (ring: number[][]): Ring => ring.map(([x = 0, y = 0]) => [x, y]);

export const ringAreaM2 = (ring: Ring) =>
  Math.abs(
    ring.slice(1).reduce((sum, [x, y], index) => {
      const [px, py] = ring[index] ?? [x, y];
      return sum + px * y - x * py;
    }, 0),
  ) / 2;

export const largestPolygon = (geometry: WfsGeometry): ParcelOutline => {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const rings = polygons.map(polygon => polygon.map(toRing));
  const [largest = []] = rings.toSorted((a, b) => ringAreaM2(b[0] ?? []) - ringAreaM2(a[0] ?? []));
  return { type: "Polygon", coordinates: largest };
};

export const parseHectares = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const match = /^\s*([\d.,]+)\s*ha\s*$/i.exec(value);
  if (!match?.[1]) return null;
  const hectares = Number(match[1].replace(",", "."));
  return Number.isFinite(hectares) ? hectares : null;
};

export const centroidOf = ({ coordinates: [outer = []] }: ParcelOutline): [number, number] => {
  const vertices = outer.slice(0, -1);
  const points = vertices.length > 0 ? vertices : outer;
  const sum = points.reduce(([sx, sy], [x, y]) => [sx + x, sy + y], [0, 0]);
  return [sum[0] / Math.max(points.length, 1), sum[1] / Math.max(points.length, 1)];
};

const textOf = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

export type ParcelFeature = { cadastralNumber: string; outline: ParcelOutline; areaHa: number; landUse: string };

export const readParcelFeature = (feature: WfsFeature): ParcelFeature | null => {
  const cadastralNumber = textOf(feature.properties.codcadastral);
  if (!CADASTRAL_NUMBER.test(cadastralNumber) || !feature.geometry) return null;
  const outline = largestPolygon(feature.geometry);
  const [outer = []] = outline.coordinates;
  if (outer.length < 4) return null;
  return {
    cadastralNumber,
    outline,
    areaHa: parseHectares(feature.properties.aria) ?? ringAreaM2(outer) / SQUARE_METRES_PER_HECTARE,
    landUse: textOf(feature.properties.landuse) || "Not stated in the cadastre",
  };
};

export const toParcelDto = (parcel: ParcelFeature, location: string): CadastreParcel => ({
  cadastral_number: parcel.cadastralNumber,
  area_ha: parcel.areaHa,
  land_use: parcel.landUse,
  location,
  geometry: parcel.outline,
});
