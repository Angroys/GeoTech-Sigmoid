import { useState, type FC } from "react";

import { cn } from "@/shared/lib/cn";

import { parcelFrameOf } from "../lib/parcel-frame";
import type { Parcel } from "../model/types";
import { ParcelOutline } from "./parcel-outline";

type ImageState = "loading" | "ready" | "failed";

type ParcelImageProps = {
  parcel: Parcel;
  imageUrlFor: ((bounds: [number, number, number, number]) => string | null) | null;
  className?: string;
};

export const ParcelImage: FC<ParcelImageProps> = ({ parcel, imageUrlFor, className }) => {
  const [imageState, setImageState] = useState<ImageState>("loading");
  const frame = parcelFrameOf(parcel.outline);
  const imageUrl = frame && imageUrlFor ? imageUrlFor(frame.bounds) : null;

  if (!frame || !imageUrl || imageState === "failed") {
    return <ParcelOutline outline={parcel.outline} {...(className ? { className } : {})} />;
  }

  return (
    <div className={cn("bg-muted relative overflow-hidden", className)}>
      <img
        src={imageUrl}
        alt={`Drone image of parcel ${parcel.cadastralNumber}`}
        decoding="async"
        onLoad={() => setImageState("ready")}
        onError={() => setImageState("failed")}
        className={cn(
          "size-full object-cover transition-opacity duration-200 motion-reduce:transition-none",
          imageState === "ready" ? "opacity-100" : "opacity-0",
        )}
      />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
        <polygon
          points={frame.outline}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.9}
          strokeWidth={3.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <polygon
          points={frame.outline}
          fill="none"
          className="stroke-primary"
          strokeWidth={1.75}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
};
