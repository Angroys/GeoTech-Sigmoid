import { centroidOf, type ParcelFeature } from "./to-parcel-dto";
import type { WfsClient, WfsGeometry } from "./wfs-client";

const COMMUNES = "cadastru_data:UAT1";
const DISTRICTS = "cadastru_data:UAT2";
const MAX_AREAS = 50;
const MAX_CACHED_LOCATIONS = 5_000;
const UNKNOWN_LOCATION = "Location not stated in the cadastre";

type Point = [number, number];
type Area = { name: string; geometry: WfsGeometry };

const isInsideRing = ([x, y]: Point, ring: readonly number[][]) =>
  ring.reduce((isInside, [xi = 0, yi = 0], index) => {
    const [xj = 0, yj = 0] = ring[(index + ring.length - 1) % ring.length] ?? [];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    return crosses ? !isInside : isInside;
  }, false);

const isInsidePolygon = (point: Point, [outer = [], ...holes]: readonly number[][][]) =>
  isInsideRing(point, outer) && !holes.some(hole => isInsideRing(point, hole));

const contains = (geometry: WfsGeometry, point: Point) =>
  geometry.type === "Polygon"
    ? isInsidePolygon(point, geometry.coordinates)
    : geometry.coordinates.some(polygon => isInsidePolygon(point, polygon));

const extentFilter = (points: readonly Point[]) => {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return `BBOX(geom,${Math.min(...xs)},${Math.min(...ys)},${Math.max(...xs)},${Math.max(...ys)},'EPSG:32635')`;
};

const nameOf = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const createLocator = (wfs: WfsClient) => {
  const cache = new Map<string, string>();

  const areasAround = async (typeName: string, points: readonly Point[]): Promise<Area[]> => {
    const { features } = await wfs.getFeatures({
      typeName,
      filter: extentFilter(points),
      count: MAX_AREAS,
      propertyNames: ["name", "geom"],
    });
    return features.flatMap(({ geometry, properties }) => {
      const name = nameOf(properties.name);
      return geometry && name ? [{ name, geometry }] : [];
    });
  };

  const nameAt = (areas: readonly Area[], point: Point) => areas.find(area => contains(area.geometry, point))?.name;

  const locate = async (parcels: readonly ParcelFeature[]): Promise<Map<string, string>> => {
    const missing = parcels.filter(parcel => !cache.has(parcel.cadastralNumber));
    if (missing.length > 0) {
      if (cache.size + missing.length > MAX_CACHED_LOCATIONS) cache.clear();
      const centres = missing.map(parcel => centroidOf(parcel.outline));
      const [communes, districts] = await Promise.all([areasAround(COMMUNES, centres), areasAround(DISTRICTS, centres)]);
      missing.forEach((parcel, index) => {
        const centre = centres[index] ?? [0, 0];
        const names = [nameAt(communes, centre), nameAt(districts, centre)].filter(Boolean);
        cache.set(parcel.cadastralNumber, names.length > 0 ? names.join(", ") : UNKNOWN_LOCATION);
      });
    }
    return new Map(parcels.map(parcel => [parcel.cadastralNumber, cache.get(parcel.cadastralNumber) ?? UNKNOWN_LOCATION]));
  };

  return { locate };
};
