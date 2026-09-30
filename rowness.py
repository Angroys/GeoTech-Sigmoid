# rowness map: local FFT periodicity of greenness at vine-row spacing (1.5-3.8 m) on the 0.2 m mosaic
import numpy as np, rasterio, sys
from numpy.lib.stride_tricks import sliding_window_view
s = rasterio.open('data/tested-on-vm/parcels/mosaic_f8.tif')
rgb = s.read().astype(np.float32)
valid = rgb.sum(0) > 0
r, g, b = rgb
exg = (2 * g - r - b) / (r + g + b + 1)
gray = rgb.mean(0) / 255
N, ST, PXM = 64, 16, 0.2
fy = np.fft.fftfreq(N)[:, None]; fx = np.fft.fftfreq(N)[None, :]
rad = np.hypot(fy, fx) * N            # cycles per window
per = N * PXM / np.maximum(rad, 1e-6)  # period m
vine = (per >= 1.5) & (per <= 3.8)
orch = (per > 3.8) & (per <= 8)
allf = rad >= 1.5
hann = np.outer(np.hanning(N), np.hanning(N)).astype(np.float32)
H, W = exg.shape
ny, nx = (H - N) // ST + 1, (W - N) // ST + 1
out = {k: np.zeros((ny, nx), np.float32) for k in ('ratio', 'peak', 'orch', 'std', 'valid', 'gstd')}
for name, img in (('exg', exg), ('gray', gray)):
    pass
for i in range(ny):
    strip = exg[i * ST:i * ST + N]
    wins = sliding_window_view(strip, (N, N))[0, ::ST][:nx]      # (nx,N,N)
    v = sliding_window_view(valid[i * ST:i * ST + N], (N, N))[0, ::ST][:nx].mean((1, 2))
    w = wins - wins.mean((1, 2), keepdims=True)
    P = np.abs(np.fft.fft2(w * hann)) ** 2
    tot = P[:, allf].sum(1) + 1e-9
    pv = P[:, vine]
    out['ratio'][i] = pv.sum(1) / tot
    out['peak'][i] = pv.max(1) / tot
    out['orch'][i] = P[:, orch].sum(1) / tot
    out['std'][i] = wins.std((1, 2))
    out['valid'][i] = v
np.savez_compressed(sys.argv[1], **out, ST=ST, N=N)
print(ny, nx, {k: np.percentile(v[out['valid'] > 0.9], [10, 50, 90]).round(3).tolist() for k, v in out.items()})
