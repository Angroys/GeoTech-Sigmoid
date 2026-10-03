import { createLocator } from "./locate";
import { readParcelFeature, toParcelDto, type ParcelFeature } from "./to-parcel-dto";
import { createWfsClient, quoteCql, WfsError } from "./wfs-client";

export const GEOPORTAL_CADASTRE_WFS = "https://geodata.gov.md/geoserver/cadastru_data/wfs";

const PARCELS = "cadastru_data:terenuri";
const PARCEL_FIELDS = ["codcadastral", "landuse", "aria", "geom"] as const;
const MAX_PARCELS_IN_BOUNDS = 200;
const MAX_CANDIDATES_IN_BOUNDS = 3_000;
const MIN_VINEYARD_HECTARES = 0.15;
const BUILT_UP_LAND_USES = ["construc", "comunica", "amenajat", "special"] as const;
const AGRICULTURAL_LAND_USE = /agricol|multian|vi[țt]/i;
const MAX_BOUNDS_SPAN_DEGREES = 0.1;
const CADASTRAL_NUMBER = /^\d{10,11}$/;
const PARCEL_PATH = /^\/api\/cadastre\/parcels\/([^/]+)$/;
const ATTRIBUTION = "© AGCC, Î.S. INGEOCAD, geodata.gov.md";

const builtUpFilter = BUILT_UP_LAND_USES.map(word => `landuse ILIKE ${quoteCql(`%${word}%`)}`).join(" OR ");

const vineyardRank = (parcel: ParcelFeature) => (AGRICULTURAL_LAND_USE.test(parcel.landUse) ? 0 : 1);

const byVineyardLikelihood = (a: ParcelFeature, b: ParcelFeature) =>
  vineyardRank(a) - vineyardRank(b) || b.areaHa - a.areaHa;

const message = (status: number, text: string) => Response.json({ message: text }, { status });

const readBounds = (value: string) => {
  const numbers = value.split(",").map(Number);
  if (numbers.length !== 4 || numbers.some(number => !Number.isFinite(number))) return null;
  const [west = 0, south = 0, east = 0, north = 0] = numbers;
  const isOrdered = west < east && south < north;
  const isSmall = east - west <= MAX_BOUNDS_SPAN_DEGREES && north - south <= MAX_BOUNDS_SPAN_DEGREES;
  return isOrdered && isSmall ? { west, south, east, north } : null;
};

export const createCadastreRoutes = (baseUrl: string) => {
  const wfs = createWfsClient(baseUrl);
  const locator = createLocator(wfs);

  const parcelsWhere = async (filter: string, count: number) => {
    const { features, matched } = await wfs.getFeatures({ typeName: PARCELS, filter, count, propertyNames: PARCEL_FIELDS });
    const parcels = features.map(readParcelFeature).filter((parcel): parcel is ParcelFeature => parcel !== null);
    return { parcels, matched };
  };

  const withLocations = async (parcels: readonly ParcelFeature[]) => {
    const locations = await locator.locate(parcels).catch(() => new Map<string, string>());
    return parcels.map(parcel => toParcelDto(parcel, locations.get(parcel.cadastralNumber) ?? "Location not available"));
  };

  const findOne = async (cadastralNumber: string) => {
    if (!CADASTRAL_NUMBER.test(cadastralNumber)) return message(404, "No parcel has this cadastral number.");
    const { parcels } = await parcelsWhere(`codcadastral=${quoteCql(cadastralNumber)}`, 1);
    if (parcels.length === 0) return message(404, "No parcel has this cadastral number.");
    const [parcel] = await withLocations(parcels);
    return Response.json({ ...parcel, attribution: ATTRIBUTION });
  };

  const findInBounds = async (value: string) => {
    const bounds = readBounds(value);
    if (!bounds) return message(400, "Give bbox as west,south,east,north in degrees, at most 0.1° across.");
    const { west, south, east, north } = bounds;
    const { parcels: candidates, matched } = await parcelsWhere(
      `BBOX(geom,${west},${south},${east},${north},'EPSG:4326') AND NOT (${builtUpFilter})`,
      MAX_CANDIDATES_IN_BOUNDS,
    );
    const eligible = candidates
      .filter(parcel => parcel.areaHa >= MIN_VINEYARD_HECTARES)
      .toSorted(byVineyardLikelihood);
    const parcels = eligible.slice(0, MAX_PARCELS_IN_BOUNDS);
    const isTruncated = eligible.length > parcels.length || (matched ?? candidates.length) > candidates.length;
    return Response.json({ parcels: await withLocations(parcels), is_truncated: isTruncated, attribution: ATTRIBUTION });
  };

  const handle = async (req: Request) => {
    if (req.method !== "GET") return message(405, "Only GET is supported.");
    const { pathname, searchParams } = new URL(req.url);
    try {
      const single = PARCEL_PATH.exec(pathname);
      if (single?.[1]) return await findOne(decodeURIComponent(single[1]));
      if (pathname !== "/api/cadastre/parcels") return message(404, "Not found.");
      const bbox = searchParams.get("bbox");
      if (bbox !== null) return await findInBounds(bbox);
      if (searchParams.has("owner")) {
        return message(503, "Owner search needs the Real Estate Register, which is reached through MConnect.");
      }
      return message(400, "Search by cadastral number, bbox or owner.");
    } catch (error) {
      if (error instanceof WfsError) return message(502, error.message);
      throw error;
    }
  };

  return handle;
};
