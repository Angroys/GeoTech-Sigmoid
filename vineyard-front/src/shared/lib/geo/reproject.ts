import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
  LineString,
  MultiLineString,
  MultiPolygon,
  Point,
  Polygon,
  Position,
} from "geojson";
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

export const reprojectMultiLineString = (line: MultiLineString): MultiLineString => ({
  ...line,
  coordinates: line.coordinates.map(part => part.map(reprojectPosition)),
});

export const reprojectMultiPolygon = (polygon: MultiPolygon): MultiPolygon => ({
  ...polygon,
  coordinates: polygon.coordinates.map(part => part.map(ring => ring.map(reprojectPosition))),
});

export const reprojectGeometry = <GeometryType extends Geometry>(geometry: GeometryType): GeometryType => {
  switch (geometry.type) {
    case "Point":
      return reprojectPoint(geometry) as GeometryType;
    case "LineString":
      return reprojectLineString(geometry) as GeometryType;
    case "MultiLineString":
      return reprojectMultiLineString(geometry) as GeometryType;
    case "Polygon":
      return reprojectPolygon(geometry) as GeometryType;
    case "MultiPolygon":
      return reprojectMultiPolygon(geometry) as GeometryType;
    default:
      throw new Error(`Unsupported route map geometry: ${geometry.type}`);
  }
};

export const reprojectFeatureCollection = <GeometryType extends Geometry, Properties extends GeoJsonProperties>(
  collection: FeatureCollection<GeometryType, Properties>,
): FeatureCollection<GeometryType, Properties> => ({
  type: "FeatureCollection",
  features: collection.features.map(
    (feature): Feature<GeometryType, Properties> => ({ ...feature, geometry: reprojectGeometry(feature.geometry) }),
  ),
});
