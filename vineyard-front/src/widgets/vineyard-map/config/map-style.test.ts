import { expect, test } from "bun:test";

import { SIRET3, type SurveySource } from "@/entities/survey";

import { uploadedImageryTileUrl } from "./map-style";

test("processed uploads use their own tiles as background", () => {
  const source = { ...SIRET3, imagery: null, data: { kind: "remote", url: "/api/surveys/my-farm-1a2b/results" } } as SurveySource;
  expect(uploadedImageryTileUrl(source, "http://192.168.100.51:3000")).toBe(
    "http://192.168.100.51:3000/api/surveys/my-farm-1a2b/imagery/{z}/{x}/{y}.png",
  );
});

test("built-in surveys keep their own imagery source", () => {
  expect(uploadedImageryTileUrl(SIRET3, "http://x")).toBeNull();
});
