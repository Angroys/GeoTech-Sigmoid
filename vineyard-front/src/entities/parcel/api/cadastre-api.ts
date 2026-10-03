import type { Polygon, Position } from "geojson";

import { ApiError } from "@/shared/api";
import { reprojectPolygon } from "@/shared/lib/geo";

import { DEMO_LAND_USE, DEMO_LOCATION, DEMO_OWNER_FISCAL_CODE, DEMO_PARCELS } from "../config/demo-parcels";
import {
  cadastralNumberSchema,
  ownerParcelsResponseSchema,
  parcelDtoSchema,
  parcelsInBoundsResponseSchema,
  type ParcelDto,
} from "../model/schema";
import type { Parcel, ParcelSource } from "../model/types";

type LngLatBounds = readonly [west: number, south: number, east: number, north: number];

const API_BASE = "/api/cadastre/parcels";
const SERVICE_UNAVAILABLE = 503;
const NOT_FOUND = 404;
const SQUARE_METRES_PER_HECTARE = 10_000;

export type ParcelSearch = { parcels: Parcel[]; source: ParcelSource };

const toParcel = (dto: ParcelDto, isDemo: boolean): Parcel => ({
  cadastralNumber: dto.cadastral_number,
  areaHectares: dto.area_ha,
  landUse: dto.land_use,
  location: dto.location,
  outline: reprojectPolygon(dto.geometry satisfies Polygon),
  isDemo,
});

const ringAreaM2 = (ring: readonly Position[]) =>
  Math.abs(
    ring.slice(1).reduce((sum, [x = 0, y = 0], index) => {
      const [px = 0, py = 0] = ring[index] ?? [];
      return sum + px * y - x * py;
    }, 0),
  ) / 2;

const demoParcel = (cadastralNumber: string, ring: Position[]): Parcel[] => {
  const number = cadastralNumberSchema.safeParse(cadastralNumber);
  if (!number.success) return [];
  const dto: ParcelDto = {
    cadastral_number: number.data,
    area_ha: ringAreaM2(ring) / SQUARE_METRES_PER_HECTARE,
    land_use: DEMO_LAND_USE,
    location: DEMO_LOCATION,
    geometry: { type: "Polygon", coordinates: [ring.map(([x = 0, y = 0]): [number, number] => [x, y])] },
  };
  return [toParcel(dto, true)];
};

const demoParcels = (): Parcel[] =>
  DEMO_PARCELS.flatMap(({ cadastralNumber, outline }) =>
    demoParcel(
      cadastralNumber,
      outline.map(([x, y]) => [x, y]),
    ),
  );

const request = async (path: string): Promise<Response | null> => {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`);
  } catch {
    throw new ApiError("The cadastre service could not be reached. Check your connection and try again.");
  }
  if (response.status === SERVICE_UNAVAILABLE) return null;
  if (response.status === NOT_FOUND || response.ok) return response;
  throw new ApiError(`The cadastre service answered HTTP ${response.status}.`, response.status);
};

export const searchOwnerParcels = async (fiscalCode: string): Promise<ParcelSearch> => {
  const response = await request(`?owner=${encodeURIComponent(fiscalCode)}`);
  if (!response) {
    const parcels = fiscalCode === DEMO_OWNER_FISCAL_CODE ? demoParcels() : [];
    return { parcels, source: "demo" };
  }
  const body = ownerParcelsResponseSchema.parse(await response.json());
  return { parcels: body.parcels.map(dto => toParcel(dto, false)), source: "cadastre" };
};

export type ParcelLookup = { parcel: Parcel | null; source: ParcelSource };

const demoParcelNumbered = (cadastralNumber: string) =>
  demoParcels().find(parcel => parcel.cadastralNumber === cadastralNumber) ?? null;

export const findParcel = async (cadastralNumber: string): Promise<ParcelLookup> => {
  const response = await request(`/${encodeURIComponent(cadastralNumber)}`);
  if (!response) return { parcel: demoParcelNumbered(cadastralNumber), source: "demo" };
  if (response.status === NOT_FOUND) {
    const demo = demoParcelNumbered(cadastralNumber);
    return demo ? { parcel: demo, source: "demo" } : { parcel: null, source: "cadastre" };
  }
  return { parcel: toParcel(parcelDtoSchema.parse(await response.json()), false), source: "cadastre" };
};

export type ParcelsInBounds = { parcels: Parcel[]; isTruncated: boolean; source: ParcelSource };

export const findParcelsInBounds = async (bounds: LngLatBounds): Promise<ParcelsInBounds> => {
  const response = await request(`?bbox=${bounds.map(value => value.toFixed(6)).join(",")}`);
  if (!response || response.status === NOT_FOUND) return { parcels: [], isTruncated: false, source: "demo" };
  const body = parcelsInBoundsResponseSchema.parse(await response.json());
  return { parcels: body.parcels.map(dto => toParcel(dto, false)), isTruncated: body.is_truncated, source: "cadastre" };
};
