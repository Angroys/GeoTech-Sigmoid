import type { Position } from "geojson";
import { CircleAlert, LoaderCircle, LocateFixed } from "lucide-react";
import type { FC } from "react";

import { formatMetres } from "@/shared/lib/format";
import { Button, CoordinateReadBack, FormField, Input } from "@/shared/ui";

import { FAR_FROM_VINEYARD_M } from "../model/distance-from-start";
import type { LocationStatus } from "../model/use-current-location";
import { useStartDraft } from "../model/use-start-draft";

type LocationNoteProps = { status: LocationStatus };

const LocationNote: FC<LocationNoteProps> = ({ status }) => {
  switch (status.kind) {
    case "idle":
    case "locating":
      return null;
    case "found":
      return (
        <p className="text-muted-foreground text-sm">
          Filled in from your device, accurate to about {formatMetres(status.accuracyM)}.
        </p>
      );
    case "failed":
      return <p className="text-destructive text-sm">{status.message}</p>;
  }
};

type FarNoteProps = { distanceM: number | null };

const FarNote: FC<FarNoteProps> = ({ distanceM }) => {
  if (distanceM === null || distanceM <= FAR_FROM_VINEYARD_M) return null;
  return (
    <p className="flex gap-2 text-sm">
      <CircleAlert className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
      This point is {formatMetres(distanceM)} from the vineyard. Check the numbers before planning from it.
    </p>
  );
};

type RouteStartFormProps = {
  vineyardStart: Position;
  onPlan: (lngLat: Position) => void;
  onCancel: () => void;
};

export const RouteStartForm: FC<RouteStartFormProps> = ({ vineyardStart, onPlan, onCancel }) => {
  const draft = useStartDraft(vineyardStart, onPlan);
  const isLocating = draft.location.status.kind === "locating";

  return (
    <form noValidate onSubmit={draft.submit} className="grid gap-3">
      <FormField
        label="Where you start"
        hint="Latitude and longitude as a map app copies them, or easting and northing in EPSG:32635."
        error={draft.error}
      >
        {control => {
          return (
            <Input
              {...control}
              autoFocus
              name="routeStart"
              autoComplete="off"
              spellCheck={false}
              placeholder="47.12305, 28.70734"
              className="h-11 text-base tabular-nums md:text-base"
              value={draft.text}
              onChange={event => draft.changeText(event.target.value)}
            />
          );
        }}
      </FormField>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        disabled={isLocating}
        onClick={draft.location.locate}
      >
        {isLocating ? (
          <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <LocateFixed aria-hidden />
        )}
        {isLocating ? "Finding your location" : "Use my location"}
      </Button>

      <div aria-live="polite" className="grid gap-2 empty:hidden">
        <LocationNote status={draft.location.status} />
        {!draft.error && <CoordinateReadBack reading={draft.reading} />}
        <FarNote distanceM={draft.distanceM} />
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" size="sm">
          Plan from here
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
};
