import type { Polygon } from "geojson";

import type { CadastralNumber } from "./schema";

export type Parcel = {
  cadastralNumber: CadastralNumber;
  areaHectares: number;
  landUse: string;
  location: string;
  outline: Polygon;
  isDemo: boolean;
};

export type ParcelSource = "cadastre" | "demo";
