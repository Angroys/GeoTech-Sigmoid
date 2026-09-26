# GeoTech-Sigmoid — Annotation UI Spec

Implementation-ready spec for the vineyard geo-annotation platform. Scope: **view, correct, verify, export** already-labeled data over 311 GeoTIFF tiles (2048×2048 px, EPSG:32635, 0.025 m/px). React + Leaflet (Simple/pixel CRS) or canvas polygon editor. Team-internal over Headscale, minimal auth. Deadline-critical: buildable in **< 1 day**. Density and speed over polish.

All colors/spacing/type reference `design/design-tokens.json`. Token paths below use dot notation, e.g. `overlay.rows.stroke`, `color.dark.panel`, `spacing.2`.

---

## Top-level component inventory

| Component | Used in | Tokens |
|---|---|---|
| `AppShell` (header + status bar + routed body) | all | `color.dark.bg`, `color.dark.border` |
| `ProgressBar` (overall verified/total) | navigator, header | `status.verified.solid`, `status.inProgress.solid` |
| `TileCard` / `TileRow` (thumb + ID + status badge) | navigator | `status.*`, `color.dark.panel` |
| `StatusBadge` (unchecked/in-progress/verified) | navigator, viewer header | `status.*` |
| `FilterBar` (status filter chips + sort + jump-to-tile) | navigator | `semantic.selectedBg`, `spacing.1` |
| `MapCanvas` (Leaflet Simple CRS, raster + overlays) | viewer | `overlay.*`, `zoom.*` |
| `OverlayLayer` (polygons colored by class) | viewer | `overlay.*`, `overlay.halo` |
| `VertexHandleLayer` (move/add/delete handles) | viewer | `vertex.*` |
| `ClassAttrPanel` (class switch + attribute radios) | viewer | `overlay.*`, `semantic.selected*` |
| `LayerToggles` (class visibility + optional geojson routes) | viewer | `color.dark.panel`, `semantic.accent` |
| `TileActionBar` (Save / Mark verified / prev-next) | viewer | `semantic.accent`, `status.verified` |
| `ExportPanel` (CVAT + GeoTIFF mask, progress) | export | `semantic.accent`, `status.*` |
| `Toast` / inline status (save ok, export done, errors) | all | `semantic.success`, `semantic.danger` |
| `Button` (primary/secondary/danger/ghost) | all | `semantic.*` |

**Interactive states** (every button/chip/toggle implements all): default, hover (`semantic.hoverBg`), focus-visible (`semantic.focusRing`, `focusRingWidth`), active (`semantic.accentActive`), selected (`semantic.selectedBg` + `selectedRing`), disabled (`semantic.disabledFg`/`disabledBg`), loading (spinner, dim), error (`semantic.danger`).

---

## Screen 1 — Tile Navigator

Landing screen. Grid of all 311 tiles with per-tile status, overall progress, filter/sort, jump-to-tile.

### Wireframe
```
┌──────────────────────────────────────────────────────────────────────┐
│ GeoTech-Sigmoid   Vineyard Annotation      [ jump to tile #___ ↵ ]     │  header (color.dark.bgElevated)
├──────────────────────────────────────────────────────────────────────┤
│ Progress ▓▓▓▓▓▓▓▓░░░░░░░  142/311 verified · 37 in-progress · 132 open  │  ProgressBar
├──────────────────────────────────────────────────────────────────────┤
│ Filter: [ All ] [●Unchecked] [●In-progress] [●Verified]   Sort:[ID ▾]  │  FilterBar
├──────────────────────────────────────────────────────────────────────┤
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                 │
│ │thumb │ │thumb │ │thumb │ │thumb │ │thumb │ │thumb │   TileCard grid  │
│ │ #001●│ │ #002●│ │ #003●│ │ #004●│ │ #005●│ │ #006●│   (● = badge)    │
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘                 │
│ ┌──────┐ ┌──────┐ ┌──────┐ ...                             (virtualized)│
│ └──────┘ └──────┘ └──────┘                                             │
└──────────────────────────────────────────────────────────────────────┘
```

