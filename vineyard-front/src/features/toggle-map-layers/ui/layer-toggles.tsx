import type { FC } from "react";

import {
  FEATURE_COLORS,
  INTERROW_COVER_STYLE,
  ROW_STRUCTURE_STYLE,
  SURVEY_LAYERS,
  type LayerVisibility,
  type SurveyLayerId,
} from "@/entities/survey";
import { cn } from "@/shared/lib/cn";

import type { AllLayersState } from "../model/use-layer-visibility";

const LAYER_SWATCH = {
  blocks: "transparent",
  interrows: INTERROW_COVER_STYLE.bare_soil.color,
  canopy: FEATURE_COLORS.canopy,
  rows: ROW_STRUCTURE_STYLE.disrupted.color,
  route: FEATURE_COLORS.route,
  waste: FEATURE_COLORS.waste,
  "inspection-points": FEATURE_COLORS.inspectionPoint,
} as const satisfies Record<SurveyLayerId, string>;

const ROW_CLASS = "hover:bg-muted flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm";
const CHECKBOX_CLASS = "accent-primary size-4 shrink-0";

type AllLayersToggleProps = {
  state: AllLayersState;
  onToggle: () => void;
};

const AllLayersToggle: FC<AllLayersToggleProps> = ({ state, onToggle }) => {
  const syncMixedState = (input: HTMLInputElement | null) => {
    if (input) input.indeterminate = state === "some";
  };

  return (
    <label className={cn(ROW_CLASS, "font-medium")}>
      <input
        ref={syncMixedState}
        type="checkbox"
        checked={state === "all"}
        onChange={onToggle}
        className={CHECKBOX_CLASS}
      />
      <span>All layers</span>
    </label>
  );
};

type LayerTogglesProps = {
  visibility: LayerVisibility;
  allLayers: AllLayersState;
  onToggle: (layerId: SurveyLayerId) => void;
  onToggleAll: () => void;
};

export const LayerToggles: FC<LayerTogglesProps> = ({ visibility, allLayers, onToggle, onToggleAll }) => {
  return (
    <fieldset>
      <legend className="sr-only">Map layers</legend>
      <AllLayersToggle state={allLayers} onToggle={onToggleAll} />
      <ul className="border-border mt-1 grid gap-0.5 border-t pt-1">
        {SURVEY_LAYERS.map(layer => {
          return (
            <li key={layer.id}>
              <label className={ROW_CLASS}>
                <input
                  type="checkbox"
                  checked={visibility[layer.id]}
                  onChange={() => onToggle(layer.id)}
                  className={CHECKBOX_CLASS}
                />
                <span
                  className="border-foreground/25 size-3 shrink-0 rounded-[3px] border"
                  style={{ backgroundColor: LAYER_SWATCH[layer.id] }}
                  aria-hidden
                />
                <span>{layer.label}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
};
