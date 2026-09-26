import { ChevronDown, Layers } from "lucide-react";
import { useId, useState, type FC } from "react";

import { SURVEY_LAYERS, type LayerVisibility, type SurveyLayerId } from "@/entities/survey";
import { cn } from "@/shared/lib/cn";

import { LAYER_SWATCH, layerKeys } from "../config/layer-keys";
import type { AllLayersState } from "../model/use-layer-visibility";
import { LayerSwatch } from "./layer-swatch";

const WIDE_SCREEN = "(min-width: 768px)";
const ROW_CLASS = "hover:bg-muted flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5";
const CHECKBOX_CLASS = "accent-primary size-3.5 shrink-0";

const startsOpen = () => {
  try {
    return window.matchMedia(WIDE_SCREEN).matches;
  } catch {
    return true;
  }
};

type AllLayersToggleProps = { state: AllLayersState; onToggle: () => void };

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
      All layers
    </label>
  );
};

type LayerRowProps = {
  layerId: SurveyLayerId;
  label: string;
  isVisible: boolean;
  hasRequestedStart: boolean;
  onToggle: (layerId: SurveyLayerId) => void;
};

const LayerRow: FC<LayerRowProps> = ({ layerId, label, isVisible, hasRequestedStart, onToggle }) => {
  const keys = isVisible ? layerKeys(layerId, hasRequestedStart) : [];

  return (
    <li>
      <label className={ROW_CLASS}>
        <input type="checkbox" checked={isVisible} onChange={() => onToggle(layerId)} className={CHECKBOX_CLASS} />
        <LayerSwatch swatch={LAYER_SWATCH[layerId]} />
        <span className={cn(!isVisible && "text-muted-foreground")}>{label}</span>
      </label>
      {keys.length > 0 && (
        <ul className="text-muted-foreground grid gap-1 pt-0.5 pb-1.5 pl-[3.25rem]">
          {keys.map(key => {
            return (
              <li key={key.label} className="flex items-center gap-2">
                <LayerSwatch swatch={key} />
                {key.label}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
};

type MapLayersControlProps = {
  visibility: LayerVisibility;
  allLayers: AllLayersState;
  hasRequestedStart: boolean;
  onToggle: (layerId: SurveyLayerId) => void;
  onToggleAll: () => void;
};

export const MapLayersControl: FC<MapLayersControlProps> = ({
  visibility,
  allLayers,
  hasRequestedStart,
  onToggle,
  onToggleAll,
}) => {
  const [isOpen, setIsOpen] = useState(startsOpen);
  const panelId = useId();
  const visibleCount = SURVEY_LAYERS.filter(({ id }) => visibility[id]).length;

  return (
    <div
      className={cn(
        "bg-popover/95 flex max-h-full min-h-0 flex-col overflow-hidden rounded-lg text-xs shadow-[0_1px_3px_rgb(29_36_32/0.18)] backdrop-blur-sm",
        isOpen && "w-60",
      )}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen(open => !open)}
        className="hover:bg-muted/60 focus-visible:ring-ring/50 flex shrink-0 items-center gap-2 px-3 py-2.5 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
      >
        <Layers className="text-muted-foreground size-4" aria-hidden />
        <span className="text-sm font-semibold">Layers</span>
        <span className="text-muted-foreground ml-auto pl-2 tabular-nums">
          {visibleCount} of {SURVEY_LAYERS.length}
        </span>
        <ChevronDown
          className={cn(
            "text-muted-foreground size-4 transition-transform duration-150 motion-reduce:transition-none",
            isOpen && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {isOpen && (
        <fieldset
          id={panelId}
          className="border-border min-h-0 overflow-y-auto overscroll-contain border-t p-1.5"
        >
          <legend className="sr-only">Map layers</legend>
          <AllLayersToggle state={allLayers} onToggle={onToggleAll} />
          <ul className="border-border mt-1 grid gap-0.5 border-t pt-1">
            {SURVEY_LAYERS.map(layer => {
              return (
                <LayerRow
                  key={layer.id}
                  layerId={layer.id}
                  label={layer.label}
                  isVisible={visibility[layer.id]}
                  hasRequestedStart={hasRequestedStart}
                  onToggle={onToggle}
                />
              );
            })}
          </ul>
        </fieldset>
      )}
    </div>
  );
};
