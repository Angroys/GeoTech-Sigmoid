import { afterEach, expect, test } from "bun:test";
import type { Survey } from "../model/types";
import { surveyFilesSchema } from "../model/schema";
import { assembleSurvey } from "../lib/assemble-survey";
import { planSurveyRoute } from "./plan-route";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const empty = { type: "FeatureCollection", features: [] };
const emptyMap = {
  supplied_passages: empty,
  forbidden_areas: empty,
  study_area: empty,
  inferred_headlands: empty,
  route_evidence: empty,
};
const survey = (): Survey => assembleSurvey(surveyFilesSchema.parse({
  blocks: empty, rows: empty, canopy: empty, interrows: empty, waste: empty,
  inspectionPoints: { ...empty, features: [{
    type: "Feature", geometry: { type: "Point", coordinates: [629510, 5220250] },
    properties: { point_id: "p1", vineyard_id: "v1", row_id: "r1", reason: "row_gap", reachable: false },
  }] },
  inspectionRoute: null, wasteRoute: null,
  start: { ...empty, features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [629504.7, 5220250.75] } }] },
}));

test("sends UTM inputs and applies returned route and reachability to the map survey", async () => {
  let body: any;
  globalThis.fetch = (async (_url, options) => {
    body = JSON.parse(String(options?.body));
    return Response.json({
      route: { type: "FeatureCollection", features: [{
        type: "Feature", geometry: { type: "LineString", coordinates: [body.start, [629510, 5220250], body.start] },
        properties: { purpose: "inspection", length_m: 11, baseline_length_m: 12, baseline_kind: "nearest_neighbour", walking_speed_kmh: 4, stop_ids: ["p1"], stop_distances_m: [3] },
      }] },
      map: {
        ...emptyMap,
        supplied_passages: { ...empty, features: [{ type: "Feature", properties: { type: "passage" },
          geometry: { type: "Polygon", coordinates: [[[629504, 5220250], [629506, 5220250], [629506, 5220252], [629504, 5220250]]] } }] },
      },
      report: { target_count: 1, visited_count: 1, coverage_ratio: 1, outside_length_m: 0,
        outside_blocks_length_m: 2, outside_study_area_length_m: 0, closed: true, warnings: [],
        targets: [{ target_id: "p1", reachable: true, approach_distance_m: 0 }] },
    });
  }) as typeof fetch;
  const input = survey();
  const output = await planSurveyRoute(input, "inspection", input.start.geometry.coordinates, "siret3", new AbortController().signal);
  expect(body.constraint_set).toBe("siret3");
  expect(body.crs).toBe("EPSG:32635");
  expect(body.start[0]).toBeCloseTo(629504.7, 5);
  expect(body.inspection_points.features[0].geometry.coordinates[0]).toBeCloseTo(629510, 5);
  expect(body.blocks.type).toBe("FeatureCollection");
  expect(output.survey.routes.inspection?.geometry.coordinates[0]?.[0]).toBeCloseTo(input.start.geometry.coordinates[0]!, 8);
  expect(output.survey.inspectionPoints.features[0]?.properties.reachable).toBe(true);
  expect(output.routeFile?.features[0].geometry.coordinates[0]).toEqual([629504.7, 5220250.75]);
  expect(output.routeFile?.features[0].geometry.coordinates.at(-1)).toEqual([629504.7, 5220250.75]);
  expect(output.routeFile?.crs.properties.name).toBe("urn:ogc:def:crs:EPSG::32635");
  expect(output.survey.routeMap?.suppliedPassages.features[0]?.geometry.coordinates[0]?.[0]?.[0]).toBeCloseTo(
    input.start.geometry.coordinates[0]!,
    3,
  );
  expect(input.inspectionPoints.features[0]?.properties.reachable).toBe(false);
});

