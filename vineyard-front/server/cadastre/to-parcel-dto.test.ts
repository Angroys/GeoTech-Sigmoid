import { expect, test } from "bun:test";

import { largestPolygon, parseHectares, readParcelFeature, toParcelDto } from "./to-parcel-dto";

const square = (x: number, y: number, size: number) => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];

test("reads a geoportal parcel into the cadastre API shape", () => {
  const parcel = readParcelFeature({
    geometry: { type: "Polygon", coordinates: [square(629500, 5220300, 40)] },
    properties: { codcadastral: "80371140111", landuse: "Teren  pentru grădini", aria: "0.12 ha" },
  });

  expect(parcel).not.toBeNull();
  expect(parcel && toParcelDto(parcel, "sat. Sireți, r-nul Strășeni")).toEqual({
    cadastral_number: "80371140111",
    area_ha: 0.12,
    land_use: "Teren pentru grădini",
    location: "sat. Sireți, r-nul Strășeni",
    geometry: { type: "Polygon", coordinates: [square(629500, 5220300, 40) as [number, number][]] },
  });
});

test("skips features without a valid cadastral number or geometry", () => {
  const geometry = { type: "Polygon" as const, coordinates: [square(0, 0, 10)] };
  expect(readParcelFeature({ geometry, properties: { codcadastral: "12345" } })).toBeNull();
  expect(readParcelFeature({ geometry: null, properties: { codcadastral: "80371140111" } })).toBeNull();
});

test("computes the area when the cadastre does not state it", () => {
  const parcel = readParcelFeature({
    geometry: { type: "Polygon", coordinates: [square(0, 0, 100)] },
    properties: { codcadastral: "3631204101" },
  });
  expect(parcel?.areaHa).toBe(1);
});

test("keeps the largest part of a multipolygon", () => {
  const outline = largestPolygon({
    type: "MultiPolygon",
    coordinates: [[square(0, 0, 5)], [square(100, 100, 50)]],
  });
  expect(outline.coordinates[0]?.[0]).toEqual([100, 100]);
});

test("parses hectares written by the geoportal", () => {
  expect(parseHectares("0.53 ha")).toBe(0.53);
  expect(parseHectares("1,25 ha")).toBe(1.25);
  expect(parseHectares("unknown")).toBeNull();
});
