"""SAM-Road model wrapper: windowed mask inference + native TopoNet graph extraction.

Adapted from upstream ``third_party/sam_road/inferencer.py::infer_one_img``
(which cannot be imported: it parses argv at import time) with these changes:

* arbitrary (non-square) rasters via :func:`road_extraction.windows.generate_windows`
  and weighted (cosine by default) blending instead of a flat average;
* windows with too little valid (in-field) coverage are skipped;
* optional window size != model patch size (window is resized to the patch);
* TopoNet edge votes are averaged per *undirected* edge (see :mod:`road_extraction.topo`).

Keeping all torch / upstream imports in this module means the tested helpers
never load a model.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt
import torch
import torch.nn.functional as F

from road_extraction.smoke_load import MODELS, build_model
from road_extraction.topo import EdgeVotes, TopoQuery, build_query, collate
from road_extraction.windows import BlendMode, PixelWindow, Stitcher, extract_window, generate_windows

__all__ = ["MODELS", "MaskPrediction", "SamRoadRunner", "TopoGraph"]


@dataclass
class MaskPrediction:
    """Stitched probabilities (``(H, W)`` float32, 0..1) and per-window image embeddings."""

    keypoint: npt.NDArray[np.float32]
    road: npt.NDArray[np.float32]
    windows: list[PixelWindow]
    features: list[torch.Tensor]  # one [256, P/16, P/16] tensor per window (on device)


@dataclass
class TopoGraph:
    """Native SAM-Road graph in raster pixels: nodes ``(N, 2)`` (row, col), edges ``(E, 2)``, scores ``(E,)``."""

    nodes_rc: npt.NDArray[np.float64]
    edges: npt.NDArray[np.int64]
    scores: npt.NDArray[np.float64]
    n_candidate_pairs: int


class SamRoadRunner:
    """Holds one pretrained SAM-Road model and its (possibly overridden) config."""

    def __init__(
        self,
        name: str,
        device: torch.device,
        itsc_threshold: float | None = None,
        road_threshold: float | None = None,
        topo_threshold: float | None = None,
    ) -> None:
        self.name = name
        self.device = device
        self.net, config = build_model(name, device)
        self.config: Any = copy.deepcopy(config)
        if itsc_threshold is not None:
            self.config.ITSC_THRESHOLD = itsc_threshold
        if road_threshold is not None:
            self.config.ROAD_THRESHOLD = road_threshold
        if topo_threshold is not None:
            self.config.TOPO_THRESHOLD = topo_threshold
        self.patch = int(self.config.PATCH_SIZE)

    @property
    def thresholds(self) -> dict[str, float]:
        c = self.config
        return {"itsc": float(c.ITSC_THRESHOLD), "road": float(c.ROAD_THRESHOLD), "topo": float(c.TOPO_THRESHOLD)}

    # ------------------------------------------------------------------ masks

    @torch.no_grad()
    def _forward(self, batch: npt.NDArray[np.uint8]) -> tuple[torch.Tensor, torch.Tensor]:
        x = torch.from_numpy(batch).to(self.device, dtype=torch.float32)  # [B, w, w, 3] 0..255 RGB
        w = x.shape[1]
        if w != self.patch:
            x = F.interpolate(
                x.permute(0, 3, 1, 2), size=(self.patch, self.patch), mode="bilinear", align_corners=False
            )
            x = x.permute(0, 2, 3, 1).contiguous()
        masks, feats = self.net.infer_masks_and_img_features(x)  # [B, P, P, 2], [B, 256, P/16, P/16]
        if w != self.patch:
            masks = F.interpolate(masks.permute(0, 3, 1, 2), size=(w, w), mode="bilinear", align_corners=False)
            masks = masks.permute(0, 2, 3, 1)
        return masks, feats

    def predict_masks(
        self,
        image: npt.NDArray[np.uint8],
        valid: npt.NDArray[np.bool_],
        window: int | None = None,
        overlap: int = 128,
        batch_size: int = 16,
        blend: BlendMode = "cosine",
        min_valid_frac: float = 0.01,
    ) -> MaskPrediction:
        """Run the mask decoder over overlapping windows of ``image`` (``(H, W, 3)`` uint8 RGB)."""
        win = window or self.patch
        all_wins = generate_windows(valid.shape, win, overlap)
        wins = [w for w in all_wins if extract_window(valid, w, False).mean() >= min_valid_frac]
        stitcher = Stitcher((*valid.shape, 2), mode=blend)
        features: list[torch.Tensor] = []
        for i in range(0, len(wins), batch_size):
            chunk = wins[i : i + batch_size]
            batch = np.stack([extract_window(image, w, 0) for w in chunk]).astype(np.uint8)
            masks, feats = self._forward(batch)
            masks_np = masks.float().cpu().numpy()
            for j, w in enumerate(chunk):
                stitcher.add(masks_np[j], w)
            features.extend(feats.unbind(0))
        fused = stitcher.result().astype(np.float32)
        return MaskPrediction(keypoint=fused[..., 0], road=fused[..., 1], windows=wins, features=features)

    # ------------------------------------------------------------------ graph

    def graph_points(
        self, keypoint: npt.NDArray[np.floating], road: npt.NDArray[np.floating]
    ) -> npt.NDArray[np.float64]:
        """Upstream ``extract_graph_points`` on uint8-quantised masks -> ``(N, 2)`` xy."""
        import graph_extraction  # upstream module, on sys.path after build_model

        kp_u8 = (np.clip(keypoint, 0, 1) * 255).astype(np.uint8)
        road_u8 = (np.clip(road, 0, 1) * 255).astype(np.uint8)
        pts = graph_extraction.extract_graph_points(kp_u8, road_u8, self.config)
        return np.asarray(pts, dtype=np.float64).reshape(-1, 2)

    @torch.no_grad()
    def extract_graph(
        self,
        pred: MaskPrediction,
        keypoint: npt.NDArray[np.floating] | None = None,
        road: npt.NDArray[np.floating] | None = None,
        batch_size: int = 16,
    ) -> TopoGraph:
        """Graph vertices from the (optionally valid-masked) maps + TopoNet edges voted over windows."""
        kp = pred.keypoint if keypoint is None else keypoint
        rd = pred.road if road is None else road
        pts_xy = self.graph_points(kp, rd)
        empty = TopoGraph(pts_xy[:, ::-1].copy(), np.zeros((0, 2), np.int64), np.zeros(0), 0)
        if len(pts_xy) < 2:
            return empty
        k = int(self.config.MAX_NEIGHBOR_QUERIES)
        radius = float(self.config.NEIGHBOR_RADIUS)
        votes = EdgeVotes()
        n_pairs = 0
        for i in range(0, len(pred.windows), batch_size):
            wins = pred.windows[i : i + batch_size]
            queries: list[TopoQuery] = [build_query(pts_xy, w, self.patch, k, radius) for w in wins]
            keep = [j for j, q in enumerate(queries) if len(q.points) > 0]
            if not keep:
                continue
            queries = [queries[j] for j in keep]
            feats = torch.stack([pred.features[i + j] for j in keep])
            pts, pairs, valid = collate(queries, k)
            n_pairs += int(valid.sum())
            scores = self.net.infer_toponet(
                feats,
                torch.from_numpy(pts).to(self.device, dtype=torch.float32),
                torch.from_numpy(pairs).to(self.device),
                torch.from_numpy(valid).to(self.device),
            )
            scores = torch.nan_to_num(scores, nan=-100.0).squeeze(-1).float().cpu().numpy()
            for q, s in zip(queries, scores, strict=True):
                votes.add(q, s)
        edges, edge_scores = votes.result(float(self.config.TOPO_THRESHOLD))
        return TopoGraph(pts_xy[:, ::-1].copy(), edges, edge_scores, n_pairs)
