import { useMemo } from "react";

import type { Role } from "@/entities/role";
import { summarizeSurvey, type Survey, type VineyardId } from "@/entities/survey";
import { formatCount, formatHectares, formatMetres } from "@/shared/lib/format";

export type VineyardFact = { label: string; value: string };

const routeLength = (route: Survey["routes"][keyof Survey["routes"]]) =>
  route ? formatMetres(route.properties.length_m) : "Being planned";

export const useVineyardFacts = (survey: Survey, role: Role) => {
  return useMemo(() => {
    const summary = summarizeSurvey(survey);
    const shared: VineyardFact[] = [
      { label: "Rows", value: formatCount(summary.rowCount) },
      { label: "Canopy", value: formatHectares(summary.canopyAreaM2) },
    ];
    const byRole: VineyardFact[] =
      role === "owner"
        ? [
            { label: "Waste items", value: formatCount(survey.waste.features.length) },
            {
              label: "Collection route",
              value: routeLength(survey.routes.waste_collection),
            },
          ]
        : [
            { label: "Row gaps", value: formatCount(survey.inspectionPoints.features.length) },
            { label: "Inspection route", value: routeLength(survey.routes.inspection) },
          ];

    const blocks: { vineyardId: VineyardId; rowCount: number }[] = summary.blocks.flatMap(block =>
      block.vineyardId === null ? [] : [{ vineyardId: block.vineyardId, rowCount: block.rowCount }],
    );
    return { facts: [...shared, ...byRole], blocks };
  }, [survey, role]);
};
