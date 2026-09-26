import { mkdir } from "node:fs/promises";
import path from "node:path";
import proj4 from "proj4";

type Vec = { x: number; y: number };
type Quad = { topLeft: Vec; topRight: Vec; bottomRight: Vec; bottomLeft: Vec };

const OUTPUT_DIR = path.join(import.meta.dir, "..", "public", "data", "siret3");
const UTM_35N = "+proj=utm +zone=35 +datum=WGS84 +units=m +no_defs";
const CRS_MEMBER = { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::32635" } } as const;

const TRACE_ZOOM = 18;
const TRACE_ORIGIN_TILE = { x: 151975, y: 92070 };

const ROW_SPACING_M = 3;
const HEADLAND_M = 4;
const VINE_SPACING_M = 1.2;
const VINE_LENGTH_M = 1.05;
const CANOPY_HALF_WIDTH_M = 0.45;
const MIN_GAP_VINES = 3;
const DISRUPTING_GAP_M = 5;
const SNAP_LIMIT_M = 25;
const WALKING_SPEED_KMH = 4;

const BLOCK_TRACES: Record<string, [Vec, Vec, Vec, Vec]> = {
  V1: [
    { x: 284, y: 374 },
    { x: 610, y: 272 },
    { x: 756, y: 470 },
    { x: 400, y: 574 },
  ],
  V2: [
    { x: 404, y: 590 },
    { x: 762, y: 482 },
    { x: 910, y: 686 },
    { x: 580, y: 784 },
  ],
  V3: [
    { x: 742, y: 750 },
    { x: 834, y: 720 },
    { x: 942, y: 936 },
    { x: 836, y: 964 },
  ],
};
const START_TRACE: Vec = { x: 268, y: 356 };
const OUTSIDE_WASTE_TRACE: Vec = { x: 160, y: 300 };

const createRandom = (seed: number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const random = createRandom(20250520);
const pickWeighted = <T extends string>(entries: readonly (readonly [T, number])[]): T => {
  let roll = random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  const last = entries.at(-1);
  if (!last) throw new Error("pickWeighted needs at least one option");
  return last[0];
};

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const lerp = (a: Vec, b: Vec, t: number): Vec => add(a, scale(sub(b, a), t));
const length = (a: Vec) => Math.hypot(a.x, a.y);
const distance = (a: Vec, b: Vec) => length(sub(a, b));
const unit = (a: Vec) => scale(a, 1 / length(a));
const normal = (a: Vec): Vec => ({ x: -a.y, y: a.x });
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
const round = (value: number) => Math.round(value * 100) / 100;
const toPosition = (v: Vec) => [round(v.x), round(v.y)];
const ring = (points: Vec[]) => {
  const first = points[0];
  if (!first) throw new Error("A ring needs points");
  return [[...points, first].map(toPosition)];
};
const polygonArea = (points: Vec[]) =>
  Math.abs(points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length] ?? p), 0)) / 2;

const traceToUtm = ({ x, y }: Vec): Vec => {
  const tiles = 2 ** TRACE_ZOOM;
  const tileX = TRACE_ORIGIN_TILE.x + x / 256;
  const tileY = TRACE_ORIGIN_TILE.y + y / 256;
  const lon = (tileX / tiles) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * tileY) / tiles))) * 180) / Math.PI;
  const [easting, northing] = proj4("EPSG:4326", UTM_35N, [lon, lat]);
  if (easting === undefined || northing === undefined) throw new Error("Projection failed");
  return { x: easting, y: northing };
};

type Row = {
  vineyardId: string;
  rowId: string;
  start: Vec;
  end: Vec;
  structure: "regular" | "disrupted" | "unassessable";
  vines: Vec[][];
  gaps: { center: Vec; missingVines: number }[];
};

type Interrow = {
  vineyardId: string;
  interrowId: string;
  rowIds: [string, string];
  start: Vec;
  end: Vec;
  polygon: Vec[];
};

const trimEnds = (start: Vec, end: Vec, by: number) => {
  const direction = unit(sub(end, start));
  return { start: add(start, scale(direction, by)), end: sub(end, scale(direction, by)) };
};

