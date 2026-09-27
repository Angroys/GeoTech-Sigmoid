import type { Polygon, Position } from "geojson";
import { z } from "zod";

import { ApiError } from "@/shared/api";
import { reprojectPolygon } from "@/shared/lib/geo";

import {
  DEMO_BLOCKS_URL,
  DEMO_LAND_USE,
  DEMO_LOCATION,
  DEMO_OWNER_FISCAL_CODE,
  DEMO_PARCEL_OF_BLOCK,
  UNSURVEYED_DEMO_PARCEL,
} from "../config/demo-parcels";
import { cadastralNumberSchema, ownerParcelsResponseSchema, parcelDtoSchema, type ParcelDto } from "../model/schema";
import type { Parcel, ParcelSource } from "../model/types";

const API_BASE = "/api/cadastre/parcels";
const SERVICE_UNAVAILABLE = 503;
const NOT_FOUND = 404;
const SQUARE_METRES_PER_HECTARE = 10_000;

const demoBlocksSchema = z.object({
  features: z.array(
    z.object({
      properties: z.object({ vineyard_id: z.string() }),
      geometry: parcelDtoSchema.shape.geometry,
    }),
  ),
});

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

const loadDemoParcels = async (): Promise<Parcel[]> => {
  const response = await fetch(DEMO_BLOCKS_URL);
  const blocks = demoBlocksSchema.parse(await response.json());
  const surveyed = blocks.features.flatMap(({ properties, geometry }) =>
    demoParcel(DEMO_PARCEL_OF_BLOCK[properties.vineyard_id] ?? "", geometry.coordinates[0] ?? []),
  );
  const unsurveyed = demoParcel(
    UNSURVEYED_DEMO_PARCEL.cadastralNumber,
    UNSURVEYED_DEMO_PARCEL.outline.map(([x, y]) => [x, y]),
  );
  return [...surveyed, ...unsurveyed];
};

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
    const parcels = fiscalCode === DEMO_OWNER_FISCAL_CODE ? await loadDemoParcels() : [];
    return { parcels, source: "demo" };
  }
  const body = ownerParcelsResponseSchema.parse(await response.json());
  return { parcels: body.parcels.map(dto => toParcel(dto, false)), source: "cadastre" };
};

export type ParcelLookup = { parcel: Parcel | null; source: ParcelSource };

export const findParcel = async (cadastralNumber: string): Promise<ParcelLookup> => {
  const response = await request(`/${encodeURIComponent(cadastralNumber)}`);
  if (!response) {
    const demo = await loadDemoParcels();
    return { parcel: demo.find(parcel => parcel.cadastralNumber === cadastralNumber) ?? null, source: "demo" };
  }
  if (response.status === NOT_FOUND) return { parcel: null, source: "cadastre" };
  return { parcel: toParcel(parcelDtoSchema.parse(await response.json()), false), source: "cadastre" };
};
