export const DEMO_OWNER_FISCAL_CODE = "1003600000001";

export const DEMO_LAND_USE = "Perennial plantation, vineyard (plantații multianuale, viță-de-vie)";

export const DEMO_LOCATION = "Sireți, Strășeni district";

type DemoParcel = { cadastralNumber: string; outline: readonly (readonly [number, number])[] };

export const DEMO_PARCELS: readonly DemoParcel[] = [
  {
    cadastralNumber: "3631204101",
    outline: [
      [629508.47, 5220244.84],
      [629640.21, 5220289.11],
      [629701.37, 5220210.1],
      [629557.44, 5220164.74],
      [629508.47, 5220244.84],
    ],
  },
  {
    cadastralNumber: "3631204102",
    outline: [
      [629559.21, 5220158.29],
      [629703.92, 5220205.28],
      [629765.95, 5220123.85],
      [629632.54, 5220081.16],
      [629559.21, 5220158.29],
    ],
  },
  {
    cadastralNumber: "3631204103",
    outline: [
      [629698.16, 5220096.4],
      [629735.33, 5220109.38],
      [629781.19, 5220022.73],
      [629738.31, 5220010.43],
      [629698.16, 5220096.4],
    ],
  },
  {
    cadastralNumber: "3631204104",
    outline: [
      [629380, 5220190],
      [629495, 5220230],
      [629470, 5220300],
      [629355, 5220262],
      [629380, 5220190],
    ],
  },
];

export const DEMO_SURVEYED_PARCEL_NUMBERS: readonly string[] = ["3631204101", "3631204102", "3631204103"];