const plantRow = (vineyardId: string, index: number, start: Vec, end: Vec): Row => {
  const direction = unit(sub(end, start));
  const side = scale(normal(direction), CANOPY_HALF_WIDTH_M);
  const vineCount = Math.floor(distance(start, end) / VINE_SPACING_M);
  const hasGap = random() < 0.22;
  const gapLength = MIN_GAP_VINES + Math.floor(random() * 6);
  const gapStart = Math.floor(random() * Math.max(1, vineCount - gapLength));
  const isMissing = (vine: number) => hasGap && vine >= gapStart && vine < gapStart + gapLength;

  const vines: Vec[][] = [];
  for (let vine = 0; vine < vineCount; vine++) {
    if (isMissing(vine)) continue;
    const from = add(start, scale(direction, vine * VINE_SPACING_M));
    const to = add(from, scale(direction, VINE_LENGTH_M));
    vines.push([add(from, side), add(to, side), sub(to, side), sub(from, side)]);
  }

  const gapCenter = add(start, scale(direction, (gapStart + gapLength / 2) * VINE_SPACING_M));
  const isDisrupted = hasGap && gapLength * VINE_SPACING_M >= DISRUPTING_GAP_M;
  const structure = random() < 0.03 ? "unassessable" : isDisrupted ? "disrupted" : "regular";
  return {
    vineyardId,
    rowId: `${vineyardId}-R${String(index + 1).padStart(3, "0")}`,
    start,
    end,
    structure,
    vines,
    gaps: hasGap ? [{ center: gapCenter, missingVines: gapLength }] : [],
  };
};

const plantBlock = (vineyardId: string, quad: Quad) => {
  const rowDirection = unit(add(sub(quad.bottomLeft, quad.topLeft), sub(quad.bottomRight, quad.topRight)));
  const width = Math.abs(cross(sub(quad.topRight, quad.topLeft), rowDirection));
  const rowCount = Math.round(width / ROW_SPACING_M);

  const rows = Array.from({ length: rowCount }, (_, index) => {
    const t = (index + 0.5) / rowCount;
    const { start, end } = trimEnds(
      lerp(quad.topLeft, quad.topRight, t),
      lerp(quad.bottomLeft, quad.bottomRight, t),
      HEADLAND_M,
    );
    return plantRow(vineyardId, index, start, end);
  });

  const interrows: Interrow[] = rows.slice(0, -1).flatMap((row, index) => {
    const next = rows[index + 1];
    if (!next) return [];
    const across = scale(unit(sub(next.start, row.start)), CANOPY_HALF_WIDTH_M);
    return [
      {
        vineyardId,
        interrowId: `${vineyardId}-I${String(index + 1).padStart(3, "0")}`,
        rowIds: [row.rowId, next.rowId],
        start: lerp(row.start, next.start, 0.5),
        end: lerp(row.end, next.end, 0.5),
        polygon: [add(row.start, across), add(row.end, across), sub(next.end, across), sub(next.start, across)],
      },
    ];
  });

  return { vineyardId, outline: [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft], rows, interrows };
};

const blocks = Object.entries(BLOCK_TRACES).map(([vineyardId, [topLeft, topRight, bottomRight, bottomLeft]]) =>
  plantBlock(vineyardId, {
    topLeft: traceToUtm(topLeft),
    topRight: traceToUtm(topRight),
    bottomRight: traceToUtm(bottomRight),
    bottomLeft: traceToUtm(bottomLeft),
  }),
);
const allRows = blocks.flatMap(block => block.rows);
const allInterrows = blocks.flatMap(block => block.interrows);
const startPoint = traceToUtm(START_TRACE);

type Target = {
  id: string;
  kind: "inspection_point" | "waste";
  position: Vec;
  vineyardId: string | null;
  rowId: string | null;
};

const inspectionTargets: Target[] = allRows
  .flatMap(row => row.gaps.map(gap => ({ row, gap })))
  .filter(({ gap }) => gap.missingVines >= MIN_GAP_VINES)
  .map(({ row, gap }, index) => ({
    id: `IP-${String(index + 1).padStart(3, "0")}`,
    kind: "inspection_point",
    position: gap.center,
    vineyardId: row.vineyardId,
    rowId: row.rowId,
  }));

type WasteBox = { id: string; center: Vec; halfSize: number; vineyardId: string | null };

