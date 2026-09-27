import { expect, test } from "bun:test";

import { assembleSurvey } from "../lib/assemble-survey";
import { surveyFileSchemas, surveyFilesSchema } from "./schema";

// Trimmed from real route-algo /api/surveys/{id}/results output (fallback run): every file carries a
// top-level `crs` and `source` member next to the features.
const crs = { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::32635" } };
const collection = (features: unknown[]) => ({ type: "FeatureCollection", crs, source: "fallback", features });
const square = (x: number, y: number, size = 2) => ({
  type: "Polygon",
  coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]],
});

const processed = {
  blocks: collection([{ type: "Feature", geometry: square(629150, 5220820, 50), properties: { vineyard_id: "V1" } }]),
  rows: collection([
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[629160, 5220830], [629170, 5220830]] },
      properties: { label: "row", vineyard_id: "V1", row_id: "V1-R001", row_structure: "disrupted", length_m: 10.75 },
    },
  ]),
  canopy: collection([
    {
      type: "Feature",
      geometry: square(629160, 5220829),
      properties: { label: "vineyard", vineyard_id: "V1", row_id: "V1-R001", area_m2: 1.07 },
    },
  ]),
  interrows: collection([
    {
      type: "Feature",
      geometry: square(629160, 5220831),
      properties: {
        label: "interrow_area",
        vineyard_id: "V1",
        interrow_id: "V1-I001",
        row_ids: ["V1-R001", "V1-R002"],
        interrow_cover: "unassessable",
        area_m2: 56.13,
      },
    },
  ]),
  waste: collection([]),
  inspectionPoints: collection([
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [629165.04, 5220830.61] },
      properties: { point_id: "IP-001", vineyard_id: "V1", row_id: "V1-R001", reason: "row_gap", reachable: true },
    },
  ]),
  start: collection([{ type: "Feature", geometry: { type: "Point", coordinates: [629153.41, 5220828.22] }, properties: {} }]),
};

test("each processed result file matches the survey file schema", () => {
  for (const key of Object.keys(processed) as (keyof typeof processed)[]) {
    const result = surveyFileSchemas[key].safeParse(processed[key]);
    expect({ key, success: result.success }).toEqual({ key, success: true });
  }
});

test("processed results assemble into a displayable survey", () => {
  const survey = assembleSurvey(surveyFilesSchema.parse({ ...processed, inspectionRoute: null, wasteRoute: null }));
  expect(survey.blocks.features).toHaveLength(1);
  expect(survey.interrows.features[0]?.properties.interrow_cover).toBe("unassessable");
  expect(survey.projectedStart).toEqual([629153.41, 5220828.22]);
  expect(survey.routes).toEqual({ inspection: null, waste_collection: null });
});
