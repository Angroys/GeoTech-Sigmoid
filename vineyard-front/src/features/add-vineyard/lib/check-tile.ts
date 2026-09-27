export const TILE_ACCEPT = ".tif,.tiff,image/tiff";

const TILE_EXTENSION = /\.tiff?$/i;
const MAX_TILE_BYTES = 100 * 1024 * 1024;
const LITTLE_ENDIAN_TIFF = [0x49, 0x49, 0x2a, 0x00];
const BIG_ENDIAN_TIFF = [0x4d, 0x4d, 0x00, 0x2a];

export type TileCheck = { status: "valid" } | { status: "invalid"; message: string };

const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  signature.every((byte, index) => bytes[index] === byte);

const hasTiffSignature = async (file: File) => {
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return startsWith(bytes, LITTLE_ENDIAN_TIFF) || startsWith(bytes, BIG_ENDIAN_TIFF);
};

export const checkTile = async (file: File): Promise<TileCheck> => {
  if (!TILE_EXTENSION.test(file.name)) return { status: "invalid", message: "Not a .tif or .tiff file." };
  if (file.size === 0) return { status: "invalid", message: "The file is empty." };
  if (file.size > MAX_TILE_BYTES) return { status: "invalid", message: "Larger than 100 MB." };
  if (!(await hasTiffSignature(file))) return { status: "invalid", message: "Not a GeoTIFF image." };
  return { status: "valid" };
};
