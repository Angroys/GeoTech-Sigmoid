import { formatCount } from "@/shared/lib/format";

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = BYTES_PER_MB * 1024;

export const formatBytes = (bytes: number) =>
  bytes >= BYTES_PER_GB
    ? `${(bytes / BYTES_PER_GB).toFixed(1)} GB`
    : `${formatCount(Math.ceil(bytes / BYTES_PER_MB))} MB`;
