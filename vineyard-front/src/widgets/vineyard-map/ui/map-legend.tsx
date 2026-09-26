import type { FC } from "react";

import {
  FEATURE_COLORS,
  INTERROW_COVER_STYLE,
  INTERROW_COVERS,
  ROW_STRUCTURE_STYLE,
  ROW_STRUCTURES,
  type LayerVisibility,
} from "@/entities/survey";
import { cn } from "@/shared/lib/cn";

type SwatchShape = "line" | "area" | "dot" | "box";

type LegendItem = { label: string; color: string; shape: SwatchShape };

type LegendGroup = { title: string; items: LegendItem[] };

const SWATCH_CLASS = {
  line: "h-[3px] w-4 rounded-full",
  area: "size-3 rounded-[3px] opacity-80",
  dot: "size-2.5 rounded-full ring-2 ring-white",
  box: "size-3 rounded-[2px] border-2 bg-transparent",
} as const satisfies Record<SwatchShape, string>;

const buildGroups = (visibility: LayerVisibility, hasRequestedStart: boolean): LegendGroup[] => {
  const groups: LegendGroup[] = [];
  if (visibility.rows) {
    groups.push({
      title: "Row structure",
      items: ROW_STRUCTURES.map(value => {
        return { label: ROW_STRUCTURE_STYLE[value].label, color: ROW_STRUCTURE_STYLE[value].color, shape: "line" };
      }),
    });
  }
  if (visibility.interrows) {
    groups.push({
      title: "Inter-row cover",
      items: INTERROW_COVERS.map(value => {
        return { label: INTERROW_COVER_STYLE[value].label, color: INTERROW_COVER_STYLE[value].color, shape: "area" };
      }),
    });
  }

  const targets: LegendItem[] = [];
  if (visibility.canopy) targets.push({ label: "Canopy", color: FEATURE_COLORS.canopy, shape: "area" });
  if (visibility.route) targets.push({ label: "Walking route", color: FEATURE_COLORS.route, shape: "line" });
  if (visibility.route && hasRequestedStart) {
    targets.push({ label: "Your starting point", color: FEATURE_COLORS.route, shape: "dot" });
  }
  if (visibility["inspection-points"]) {
    targets.push({ label: "Missing vines", color: FEATURE_COLORS.inspectionPoint, shape: "dot" });
  }
  if (visibility.waste) targets.push({ label: "Waste", color: FEATURE_COLORS.waste, shape: "box" });
  if (targets.length > 0) groups.push({ title: "Features", items: targets });

  return groups;
};

type LegendSwatchProps = { item: LegendItem };

const LegendSwatch: FC<LegendSwatchProps> = ({ item }) => {
  const colorStyle = item.shape === "box" ? { borderColor: item.color } : { backgroundColor: item.color };
  return <span className={cn("shrink-0", SWATCH_CLASS[item.shape])} style={colorStyle} aria-hidden />;
};

type MapLegendProps = { visibility: LayerVisibility; hasRequestedStart: boolean };

export const MapLegend: FC<MapLegendProps> = ({ visibility, hasRequestedStart }) => {
  const groups = buildGroups(visibility, hasRequestedStart);
  if (groups.length === 0) return null;

  return (
    <aside
      aria-label="Map legend"
      className="bg-popover/92 pointer-events-auto grid max-w-56 gap-3 rounded-lg p-3 text-xs shadow-[0_1px_3px_rgb(29_36_32/0.18)] backdrop-blur-sm"
    >
      {groups.map(group => {
        return (
          <section key={group.title}>
            <h3 className="text-muted-foreground mb-1.5 font-medium">{group.title}</h3>
            <ul className="grid gap-1">
              {group.items.map(item => {
                return (
                  <li key={item.label} className="flex items-center gap-2">
                    <span className="grid w-4 place-items-center">
                      <LegendSwatch item={item} />
                    </span>
                    {item.label}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </aside>
  );
};
