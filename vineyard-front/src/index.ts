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

const proxyTo = (baseUrl: string | undefined, serviceName: string) => async (req: Request) => {
  if (!baseUrl) return Response.json({ message: `The ${serviceName} service is not connected.` }, { status: 503 });
  const { pathname, search } = new URL(req.url);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  try {
    const response = await fetch(`${baseUrl}${pathname}${search}`, {
      method: req.method,
      headers: { "Content-Type": req.headers.get("Content-Type") ?? "application/octet-stream" },
      body: hasBody ? req.body : null,
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return Response.json({ message: `The ${serviceName} service did not answer. Try again later.` }, { status: 502 });
  }
};

const proxyToProcessing = proxyTo(process.env.PROCESSING_API_URL, "tile processing");
const proxyToCadastre = proxyTo(process.env.CADASTRE_API_URL, "cadastre");

const server = serve({
  // Bind every interface by default so phones/laptops on the LAN can reach the app; HOST overrides.
  hostname: process.env.HOST ?? "0.0.0.0",
  // Full-map route planning can take many minutes: never close idle connections.
  idleTimeout: 0,
  routes: {
    "/*": index,

    "/api/routes/plan": {
      POST: async req => {
        try {
          const body = await req.text();
          if (body.length > 16 * 1024 * 1024) {
            return Response.json({ detail: "Survey is too large for interactive routing." }, { status: 413 });
          }
          const response = await fetch(`${process.env.ROUTE_API_URL ?? "http://127.0.0.1:8001"}/plan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal: AbortSignal.timeout(Number(process.env.ROUTE_TIMEOUT_MS ?? 1_800_000)),
          });
          return new Response(await response.text(), {
            status: response.status,
            headers: { "Content-Type": "application/json" },
          });
        } catch {
          return Response.json(
            { detail: "The route planner is unavailable or timed out. Start the routing service and try again." },
            { status: 503 },
          );
        }
      },
    },

    "/api/cadastre/*": proxyToCadastre,
    "/api/surveys": proxyToProcessing,
    "/api/surveys/*": proxyToProcessing,

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
