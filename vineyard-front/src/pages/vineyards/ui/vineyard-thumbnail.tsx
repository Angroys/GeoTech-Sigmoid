import type { FC } from "react";

import type { SurveySource } from "@/entities/survey";
import { AppLink } from "@/shared/ui";

type VineyardThumbnailProps = { source: SurveySource; href: string };

export const VineyardThumbnail: FC<VineyardThumbnailProps> = ({ source, href }) => {
  return (
    <AppLink
      href={href}
      tabIndex={-1}
      aria-hidden
      className="bg-muted block aspect-[16/9] overflow-hidden sm:aspect-auto sm:h-full sm:min-h-44"
    >
      {source.imagery ? (
        <img
          src={source.imagery.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ) : (
        <span className="text-muted-foreground grid size-full place-items-center bg-[repeating-linear-gradient(115deg,transparent_0_10px,rgb(51_87_63/0.08)_10px_12px)] text-xs">
          No aerial image
        </span>
      )}
    </AppLink>
  );
};