const wasteBoxes: WasteBox[] = [
  ...Array.from({ length: 8 }, (_, index) => {
    const interrow = allInterrows[Math.floor(random() * allInterrows.length)];
    if (!interrow) throw new Error("No inter-rows to place waste in");
    return {
      id: `W-${String(index + 1).padStart(3, "0")}`,
      center: lerp(interrow.start, interrow.end, 0.1 + random() * 0.8),
      halfSize: 0.25 + random() * 0.45,
      vineyardId: interrow.vineyardId,
    };
  }),
  { id: "W-009", center: traceToUtm(OUTSIDE_WASTE_TRACE), halfSize: 0.9, vineyardId: null },
];

const wasteTargets: Target[] = wasteBoxes.map(box => ({
  id: box.id,
  kind: "waste",
  position: box.center,
  vineyardId: box.vineyardId,
  rowId: null,
}));

type Graph = { nodes: Vec[]; edges: Map<number, { to: number; weight: number }[]> };
const graph: Graph = { nodes: [], edges: new Map() };

const addNode = (position: Vec) => {
  graph.nodes.push(position);
  return graph.nodes.length - 1;
};
const connect = (a: number, b: number) => {
  const pa = graph.nodes[a];
  const pb = graph.nodes[b];
  if (!pa || !pb) throw new Error("Unknown graph node");
  const weight = distance(pa, pb);
  graph.edges.set(a, [...(graph.edges.get(a) ?? []), { to: b, weight }]);
  graph.edges.set(b, [...(graph.edges.get(b) ?? []), { to: a, weight }]);
};

const projectOnto = (point: Vec, start: Vec, end: Vec) => {
  const segment = sub(end, start);
  const t = Math.min(
    1,
    Math.max(0, ((point.x - start.x) * segment.x + (point.y - start.y) * segment.y) / length(segment) ** 2),
  );
  const snapped = lerp(start, end, t);
  return { t, snapped, offset: distance(point, snapped) };
};

const targetNodes = new Map<string, number>();
const unreachableTargets = new Set<string>();

const blockEnds = blocks.map(block => {
  const tops: number[] = [];
  const bottoms: number[] = [];
  for (const interrow of block.interrows) {
    const top = addNode(interrow.start);
    const bottom = addNode(interrow.end);
    tops.push(top);
    bottoms.push(bottom);

    const onThisInterrow = [...inspectionTargets, ...wasteTargets]
      .filter(target => target.vineyardId === block.vineyardId)
      .map(target => ({ target, ...projectOnto(target.position, interrow.start, interrow.end) }))
      .filter(({ target, offset }) => {
        const nearest = Math.min(
          ...block.interrows.map(other => projectOnto(target.position, other.start, other.end).offset),
        );
        return offset === nearest;
      })
      .sort((a, b) => a.t - b.t);

    let previous = top;
    for (const { target, snapped } of onThisInterrow) {
      if (targetNodes.has(target.id)) continue;
      const node = addNode(snapped);
      targetNodes.set(target.id, node);
      connect(previous, node);
      previous = node;
    }
    connect(previous, bottom);
  }
  tops.slice(1).forEach((node, index) => connect(tops[index] ?? node, node));
  bottoms.slice(1).forEach((node, index) => connect(bottoms[index] ?? node, node));
  return { tops, bottoms };
});

const nearestNode = (position: Vec, candidates: number[]) =>
  candidates.reduce((best, node) => {
    const bestPosition = graph.nodes[best];
    const nodePosition = graph.nodes[node];
    if (!bestPosition || !nodePosition) return best;
    return distance(position, nodePosition) < distance(position, bestPosition) ? node : best;
  });

blockEnds.slice(1).forEach((below, index) => {
  const above = blockEnds[index];
  if (!above) return;
  for (const node of above.bottoms) {
    const position = graph.nodes[node];
    if (!position) continue;
    const across = nearestNode(position, below.tops);
    const acrossPosition = graph.nodes[across];
    if (acrossPosition && distance(position, acrossPosition) < 15) connect(node, across);
  }
});

const startNode = addNode(startPoint);
const firstBlock = blockEnds[0];
if (!firstBlock) throw new Error("No blocks traced");
connect(startNode, nearestNode(startPoint, firstBlock.tops));

