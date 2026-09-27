import { expect, test } from "bun:test";

import { SIRET3 } from "@/entities/survey";

import { imageryForTiles } from "./save-vineyard";

test("Sireț3 challenge tiles reuse the Sireț3 orthomosaic as background", () => {
  expect(imageryForTiles(["siret3_r005_c004.tif", "siret3_r006_c002.tif"])).toBe(SIRET3.imagery);
});

test("other tiles get no borrowed background", () => {
  expect(imageryForTiles(["DJI_0056_r000_c000.tif"])).toBeNull();
  expect(imageryForTiles(["siret3_r005_c004.tif", "drone_r001_c005.tif"])).toBeNull();
  expect(imageryForTiles([])).toBeNull();
});
