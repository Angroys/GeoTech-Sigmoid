# vineyard parcels v2 = FFT row-periodicity blocks (vine spacing 1.5-3.8 m) U SAM 3 parcels
import numpy as np, rasterio, json, sys
from rasterio.features import shapes, rasterize
from rasterio.transform import Affine
from scipy import ndimage as ndi
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
THR = float(sys.argv[1]) if len(sys.argv) > 1 else 0.035
z = np.load(sys.argv[2] if len(sys.argv) > 2 else 'rowness.npz')
s = rasterio.open('data/tested-on-vm/parcels/mosaic_f8.tif')
ST, N = int(z['ST']), int(z['N'])
T = s.transform * Affine.translation(N / 2 - ST / 2, N / 2 - ST / 2) * Affine.scale(ST)
pk = ndi.gaussian_filter(np.where(z['valid'] > 0.98, z['peak'], 0), 1.0)
m = (pk > THR) & (z['valid'] > 0.98)
m = ndi.binary_closing(m, iterations=2)
m = ndi.binary_opening(m, iterations=1)
m = ndi.binary_fill_holes(m)
lab, n = ndi.label(m)
sz = ndi.sum(m, lab, range(1, n + 1)) * (ST * 0.2) ** 2
idx = np.arange(1, n + 1)
orch = ndi.mean(z['orch'], lab, idx); sd = ndi.mean(z['std'], lab, idx)
# vine blocks: >= 250 m2, little orchard-spacing power (tree rows 4-8 m, houses), real green/soil texture
keep = np.isin(lab, idx[(sz >= 250) & (orch < 0.3) & (sd > 0.03)])
fft = [shape(g).buffer(1.6).buffer(-1.6) for g, v in shapes(keep.astype(np.uint8), mask=keep, transform=T) if v]
sam = [shape(f['geometry']) for f in json.load(open('data/tested-on-vm/parcels/parcels.geojson'))['features']]
U = unary_union(fft + sam)
parts = list(U.geoms) if U.geom_type == 'MultiPolygon' else [U]
feats = [{"type": "Feature", "properties": {"area_m2": round(p.area, 1),
          "source": "sam+fft" if any(p.intersects(q) for q in sam) and any(p.intersects(q) for q in fft) else ("sam" if any(p.intersects(q) for q in sam) else "fft")},
          "geometry": mapping(p)} for p in parts if p.area >= 100]
json.dump({"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32635"}}, "features": feats},
          open('data/tested-on-vm/parcels/parcels_v2.geojson', 'w'))
print("thr", THR, "fft blocks", len(fft), round(sum(p.area for p in fft) / 1e4, 2), "ha | sam", round(sum(p.area for p in sam) / 1e4, 2),
      "ha | union", len(feats), round(sum(f['properties']['area_m2'] for f in feats) / 1e4, 2), "ha")
