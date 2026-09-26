import type { CSSProperties, FC } from "react";

import { cn } from "@/shared/lib/cn";

import type { LayerKey, SwatchShape } from "../config/layer-keys";

const SHAPE_CLASS = {
  line: "h-[3px] w-4 rounded-full ring-1 ring-foreground/15",
  "dashed-outline": "size-3 rounded-[2px] border-[1.5px] border-dashed bg-transparent",
  area: "size-3 rounded-[3px] ring-1 ring-foreground/10",
  dot: "size-2.5 rounded-full ring-2 ring-white",
  ring: "size-2.5 rounded-full border-[2.5px] bg-white",
  box: "size-3 rounded-[2px] border-2 bg-transparent",
} as const satisfies Record<SwatchShape, string>;

const colorStyle = ({ shape, color }: Omit<LayerKey, "label">): CSSProperties => {
  if (shape === "dashed-outline" || shape === "box" || shape === "ring") return { borderColor: color };
  return { backgroundColor: color };
};

type LayerSwatchProps = { swatch: Omit<LayerKey, "label"> };

export const LayerSwatch: FC<LayerSwatchProps> = ({ swatch }) => {
  return (
    <span className="grid w-4 shrink-0 place-items-center" aria-hidden>
      <span className={cn("block", SHAPE_CLASS[swatch.shape])} style={colorStyle(swatch)} />
    </span>
  );
};