for (const target of wasteTargets) {
  if (target.vineyardId === null) unreachableTargets.add(target.id);
  else if (!targetNodes.has(target.id)) unreachableTargets.add(target.id);
}
for (const [id, node] of targetNodes) {
  const target = [...inspectionTargets, ...wasteTargets].find(candidate => candidate.id === id);
  const position = graph.nodes[node];
  if (target && position && distance(target.position, position) > SNAP_LIMIT_M) unreachableTargets.add(id);
}

const shortestPaths = (source: number) => {
  const dist = new Map<number, number>([[source, 0]]);
  const previous = new Map<number, number>();
  const pending = new Set<number>([source]);
  while (pending.size > 0) {
    let current = -1;
    for (const node of pending)
      if (current === -1 || (dist.get(node) ?? Infinity) < (dist.get(current) ?? Infinity)) current = node;
    pending.delete(current);
    for (const { to, weight } of graph.edges.get(current) ?? []) {
      const candidate = (dist.get(current) ?? Infinity) + weight;
      if (candidate < (dist.get(to) ?? Infinity)) {
        dist.set(to, candidate);
        previous.set(to, current);
        pending.add(to);
      }
    }
  }
  const pathTo = (target: number) => {
    const nodes = [target];
    while (nodes[0] !== source) {
      const before = previous.get(nodes[0] ?? source);
      if (before === undefined) return [];
      nodes.unshift(before);
    }
    return nodes;
  };
  return { dist, pathTo };
};

const isReachable = (target: Target) => targetNodes.has(target.id) && !unreachableTargets.has(target.id);

type PlannedRoute = { line: Vec[]; lengthM: number; stops: { id: string; distanceM: number }[] };

const planRoute = (targets: Target[]): PlannedRoute => {
  const terminals = [startNode, ...targets.map(target => targetNodes.get(target.id) ?? startNode)];
  const paths = terminals.map(shortestPaths);
  const cost = (a: number, b: number) => paths[a]?.dist.get(terminals[b] ?? startNode) ?? Infinity;

  const nearestNeighbourTour = () => {
    const tour = [0];
    const left = new Set(terminals.map((_, index) => index).slice(1));
    while (left.size > 0) {
      const from = tour.at(-1) ?? 0;
      let next = -1;
      for (const candidate of left) if (next === -1 || cost(from, candidate) < cost(from, next)) next = candidate;
      tour.push(next);
      left.delete(next);
    }
    return tour;
  };

  const tourLength = (tour: number[]) =>
    tour.reduce((sum, stop, index) => sum + cost(stop, tour[(index + 1) % tour.length] ?? 0), 0);

  const improveWithTwoOpt = (tour: number[]) => {
    let best = tour;
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 1; i < best.length - 1; i++) {
        for (let j = i + 1; j < best.length; j++) {
          const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
          if (tourLength(candidate) + 0.01 < tourLength(best)) {
            best = candidate;
            improved = true;
          }
        }
      }
    }
    return best;
  };

  const tour = improveWithTwoOpt(nearestNeighbourTour());
  const line: Vec[] = [startPoint];
  const stops: PlannedRoute["stops"] = [];
  let walked = 0;
  let from = 0;
  for (const stop of [...tour.slice(1), 0]) {
    for (const node of (paths[from]?.pathTo(terminals[stop] ?? startNode) ?? []).slice(1)) {
      const point = graph.nodes[node];
      if (!point) continue;
      walked += distance(line.at(-1) ?? point, point);
      line.push(point);
    }
    const target = targets[stop - 1];
    if (stop !== 0 && target) stops.push({ id: target.id, distanceM: round(walked) });
    from = stop;
  }
  return { line, lengthM: walked, stops };
};

const reachableTargets = [...inspectionTargets, ...wasteTargets].filter(isReachable);
const inspectionRoute = planRoute(reachableTargets);
const wasteRoute = planRoute(wasteTargets.filter(isReachable));

const baselineLength =
  allInterrows.reduce((sum, interrow) => sum + distance(interrow.start, interrow.end), 0) +
  blocks.reduce((sum, block) => sum + (block.interrows.length - 1) * ROW_SPACING_M, 0) +
  2 * distance(startPoint, blocks[0]?.interrows[0]?.start ?? startPoint);

