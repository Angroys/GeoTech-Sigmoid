import { useMemo } from "react";

import {
  INTERROW_COVERS,
  type InterrowCover,
  type InterrowProperties,
  type Survey,
} from "@/entities/survey";

export type InterrowGroup = {
  vineyardId: string;
  interrows: InterrowProperties[];
  areaM2: number;
  averageWidthM: number;
  coverCounts: Record<InterrowCover, number>;
};

const countCovers = (interrows: InterrowProperties[]): Record<InterrowCover, number> => {
  const counts: Record<InterrowCover, number> = { bare_soil: 0, vegetation: 0, mixed: 0, unassessable: 0 };
  for (const { interrow_cover: cover } of interrows) counts[cover] += 1;
  return counts;
};

export const useInterrowGroups = (survey: Survey, visibleCovers: ReadonlySet<InterrowCover>) => {
  const byBlock = useMemo(() => {
    const groups = new Map<string, InterrowProperties[]>();
    for (const { properties } of survey.interrows.features) {
      const key = properties.vineyard_id ?? "unassigned";
      groups.set(key, [...(groups.get(key) ?? []), properties]);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  }, [survey]);

  const coverCounts = useMemo(() => {
    const counts = countCovers(survey.interrows.features.map(({ properties }) => properties));
    return INTERROW_COVERS.map(cover => {
      return { cover, count: counts[cover] };
    });
  }, [survey]);

  const groups = useMemo(() => {
    return byBlock
      .map(([vineyardId, interrows]): InterrowGroup => {
        const visible = interrows.filter(interrow => visibleCovers.has(interrow.interrow_cover));
        return {
          vineyardId,
          interrows: visible,
          areaM2: visible.reduce((total, interrow) => total + interrow.area_m2, 0),
          averageWidthM: visible.reduce((total, interrow) => total + interrow.width_m, 0) / Math.max(1, visible.length),
          coverCounts: countCovers(visible),
        };
      })
      .filter(group => group.interrows.length > 0);
  }, [byBlock, visibleCovers]);

  return { groups, coverCounts };
};
