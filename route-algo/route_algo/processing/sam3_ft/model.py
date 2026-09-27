"""SAM 3 semantic segmenter matching the run3c checkpoint (finetune-SAM recipe).

Vendored from gs://marcaj-sam3-ajai-0957394607/code/ft/model.py. Deviation: the base modules are
built directly with ``sam3.model_builder`` (vision backbone + tracker prompt encoder / mask decoder)
instead of through segment-geospatial's ``SamGeo3``.

IMPORTANT - why the base SAM 3 weights (sam3.pt) are still needed ("effective" weights):
``sam3.model_builder.build_tracker`` enters a process-wide ``torch.autocast(bfloat16)`` that is never
exited, so autocast's weight-cast cache is never cleared. During training and upstream inference the
first forward ran with the *base* sam3.pt weights, and every Linear/Conv/ConvTranspose weight+bias
kept being computed from those cached bf16 base casts - the fine-tuned values of those tensors were
never used. Embeddings (incl. the per-class mask tokens), norms, no_mem_embed and positional/prompt
parameters DID use the fine-tuned values. That is the
"forward must run before load" quirk the upstream docstring describes. ``bake_effective`` rebuilds
exactly the weights the model effectively ran with; loading those with ``requires_grad=False`` (no
autocast caching) reproduces the run3c outputs deterministically and thread-safely (verified on
siret3_r005_c004: canopy IoU 0.955, inter-row IoU 0.99 vs the precomputed run3c labels).

  image (1008 px, mean/std 0.5) -> SAM 3 ViT trunk -> SAM 2-style neck (sam2_convs)
    -> SAM 3 interactive mask decoder, empty prompt, one mask token per class
    -> NUM_CLASSES logit maps upsampled to the input size (independent sigmoids)
"""

from __future__ import annotations

import copy

import torch
import torch.nn.functional as F
from torch import nn

__all__ = ["CLASSES", "EFFECTIVE_MARKER", "IMG_SIZE", "MEAN", "STD", "Sam3Seg", "bake_effective", "load_base_state"]

CLASSES = ("vineyard", "plant_edge", "row", "interrow_area", "waste", "dead_vine")
IMG_SIZE = 1008
MEAN = STD = 0.5


def _trainable_mlp(self, x):  # type: ignore[no-untyped-def]
    """SAM 3's ViT MLP uses a fused inference-only kernel; training (and thus the checkpoint) used this."""
    return self.drop2(self.fc2(self.norm(self.drop1(self.act(self.fc1(x))))))


def _expand_decoder(dec: nn.Module, n: int) -> nn.Module:
    """Copy of `dec` with n multimask tokens (weights are overwritten by the checkpoint anyway)."""
    new = copy.deepcopy(dec)
    old_n = dec.num_mask_tokens
    new.num_multimask_outputs = n
    new.num_mask_tokens = n + 1
    w = dec.mask_tokens.weight.data
    new.mask_tokens = nn.Embedding(n + 1, w.shape[1])
    src = [0] + [1 + i % (old_n - 1) for i in range(n)]
    new.mask_tokens.weight.data.copy_(w[src])
    new.output_hypernetworks_mlps = nn.ModuleList(copy.deepcopy(dec.output_hypernetworks_mlps[j]) for j in src)
    iou = dec.iou_prediction_head.layers[-1]
    last = nn.Linear(iou.in_features, n + 1)
    last.weight.data.copy_(iou.weight.data[src])
    last.bias.data.copy_(iou.bias.data[src])
    new.iou_prediction_head.layers[-1] = last
    return new


# Modules whose fine-tuned weights were really used (not served from the stale autocast cache).
# (The IoU / object-score heads do not influence the masks; they keep the fine-tuned values.)
_FRESH_PREFIXES = ("mask_decoder.iou_prediction_head.", "mask_decoder.pred_obj_score_head.")
EFFECTIVE_MARKER = "__sam3ft_effective__"


