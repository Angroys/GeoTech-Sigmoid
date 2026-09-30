# Tile processing API

The web app sends a new vineyard's drone tiles to a processing service, which turns them into the survey files
the app displays. The Bun server forwards every `/api/surveys/*` request to the service at
`PROCESSING_API_URL`, for example `PROCESSING_API_URL=http://127.0.0.1:8002 bun dev`. Without that variable
it answers `503 { "message": "The tile processing service is not connected." }`.

Errors are JSON `{ "message": string }` with a matching HTTP status. The app shows the message to the owner.

## Endpoints

| Request | Body | Answer |
|---|---|---|
| `POST /api/surveys` | `{ id, name, location, capturedOn, imageryUrl }` (JSON; `capturedOn` is `YYYY-MM-DD`, `imageryUrl` may be `null`) | `201 { id }` |
| `PUT /api/surveys/{id}/tiles/{fileName}` | The GeoTIFF bytes, `Content-Type: image/tiff` | `201` |
| `POST /api/surveys/{id}/process` | none | `202` |
| `GET /api/surveys/{id}` | none | `200 { status: "uploading" \| "processing" \| "ready" \| "failed", message?: string }` |
| `GET /api/surveys/{id}/results/{file}` | none | `200` GeoJSON |

- `id` is chosen by the app and matches `^[a-z0-9-]+$`.
- Tiles are uploaded unchanged, one request per tile, keeping their original names (for example
  `siret3_r005_c004.tif`). Uploading the same name again replaces it.
- The service checks each tile: GeoTIFF, EPSG:32635, 2048 × 2048 px at 0.025 m per pixel for the challenge
  data. A bad tile is rejected with `422` and a message naming the problem.
- The app polls `GET /api/surveys/{id}` every 30 seconds while the vineyard is processing.

## Result files

When the status is `ready`, the app loads these files from `/api/surveys/{id}/results/`. Their schema is the
one the app already reads for the built-in Sireț3 survey (`public/data/siret3/`), all in EPSG:32635:

`blocks.geojson`, `rows.geojson`, `canopy.geojson`, `interrows.geojson`, `waste.geojson`,
`inspection_points.geojson`, `start.geojson`.

The same results folder also holds the **challenge deliverable** for the uploaded tiles:

| File | Content |
|---|---|
| `annotations.xml` | CVAT 1.1, one `<image>` per uploaded tile (empty tiles included), exactly the four challenge labels: `vineyard` (polygon, one per plant), `row` (polyline, one per row per tile, `vineyard_id` / `row_id` / `row_structure`), `interrow_area` (polygon, one per row gap, `interrow_cover`), `waste` (rectangle). Checked against the label contract before the survey becomes `ready`. |
| `challenge.geojson` | The same objects in EPSG:32635 with their attributes and source `tile`. |

IDs are consistent across the uploaded tiles: a row crossing tile edges keeps its `row_id`. Dead vines are
never exported (annotation rules: draw nothing). Classes the model was not trained on (run5: waste) produce
no objects.

Routes are not part of the results: the app plans them on the Route tab through the routing service
(`route-algo`).
