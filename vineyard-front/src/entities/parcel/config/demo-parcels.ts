export const DEMO_OWNER_FISCAL_CODE = "1003600000001";

export const DEMO_BLOCKS_URL = "/data/siret3/blocks.geojson";

export const DEMO_PARCEL_OF_BLOCK: Readonly<Record<string, string>> = {
  V1: "3631204101",
  V2: "3631204102",
  V3: "3631204103",
};

export const DEMO_LAND_USE = "Perennial plantation, vineyard (plantații multianuale, viță-de-vie)";

export const DEMO_LOCATION = "Sireți, Strășeni district";

export const UNSURVEYED_DEMO_PARCEL = {
  cadastralNumber: "3631204104",
  outline: [
    [629380, 5220190],
    [629495, 5220230],
    [629470, 5220300],
    [629355, 5220262],
    [629380, 5220190],
  ],
} as const;
