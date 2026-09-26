import { serve } from "bun";
import path from "node:path";

import index from "./index.html";

const PROJECT_ROOT = path.join(import.meta.dir, "..");
const SURVEY_DATA_DIR = path.join(PROJECT_ROOT, "public", "data");
const MAPLIBRE_DIST_DIR = path.join(PROJECT_ROOT, "node_modules", "maplibre-gl", "dist");

const SURVEY_NAME = /^[a-z0-9-]+$/;
const SURVEY_FILE = /^[a-z0-9_-]+\.geojson$/;
const MAPLIBRE_WORKER_FILES = new Set(["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]);

const notFound = () => new Response("Not found", { status: 404 });

const serveFile = async (filePath: string, contentType: string) => {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return notFound();
  return new Response(file, { headers: { "Content-Type": contentType } });
};

const server = serve({
  routes: {
    "/*": index,

    "/data/:survey/:file": req => {
      const { survey, file } = req.params;
      if (!SURVEY_NAME.test(survey) || !SURVEY_FILE.test(file)) return notFound();
      return serveFile(path.join(SURVEY_DATA_DIR, survey, file), "application/geo+json");
    },

    "/vendor/maplibre/:file": req => {
      const { file } = req.params;
      if (!MAPLIBRE_WORKER_FILES.has(file)) return notFound();
      return serveFile(path.join(MAPLIBRE_DIST_DIR, file), "text/javascript");
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,

    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