def load_base_state(path: str) -> dict[str, dict[str, torch.Tensor]]:
    """sam3.pt -> {"vision": ..., "tracker": ...} state dicts for the modules Sam3Seg uses."""
    ck = torch.load(path, map_location="cpu", weights_only=True)
    if "model" in ck and isinstance(ck["model"], dict):
        ck = ck["model"]
    vp, tp = "detector.backbone.vision_backbone.", "tracker."
    return {
        "vision": {k[len(vp) :]: v for k, v in ck.items() if k.startswith(vp)},
        "tracker": {k[len(tp) :]: v for k, v in ck.items() if k.startswith(tp)},
    }


class Sam3Seg(nn.Module):
    def __init__(self, num_classes: int = len(CLASSES), base: dict[str, dict[str, torch.Tensor]] | None = None) -> None:
        super().__init__()
        from sam3.model import vitdet
        from sam3.model_builder import _create_vision_backbone, build_tracker

        vitdet.Mlp.forward = _trainable_mlp
        tracker = build_tracker(apply_temporal_disambiguation=False)
        # build_tracker enters a never-exited bf16 autocast in this thread; leave it again so the
        # caller's thread state is untouched (predict_tile opens its own autocast per call).
        ctx = getattr(tracker, "bf16_context", None)
        if ctx is not None:
            ctx.__exit__(None, None, None)
        self.vision = _create_vision_backbone(enable_inst_interactivity=True)
        if base is not None:
            self.vision.load_state_dict(base["vision"], strict=False)
            tracker.load_state_dict(base["tracker"], strict=False)
        self.vision.convs = None  # detector neck is unused
        self.vision.trunk.use_act_checkpoint = False
        for blk in self.vision.trunk.blocks:
            blk.drop_path = nn.Identity()
        self.prompt_encoder = tracker.sam_prompt_encoder
        self.mask_decoder = _expand_decoder(tracker.sam_mask_decoder, num_classes)
        self.no_mem_embed = nn.Parameter(tracker.no_mem_embed.detach().clone())
        self.num_classes = num_classes
        del tracker

    def load_effective(self, state_dict: dict[str, torch.Tensor]) -> Sam3Seg:
        """Load baked effective weights and freeze them (requires_grad=False disables autocast's
        weight cache, so every call casts the loaded weights)."""
        sd = {k: v.float() if v.is_floating_point() else v for k, v in state_dict.items() if k != EFFECTIVE_MARKER}
        self.load_state_dict(sd)
        self.requires_grad_(False)
        return self.eval()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        xs = self.vision.trunk(x)
        s0, s1, emb = (conv(xs[-1]) for conv in self.vision.sam2_convs[:3])
        b = x.shape[0]
        emb = emb + self.no_mem_embed.view(1, -1, 1, 1)
        hi = [self.mask_decoder.conv_s0(s0), self.mask_decoder.conv_s1(s1)]
        pts = torch.zeros(b, 1, 2, device=x.device)
        lbl = -torch.ones(b, 1, dtype=torch.int32, device=x.device)
        sparse, dense = self.prompt_encoder(points=(pts, lbl), boxes=None, masks=None)
        masks, _, _, _ = self.mask_decoder(
            image_embeddings=emb,
            image_pe=self.prompt_encoder.get_dense_pe(),
            sparse_prompt_embeddings=sparse,
            dense_prompt_embeddings=dense,
            multimask_output=True,
            repeat_image=False,
            high_res_features=hi,
        )
        return F.interpolate(masks.float(), size=x.shape[-2:], mode="bilinear", align_corners=False)


def bake_effective(ft_state: dict[str, torch.Tensor], base_path: str) -> dict[str, torch.Tensor]:
    """Fine-tuned run3c state + base sam3.pt -> the weights the model effectively ran with."""
    base_model = Sam3Seg(base=load_base_state(base_path))
    base_sd = base_model.state_dict()
    eff = {k: (v.float() if v.is_floating_point() else v) for k, v in ft_state.items()}
    for name, mod in base_model.named_modules():
        if not isinstance(mod, (nn.Linear, nn.Conv2d, nn.ConvTranspose2d)):
            continue
        if any(f"{name}.".startswith(p) for p in _FRESH_PREFIXES):
            continue
        for pname, p in mod.named_parameters(recurse=False):
            if p is not None:
                eff[f"{name}.{pname}"] = base_sd[f"{name}.{pname}"].float().clone()
    del base_model, base_sd
    eff[EFFECTIVE_MARKER] = torch.ones(1)
    return eff
