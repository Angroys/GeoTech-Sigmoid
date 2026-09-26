# GeoTech-Sigmoid dataset — Sireț3 vineyard labels

All geometry is **EPSG:32635** (WGS 84 / UTM 35N). Tiles are 2048×2048 px at 0.025 m/px.

| Folder | Contents |
|---|---|
| `images/` | The 311 challenge image tiles (GeoTIFF, RGB). |
| `v10/labels/` | SAM-3 v10 pre-annotations, one `<tile>__labels.geojson` per tile — the starting point loaded into the labeling app. |
| `v10/parcels_v2.geojson` | Vineyard parcel outlines used to restrict labeling. |
| `current/labels/` | **Current team-corrected labels** exported from the app: `<tile>__labels.geojson` (vector) + `<tile>_mask.tif` (georeferenced label mask). Invalidated tiles are excluded. |
| `maps/siret3_labeled_map.png` | Whole-area mosaic (8704×8960 px) with every final label, the parcel outlines and invalid tiles drawn on the imagery, plus a legend. `siret3_labeled_map_preview.png` is a 2200 px preview. |
| `current/manifest.json` | Per-tile status (`verified` / `in_progress` / `unchecked` / `invalid`), who last edited it, and annotation counts. |

Mask values: `0` background · `1` vineyard (canopy) · `2` row · `3` interrow_area · `4` waste · `5` dead_vine.

Large files are stored with **Git LFS** — run `git lfs install` before cloning, or `git lfs pull` after.

## Licence / attribution
Sireț3 imagery: **CC BY 4.0** — 3DATA COLLECT / OpenAerialMap, contributors to the Open Imagery Network (tiles re-projected to EPSG:32635). Route/passage data © OpenStreetMap contributors, ODbL.