### Component inventory
- `ProgressBar`: three-segment fill — verified (`status.verified.solid`), in-progress (`status.inProgress.solid`), unchecked remainder (`color.dark.border`). Numeric readout in `typography.fontFamily.mono`.
- `FilterBar`: status filter chips (multi-select toggle, `semantic.selectedBg` when active), sort dropdown (ID / status / block), and a **jump-to-tile** number input (mono, `Enter` → open viewer).
- `TileCard`: raster thumbnail, tile ID (mono `typography.size.sm`), `StatusBadge` (corner dot + border tint from `status.*.solid`/`.bg`). Hover → `color.dark.panelHover` + `elevation.popover`; focus-visible ring; selected ring `semantic.selectedRing`.
- Grid virtualized (311 cards) — `react-window` or CSS grid with windowing; `spacing.2` gutter, min card width 128px, responsive auto-fill.

### Interaction / keyboard
- Arrow keys move card focus; `Enter` opens the focused tile in the viewer.
- `/` focuses jump-to-tile input; type number + `Enter` to jump.
- Number keys are *not* bound here (reserved for class-select in viewer).
- Filter chips toggle on click/`Space`; sort persists in URL/localStorage.
- Status is read from tile metadata; navigator re-fetches or updates optimistically after a viewer "Mark verified".

---

## Screen 2 — Viewer + Polygon Editor

Core annotation surface. Tile raster background, class-colored overlays, vertex editing, class/attribute editor, save + verify, layer toggles, zoom/pan.

### Wireframe
```
┌──────────────────────────────────────────────────────────────────────────┐
│ ‹ Nav   Tile #047  block B3  [In-progress●]        [Save ⌘S] [✓ Verify V] │  header + TileActionBar
├───────────────────────────────────────────────┬──────────────────────────┤
│                                                 │ CLASS                     │
│                                                 │ (1) ▮ rows                │  ClassAttrPanel
│              MapCanvas (Leaflet Simple CRS)     │ (2) ▮ canopies            │
│              raster tile + OverlayLayer         │ (3) ▮ inter-row           │
│              + VertexHandleLayer                │ ─────────────             │
│                                                 │ ATTRIBUTES                │
│                        ● selected polygon       │  rows:   ( )regular       │
│                       ╱ ╲ vertices              │          (•)disrupted     │
│                      ●───● + midpoint-add       │  inter:  (•)bare_soil     │
│                                                 │          ( )mixed         │
│                                                 │ ─────────────             │
│                                                 │ LAYERS                    │  LayerToggles
│                                                 │ [x] rows  [x] canopies    │
│                                                 │ [x] inter [ ] routes.geo  │
│  zoom [+][-]  · x:1024 y:730 · 0.025 m/px       │                           │
└───────────────────────────────────────────────┴──────────────────────────┘
```

### Component inventory
- `MapCanvas`: Leaflet `L.CRS.Simple`, image overlay of the 2048×2048 tile, `maxZoom` per `zoom.maxZoom`, fit-to-viewport initial. Coordinate readout bottom-left in mono.
- `OverlayLayer`: one styled path per polygon, colored by class + attribute:
  - rows/regular → `overlay.rows`; rows/disrupted → `overlay.rowsDisrupted`
  - canopies → `overlay.canopies`
  - inter-row/bare_soil → `overlay.interRowBareSoil`; inter-row/mixed → `overlay.interRowMixed` (amber + `dashArray "6 4"`)
  - **Render each polygon as: halo path (strokeWidth+2, `overlay.halo.color`) → fill → colored stroke.** Guarantees edge contrast over bright aerial imagery.
- `VertexHandleLayer`: circular handles per `vertex.default/hover/selected`; hovered edge highlighted (`vertex.edge`); `vertex.midpointAdd` ghost handles at edge midpoints — click inserts a vertex. Drag a handle to move; select + `Delete` removes.
- `ClassAttrPanel`: class list with color swatch (`overlay.*.stroke`) and hotkey label; selecting a class re-tags the active polygon. Attribute radios switch per class: rows → regular/disrupted, inter-row → bare_soil/mixed. Selected radio uses `semantic.selectedRing`.
- `LayerToggles`: per-class visibility checkboxes + optional route geojson overlay toggle.
- `TileActionBar`: `Save` (primary, `semantic.accent`), `Mark verified` (`status.verified.solid`), prev/next tile. Save shows loading then `semantic.success` toast; dirty state marks header badge.

