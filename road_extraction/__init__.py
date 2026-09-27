"""Road-network extraction over the Siret3 GeoTIFF tile grid.

Model-free helpers live in the submodules:

- :mod:`road_extraction.tiles`   -- filename parsing, tile index, grid geometry
- :mod:`road_extraction.mosaic`  -- decimated field mosaic with its own affine
- :mod:`road_extraction.windows` -- overlapping windows + blended stitching
- :mod:`road_extraction.geo`     -- pixel<->CRS, mask resampling, GeoTIFF writing
- :mod:`road_extraction.graph`   -- mask -> skeleton -> graph -> GeoJSON lines
- :mod:`road_extraction.topo`    -- TopoNet query building + undirected edge voting
- :mod:`road_extraction.paths`   -- repo-root / default paths, output naming, tile selection
- :mod:`road_extraction.render`  -- preview PNG overlays

Model code (torch + upstream SAM-Road) is isolated in :mod:`road_extraction.sam_road_infer`;
the CLI is :mod:`road_extraction.extract_roads` (``python -m road_extraction.extract_roads``).

All geometry is in the source CRS (EPSG:32635, WGS 84 / UTM zone 35N, metres).
"""
