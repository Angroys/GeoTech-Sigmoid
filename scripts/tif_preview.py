"""
GeoTIFF / multispectral TIFF preview helper for JupyterHub.

CLI:
    python tif_preview.py <file.tif> [out.png] [--bands R G B] [--max 2000]
      -> writes a viewable PNG (double-click it in JupyterLab to see it)

Notebook:
    from tif_preview import show
    show("data/canyelles_vineyard_2024_15166695/dataset/ORTHOMOSAICS/xxx.tif")   # inline
    show("...file.tif", bands=(5,3,2))   # false-colour (NIR,R,G) if >=5 bands

Handles: multi-band rasters (auto-picks RGB), single-band (greyscale/DEM via colormap),
nodata masking, and a 2-98 percentile contrast stretch. Downsamples large rasters.
"""
import sys
import numpy as np
import rasterio
from rasterio.enums import Resampling


def render(path, out=None, bands=None, max_dim=2000):
    with rasterio.open(path) as src:
        nb = src.count
        scale = max(src.width, src.height) / float(max_dim)
        scale = max(scale, 1.0)
        ow, oh = int(src.width / scale), int(src.height / scale)

        if bands is None:
            if nb >= 3:
                bands = (3, 2, 1)          # assume B,G,R,... -> RGB
            else:
                bands = (1, 1, 1)          # single band -> grey
        chans = []
        for b in bands:
            arr = src.read(b, out_shape=(oh, ow), resampling=Resampling.average).astype("float32")
            valid = arr[np.isfinite(arr) & (arr != (src.nodata if src.nodata is not None else np.nan))]
            valid = valid[valid > 0] if valid.size else valid
            if valid.size:
                lo, hi = np.percentile(valid, [2, 98])
            else:
                lo, hi = float(np.nanmin(arr)), float(np.nanmax(arr))
            arr = np.clip((arr - lo) / (hi - lo + 1e-9), 0, 1)
            chans.append((arr * 255).astype("uint8"))
        img = np.dstack(chans)

    meta = dict(bands=nb, size=(src.width, src.height), crs=str(src.crs), dtype=src.dtypes[0])
    if out:
        from PIL import Image
        Image.fromarray(img, "RGB").save(out)
    return img, meta


def show(path, bands=None, max_dim=2000):
    """Render inline in a Jupyter notebook and print metadata."""
    import matplotlib.pyplot as plt
    img, meta = render(path, out=None, bands=bands, max_dim=max_dim)
    print(f"{path}\n  bands={meta['bands']} size={meta['size']} crs={meta['crs']} dtype={meta['dtype']}")
    plt.figure(figsize=(10, 10 * img.shape[0] / img.shape[1]))
    plt.imshow(img); plt.axis("off"); plt.tight_layout(); plt.show()
    return meta


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        print(__doc__); sys.exit(1)
    path = a[0]
    out = a[1] if len(a) > 1 and not a[1].startswith("--") else path.rsplit(".", 1)[0] + "_preview.png"
    bands = None; max_dim = 2000
    if "--bands" in a:
        i = a.index("--bands"); bands = tuple(int(x) for x in a[i + 1:i + 4])
    if "--max" in a:
        max_dim = int(a[a.index("--max") + 1])
    _, meta = render(path, out=out, bands=bands, max_dim=max_dim)
    print(f"wrote {out}  ({meta})")