### Interaction / keyboard (fast annotation)
- Click a polygon to select (shows vertices); `Esc` deselects.
- Drag vertex to move; click midpoint-add ghost to insert; select vertex + `Delete`/`Backspace` to remove.
- Class hotkeys `1/2/3` set the selected polygon's class; attribute hotkeys `Q/W` toggle the two attribute values of the current class.
- `⌘S`/`Ctrl+S` save; `V` mark verified; `[` / `]` prev/next tile; `⌘Z`/`⌘⇧Z` undo/redo.
- Scroll = zoom (`zoom.wheelPxPerZoomLevel`), space-drag or middle-drag = pan.
- All destructive actions (delete vertex/polygon) are undoable; no confirm dialogs (speed).

---

## Screen 3 — Export Panel

Two export paths with independent progress feedback: **CVAT for images 1.1** (XML/annotation format matching the pre-annotation input) and **rasterized GeoTIFF label-mask**.

### Wireframe
```
┌──────────────────────────────────────────────────────────────────────┐
│ ‹ Nav    Export                                                        │
├──────────────────────────────────────────────────────────────────────┤
│ Scope: (•) All tiles (311)   ( ) Verified only (142)   ( ) Selection   │
├──────────────────────────────────────────────────────────────────────┤
│ ┌─ CVAT for images 1.1 ──────────────────┐ ┌─ GeoTIFF label mask ────┐ │
│ │ Format: annotations.xml (CVAT 1.1)      │ │ Per-tile rasterized PNG/ │ │
│ │ Includes class + attributes             │ │ GeoTIFF mask, class-coded│ │
│ │                                          │ │ EPSG:32635 preserved     │ │
│ │ [ Export CVAT ]                          │ │ [ Export masks ]         │ │
│ │ ▓▓▓▓▓▓▓░░░░  63%  (196/311)              │ │ ░░░░░░░░  idle           │ │
│ │ ✓ done → download annotations.xml        │ │                          │ │
│ └──────────────────────────────────────────┘ └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Component inventory
- Scope radio group (all / verified-only / current selection) shared by both exports.
- Two `ExportCard`s, each: title, description, primary `Export` button, a `ProgressBar` (uses `status.inProgress.solid` while running, `status.verified.solid` on done), tile-count readout (mono), and a download/result link on completion.
- Error state per card: `semantic.dangerBg` band + retry button; partial-failure list (which tile IDs failed).

### Interaction / keyboard
- Buttons disabled + spinner while their job runs; the other card stays usable.
- Progress polls job status; completion swaps button → download link + `semantic.success` toast.
- `Esc` returns to navigator.

---

## Consolidated keyboard shortcuts

| Key | Action | Screen |
|---|---|---|
| `1` / `2` / `3` | Set class: rows / canopies / inter-row | Viewer |
| `Q` / `W` | Toggle attribute A / B of current class (regular↔disrupted, bare_soil↔mixed) | Viewer |
| `⌘S` / `Ctrl+S` | Save tile | Viewer |
| `V` | Mark verified | Viewer |
| `[` / `]` | Previous / next tile | Viewer |
| `⌘Z` / `⌘⇧Z` (`Ctrl`) | Undo / redo | Viewer |
| `Delete` / `Backspace` | Delete selected vertex (or polygon if none selected) | Viewer |
| click edge-midpoint ghost | Add vertex | Viewer |
| `Esc` | Deselect / back to navigator | Viewer / Export |
| `Enter` | Open focused tile / confirm jump | Navigator |
| Arrow keys | Move tile focus | Navigator |
| `/` | Focus jump-to-tile input | Navigator |
| scroll / space-drag | Zoom / pan | Viewer |

---

## Frontend integration quick-map

- Import: `import tokens from '@/design/design-tokens.json'`.
- Overlay style resolver: `key = class==='rows' ? (attr==='disrupted'?'rowsDisrupted':'rows') : class==='canopies' ? 'canopies' : (attr==='mixed'?'interRowMixed':'interRowBareSoil')` → `tokens.overlay[key]`. Draw halo first (`tokens.overlay.halo`), then fill, then stroke; apply `dashArray` when present.
- Neutral chrome: bind `tokens.color.dark.*` to CSS custom properties on `:root`; swap to `tokens.color.light.*` if a light toggle is added.
- Status badges/navigator: `tokens.status[unchecked|inProgress|verified]`.
- Vertex handles: `tokens.vertex.*` (radii are CSS px, independent of Leaflet zoom).
- Spacing/type: use `tokens.spacing.*` and `tokens.typography.*` only — no ad-hoc values (8px grid).
