#!/usr/bin/env bash
# Download pretrained weights for SAM-Road into road_extraction/weights/ (gitignored).
#
#   sam_vit_b_01ec64.pth         SAM ViT-B image encoder (Meta, Apache-2.0)
#                                https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth
#   cityscale_vitb_512_e10.ckpt  SAM-Road trained on City-scale (1 m/px, 512 px patches)
#   spacenet_vitb_256_e10.ckpt   SAM-Road trained on SpaceNet   (1 m/px, 256 px patches)
#                                both from https://huggingface.co/congrui/sam_road
#                                (linked in the sam_road README "Our Checkpoints")
#
# Idempotent: files already present with the expected size are skipped.
# Never commit these files.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEIGHTS_DIR="${SAM_ROAD_WEIGHTS_DIR:-$HERE/weights}"
HF_BASE="https://huggingface.co/congrui/sam_road/resolve/main"
mkdir -p "$WEIGHTS_DIR"

# name|url|expected_size_bytes
FILES=(
  "sam_vit_b_01ec64.pth|https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth|375042383"
  "cityscale_vitb_512_e10.ckpt|$HF_BASE/cityscale_vitb_512_e10.ckpt|1054078423"
  "spacenet_vitb_256_e10.ckpt|$HF_BASE/spacenet_vitb_256_e10.ckpt|1046803927"
)

for entry in "${FILES[@]}"; do
  IFS='|' read -r name url size <<<"$entry"
  dest="$WEIGHTS_DIR/$name"
  if [[ -f "$dest" && "$(stat -c %s "$dest")" == "$size" ]]; then
    echo "[weights] $name present ($size bytes), skipping"
    continue
  fi
  echo "[weights] downloading $name"
  curl -fL --progress-bar --retry 5 --retry-delay 5 -C - -o "$dest.part" "$url"
  actual="$(stat -c %s "$dest.part")"
  if [[ "$actual" != "$size" ]]; then
    echo "[weights] ERROR: $name size $actual != expected $size" >&2
    exit 1
  fi
  mv "$dest.part" "$dest"
done
echo "[weights] all weights in $WEIGHTS_DIR"