const featureCollection = (features: object[]) => ({ type: "FeatureCollection", crs: CRS_MEMBER, features });
const feature = (geometry: object, properties: object) => ({ type: "Feature", geometry, properties });
const coverFor = () =>
  pickWeighted([
    ["bare_soil", 70],
    ["mixed", 15],
    ["vegetation", 10],
    ["unassessable", 5],
  ]);

const routeFile = (route: PlannedRoute, purpose: "inspection" | "waste_collection") =>
  featureCollection([
    feature(
      { type: "LineString", coordinates: route.line.map(toPosition) },
      {
        purpose,
        length_m: round(route.lengthM),
        baseline_length_m: round(baselineLength),
        walking_speed_kmh: WALKING_SPEED_KMH,
        stop_ids: route.stops.map(stop => stop.id),
        stop_distances_m: route.stops.map(stop => stop.distanceM),
        start: toPosition(startPoint),
      },
    ),
  ]);

const files = {
  "blocks.geojson": featureCollection(
    blocks.map(block =>
      feature({ type: "Polygon", coordinates: ring(block.outline) }, { vineyard_id: block.vineyardId }),
    ),
  ),
  "rows.geojson": featureCollection(
    allRows.map(row =>
      feature(
        { type: "LineString", coordinates: [toPosition(row.start), toPosition(row.end)] },
        {
          label: "row",
          vineyard_id: row.vineyardId,
          row_id: row.rowId,
          row_structure: row.structure,
          length_m: round(distance(row.start, row.end)),
        },
      ),
    ),
  ),
  "canopy.geojson": featureCollection(
    allRows.flatMap(row =>
      row.vines.map(vine =>
        feature(
          { type: "Polygon", coordinates: ring(vine) },
          { label: "vineyard", vineyard_id: row.vineyardId, row_id: row.rowId, area_m2: round(polygonArea(vine)) },
        ),
      ),
    ),
  ),
  "interrows.geojson": featureCollection(
    allInterrows.map(interrow =>
      feature(
        { type: "Polygon", coordinates: ring(interrow.polygon) },
        {
          label: "interrow_area",
          vineyard_id: interrow.vineyardId,
          interrow_id: interrow.interrowId,
          row_ids: interrow.rowIds,
          interrow_cover: coverFor(),
          area_m2: round(polygonArea(interrow.polygon)),
        },
      ),
    ),
  ),
  "waste.geojson": featureCollection(
    wasteBoxes.map(box => {
      const corner = { x: box.halfSize, y: box.halfSize * 0.8 };
      const box4 = [
        sub(box.center, corner),
        { x: box.center.x + corner.x, y: box.center.y - corner.y },
        add(box.center, corner),
        { x: box.center.x - corner.x, y: box.center.y + corner.y },
      ];
      return feature(
        { type: "Polygon", coordinates: ring(box4) },
        { label: "waste", waste_id: box.id, vineyard_id: box.vineyardId, reachable: !unreachableTargets.has(box.id) },
      );
    }),
  ),
  "inspection_points.geojson": featureCollection(
    inspectionTargets.map(target =>
      feature(
        { type: "Point", coordinates: toPosition(target.position) },
        {
          point_id: target.id,
          vineyard_id: target.vineyardId,
          row_id: target.rowId,
          reason: "row_gap",
          reachable: !unreachableTargets.has(target.id),
        },
      ),
    ),
  ),
  "route.geojson": routeFile(inspectionRoute, "inspection"),
  "route_waste.geojson": routeFile(wasteRoute, "waste_collection"),
  "start.geojson": featureCollection([feature({ type: "Point", coordinates: toPosition(startPoint) }, {})]),
};

await mkdir(OUTPUT_DIR, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  await Bun.write(path.join(OUTPUT_DIR, name), JSON.stringify(content));
}

console.log(
  `Wrote ${Object.keys(files).length} files to ${OUTPUT_DIR}\n` +
    `  blocks ${blocks.length}, rows ${allRows.length}, vines ${allRows.reduce((n, row) => n + row.vines.length, 0)}\n` +
    `  targets ${reachableTargets.length} reachable, ${unreachableTargets.size} unreachable\n` +
    `  inspection route ${Math.round(inspectionRoute.lengthM)} m, ${inspectionRoute.stops.length} stops
` +
    `  waste route ${Math.round(wasteRoute.lengthM)} m, ${wasteRoute.stops.length} stops
` +
    `  baseline ${Math.round(baselineLength)} m`,
);