test("unreachable targets produce diagnostics without a map route or download", async () => {
  globalThis.fetch = (async () => Response.json({
    route: null,
    map: emptyMap,
    report: { target_count: 1, visited_count: 0, coverage_ratio: 0, outside_length_m: 0, closed: false,
      warnings: ["No targets are reachable"], targets: [{ target_id: "p1", reachable: false, approach_distance_m: 8 }] },
  })) as unknown as typeof fetch;
  const input = survey();
  const output = await planSurveyRoute(input, "inspection", input.start.geometry.coordinates, "siret3", new AbortController().signal);
  expect(output.routeFile).toBeNull();
  expect(output.survey.routes.inspection).toBeNull();
  expect(output.report.visited_count).toBe(0);
  expect(output.survey.inspectionPoints.features[0]?.properties.reachable).toBe(false);
});

test("surfaces planner errors instead of returning a saved route", async () => {
  globalThis.fetch = (async () => Response.json({ detail: "Start outside permitted geometry" }, { status: 422 })) as unknown as typeof fetch;
  const input = survey();
  await expect(planSurveyRoute(input, "inspection", input.start.geometry.coordinates, "uploaded", new AbortController().signal)).rejects.toThrow("Start outside permitted geometry");
});

test("demo mode sends row and block inputs and preserves inference metadata in exports", async () => {
  let sent: any;
  globalThis.fetch = (async (_url, options) => {
    sent = JSON.parse(String(options?.body));
    return Response.json({
      route: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [sent.start, [629510, 5220250], sent.start] },
        properties: { purpose: "inspection", length_m: 11, baseline_length_m: 12, walking_speed_kmh: 4,
          stop_ids: ["p1"], stop_distances_m: [3], path_mode: "demo_headlands", outside_supplied_length_m: 4 } }] },
      map: { ...emptyMap, inferred_headlands: { ...empty, features: [{ type: "Feature",
        properties: { source: "inferred_demo_headland" }, geometry: { type: "Polygon",
          coordinates: [[[629504, 5220250], [629506, 5220250], [629506, 5220252], [629504, 5220250]]] } }] } },
      report: { target_count: 1, visited_count: 1, coverage_ratio: 1, outside_length_m: 0, closed: true,
        warnings: ["Demo access paths"], targets: [{ target_id: "p1", reachable: true, approach_distance_m: 0 }],
        path_mode: "demo_headlands", outside_supplied_length_m: 4 },
    });
  }) as typeof fetch;
  const input = survey();
  const output = await planSurveyRoute(input, "inspection", input.start.geometry.coordinates, "siret3", new AbortController().signal, "demo_headlands");
  expect(sent.path_mode).toBe("demo_headlands");
  expect(sent.blocks.type).toBe("FeatureCollection");
  expect(sent.rows.type).toBe("FeatureCollection");
  expect(output.routeFile?.features[0].properties.path_mode).toBe("demo_headlands");
  expect(output.routeFile?.features[0].properties.outside_supplied_length_m).toBe(4);
  expect(output.survey.routeMap?.inferredHeadlands.features).toHaveLength(1);
});

test("a processed survey is planned from its own layers, without the Sireț3 constraints", async () => {
  let sent: any;
  globalThis.fetch = (async (_url, options) => {
    sent = JSON.parse(String(options?.body));
    return Response.json({
      route: null,
      map: emptyMap,
      report: { target_count: 1, visited_count: 0, coverage_ratio: 0, outside_length_m: 0, closed: false,
        warnings: [], targets: [{ target_id: "p1", reachable: false, approach_distance_m: 8 }] },
    });
  }) as typeof fetch;
  const input = survey();
  await planSurveyRoute(input, "inspection", input.start.geometry.coordinates, "e2e-t4", new AbortController().signal, "supplied");
  expect(sent.constraint_set).toBeNull();
  expect(sent.path_mode).toBe("supplied");
  expect(sent.rows).toBeUndefined();
  expect(sent.inspection_points.features[0].properties.point_id).toBe("p1");
  expect(sent.start).toEqual([629504.7, 5220250.75]);
});
