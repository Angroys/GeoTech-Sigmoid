import type { Feature, Polygon } from "geojson";
import { ImageOff, LoaderCircle, X } from "lucide-react";
import { useState, type FC } from "react";

import { FEATURE_COLORS, imageryCropUrl, type SurveyImagery, type WasteProperties } from "@/entities/survey";
import { cn } from "@/shared/lib/cn";
import { formatMetres } from "@/shared/lib/format";

import { loupeFrameOf } from "../lib/loupe-frame";

const IMAGE_PX = 384;

type ImageState = "loading" | "ready" | "failed";

type WasteLoupeProps = {
  waste: Feature<Polygon, WasteProperties>;
  imagery: SurveyImagery;
  onClose: () => void;
};

export const WasteLoupe: FC<WasteLoupeProps> = ({ waste, imagery, onClose }) => {
  const [imageState, setImageState] = useState<ImageState>("loading");
  const frame = loupeFrameOf(waste.geometry);
  const src = frame ? imageryCropUrl(imagery, frame.bounds, IMAGE_PX) : null;
  if (!frame || !src) return null;

  const { waste_id: wasteId, vineyard_id: vineyardId } = waste.properties;

  return (
    <figure className="bg-popover/95 w-36 overflow-hidden rounded-lg text-xs shadow-[0_1px_3px_rgb(29_36_32/0.18)] backdrop-blur-sm sm:w-48">
      <div className="bg-muted relative aspect-square">
        <img
          key={src}
          src={src}
          alt={`Aerial close-up of waste ${wasteId}`}
          decoding="async"
          onLoad={() => setImageState("ready")}
          onError={() => setImageState("failed")}
          className={cn(
            "size-full object-cover transition-opacity duration-200 motion-reduce:transition-none",
            imageState === "ready" ? "opacity-100" : "opacity-0",
          )}
        />
        {imageState === "ready" && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
            <polygon
              points={frame.outline}
              fill="none"
              stroke="#ffffff"
              strokeOpacity={0.85}
              strokeWidth={4}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <polygon
              points={frame.outline}
              fill="none"
              stroke={FEATURE_COLORS.waste}
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
        {imageState === "loading" && (
          <LoaderCircle
            className="text-muted-foreground absolute inset-0 m-auto size-5 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
        )}
        {imageState === "failed" && (
          <span className="text-muted-foreground absolute inset-0 grid place-content-center justify-items-center gap-1 p-3 text-center">
            <ImageOff className="size-5" aria-hidden />
            Close-up unavailable
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide the close-up"
          className="bg-popover/90 text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-md outline-none focus-visible:ring-[3px]"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <figcaption className="flex items-baseline justify-between gap-2 px-2.5 py-2">
        <span className="min-w-0 truncate">
          <span className="font-semibold tabular-nums">{wasteId}</span>
          <span className="text-muted-foreground"> {vineyardId ? `block ${vineyardId}` : "outside blocks"}</span>
        </span>
        <span className="text-muted-foreground shrink-0 tabular-nums">{formatMetres(frame.spanM)} wide</span>
      </figcaption>
    </figure>
  );
};
