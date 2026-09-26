import type { LineString, Point, Polygon, Position } from "geojson";
import proj4 from "proj4";

export const SURVEY_CRS = "EPSG:32635";
const UTM_35N_DEFINITION = "+proj=utm +zone=35 +datum=WGS84 +units=m +no_defs";

proj4.defs(SURVEY_CRS, UTM_35N_DEFINITION);
const toWgs84 = proj4(SURVEY_CRS, "EPSG:4326");

export const reprojectPosition = (position: Position): Position => toWgs84.forward(position);

export const projectToSurveyCrs = (lngLat: Position): Position => toWgs84.inverse(lngLat);

export const SURVEY_CRS_LONGITUDES = { west: 24, east: 30 } as const;

export const reprojectPoint = (point: Point): Point => ({
  ...point,
  coordinates: reprojectPosition(point.coordinates),
});

export const reprojectLineString = (line: LineString): LineString => ({
  ...line,
  coordinates: line.coordinates.map(reprojectPosition),
});

export const reprojectPolygon = (polygon: Polygon): Polygon => ({
  ...polygon,
  coordinates: polygon.coordinates.map(ring => ring.map(reprojectPosition)),
});
