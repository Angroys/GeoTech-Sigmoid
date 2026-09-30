"""SAM 3 (loaded through segment-geospatial's SamGeo3) with the finetune-SAM recipe: no prompt, one mask token per class, everything trainable.

mazurowski-lab/finetune-SAM turns SAM into a semantic segmenter by (1) calling the mask decoder
with an empty prompt, (2) building the decoder with ``num_multimask_outputs = num_classes`` so each
mask token predicts one class, and (3) for the "vanilla, update encoder" setup, training every
weight. This module applies the same three changes to SAM 3:

  image (1008 px, mean/std 0.5)
    -> SAM 3 ViT trunk (32 blocks, patch 14)           pretrained, trainable
    -> SAM 2-style neck (sam2_convs, strides 4/8/14 px) pretrained, trainable
    -> SAM 3 interactive mask decoder, empty prompt      pretrained, trainable
       with NUM_CLASSES mask tokens (new tokens start as copies of the pretrained ones)
    -> NUM_CLASSES logit maps at 288 px, upsampled to the input size

Output channels are independent (sigmoid): a pixel can be vineyard and row at once.
"""
from __future__ import annotations

import copy

import torch
import torch.nn.functional as F
from torch import nn

CLASSES = ("vineyard", "plant_edge", "row", "interrow_area", "waste", "dead_vine")
IMG_SIZE = 1008
MEAN = STD = 0.5


def _trainable_mlp(self, x):
    """SAM 3's ViT MLP uses a fused inference-only kernel (detached weights, raises under grad)."""
    return self.drop2(self.fc2(self.norm(self.drop1(self.act(self.fc1(x))))))


def _expand_decoder(dec, n):
    """Copy of `dec` with n multimask tokens; token/hypernetwork i starts from pretrained 1 + (i % 3)."""
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


class Sam3Seg(nn.Module):
    def __init__(self, checkpoint=None, num_classes=len(CLASSES), act_ckpt=False):
        super().__init__()
        from sam3.model import vitdet
        from samgeo import SamGeo3
        vitdet.Mlp.forward = _trainable_mlp
        geo = SamGeo3(backend="meta", checkpoint_path=checkpoint, load_from_HF=checkpoint is None, device="cpu",
                      eval_mode=False, enable_inst_interactivity=True)
        full = geo.model
        tracker = full.inst_interactive_predictor.model
        self.vision = full.backbone.vision_backbone           # ViT trunk + sam3/sam2 necks
        self.vision.convs = None                              # detector neck is unused here
        # The trunk's own activation checkpointing fails its recompute check after an eval pass
        # (cached tensors change between forward and recompute); memory is plentiful without it.
        self.vision.trunk.use_act_checkpoint = False
        for blk in self.vision.trunk.blocks:                  # no stochastic depth: with it the loss
            blk.drop_path = nn.Identity()                     # after one epoch was 1.68 vs 0.96 without
        self.prompt_encoder = tracker.sam_prompt_encoder
        self.mask_decoder = _expand_decoder(tracker.sam_mask_decoder, num_classes)
        self.no_mem_embed = nn.Parameter(tracker.no_mem_embed.detach().clone())
        self.num_classes = num_classes
        self.act_ckpt = act_ckpt
        del full, tracker, geo

    def load_trained(self, state_dict):
        """Load fine-tuned weights so inference reproduces the training-time model.

        One forward pass must run before the weights are loaded: a model that loads first and
        runs afterwards gives different patch-embedding outputs from the same weights (seen on
        SAM 3 via samgeo; cause not located) and its predictions are garbage. Training always
        runs forward before anything else, so this matches what training measured.
        """
        dev = next(self.parameters()).device
        with torch.no_grad():
            self.eval()(torch.zeros(1, 3, IMG_SIZE, IMG_SIZE, device=dev))
        self.load_state_dict({k: v.float() if v.is_floating_point() else v for k, v in state_dict.items()})
        return self

    def _neck(self, x):
        xs = self.vision.trunk(x)
        feats = [conv(xs[-1]) for conv in self.vision.sam2_convs[:3]]   # strides 4, 8, 14 px of the ViT grid
        return feats

    def forward(self, x):
        if self.act_ckpt and self.training:
            feats = torch.utils.checkpoint.checkpoint(self._neck, x, use_reentrant=False)
        else:
            feats = self._neck(x)
        s0, s1, emb = feats
        b = x.shape[0]
        emb = emb + self.no_mem_embed.view(1, -1, 1, 1)
        hi = [self.mask_decoder.conv_s0(s0), self.mask_decoder.conv_s1(s1)]
        pts = torch.zeros(b, 1, 2, device=x.device)
        lbl = -torch.ones(b, 1, dtype=torch.int32, device=x.device)
        sparse, dense = self.prompt_encoder(points=(pts, lbl), boxes=None, masks=None)
        masks, _, _, _ = self.mask_decoder(
            image_embeddings=emb, image_pe=self.prompt_encoder.get_dense_pe(),
            sparse_prompt_embeddings=sparse, dense_prompt_embeddings=dense,
            multimask_output=True, repeat_image=False, high_res_features=hi)
        return F.interpolate(masks.float(), size=x.shape[-2:], mode="bilinear", align_corners=False)
