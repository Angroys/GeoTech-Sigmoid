import { CircleAlert, CircleCheck, Route } from "lucide-react";
import type { FC } from "react";

import { formatMetres } from "@/shared/lib/format";
import { isReadCoordinates, type CoordinateReading } from "@/shared/lib/geo";
import { CoordinateReadBack, FormField, Input } from "@/shared/ui";

import { START_TOLERANCE_M } from "../model/start-point";

const RADIO_CLASS = "accent-primary size-4";

export type RouteCheck = { kind: "server-plans" } | { kind: "waiting-for-files" } | { kind: "offset"; metres: number };

type RoutePlanNoteProps = { check: RouteCheck };

const RoutePlanNote: FC<RoutePlanNoteProps> = ({ check }) => {
  if (check.kind === "waiting-for-files") {
    return (
      <p className="text-muted-foreground flex gap-2 text-sm">
        <Route className="mt-0.5 size-4 shrink-0" aria-hidden />
        The uploaded routes are checked against this point once all the survey files are valid.
      </p>
    );
  }
  if (check.kind === "server-plans") {
    return (
      <p className="text-muted-foreground flex gap-2 text-sm">
        <Route className="mt-0.5 size-4 shrink-0" aria-hidden />
        The server plans the inspection and waste collection routes from this point after you add the vineyard.
      </p>
    );
  }
  if (check.metres <= START_TOLERANCE_M) {
    return (
      <p className="text-primary flex gap-2 text-sm">
        <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        The uploaded routes begin and end within {START_TOLERANCE_M} m of this point.
      </p>
    );
  }
  return (
    <p className="flex gap-2 text-sm">
      <CircleAlert className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        The uploaded routes begin or end up to {formatMetres(check.metres)} from this point, and the rules allow{" "}
        {START_TOLERANCE_M} m. Remove the route files to have the server plan them from here.
      </span>
    </p>
  );
};

type StartPointFieldProps = {
  isPasted: boolean;
  text: string;
  error: string | undefined;
  read: CoordinateReading;
  routeCheck: RouteCheck;
  onSourceChange: (source: "file" | "pasted") => void;
  onTextChange: (text: string) => void;
};

export const StartPointField: FC<StartPointFieldProps> = ({
  isPasted,
  text,
  error,
  read,
  routeCheck,
  onSourceChange,
  onTextChange,
}) => {
  return (
    <fieldset className="grid gap-4">
      <legend className="mb-1 text-[0.9375rem] font-semibold">Route start</legend>
      <p className="text-muted-foreground -mt-2 text-sm leading-relaxed">
        The starting point the organisers supply. Both walking routes begin and end here.
      </p>

      <div className="grid gap-2">
        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="radio"
            name="startSource"
            value="pasted"
            checked={isPasted}
            onChange={() => onSourceChange("pasted")}
            className={RADIO_CLASS}
          />
          Paste the coordinates
        </label>
        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="radio"
            name="startSource"
            value="file"
            checked={!isPasted}
            onChange={() => onSourceChange("file")}
            className={RADIO_CLASS}
          />
          Use start.geojson from the survey files
        </label>
      </div>

      {isPasted && (
        <div className="grid gap-3">
          <FormField
            label="Starting point"
            hint="Latitude and longitude as a map app copies them, or easting and northing in EPSG:32635."
            error={error}
          >
            {control => {
              return (
                <Input
                  {...control}
                  name="startText"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="47.12305, 28.70734"
                  className="h-12 text-base tabular-nums md:text-base"
                  value={text}
                  onChange={event => onTextChange(event.target.value)}
                />
              );
            }}
          </FormField>
          <div aria-live="polite" className="grid gap-2">
            {!error && <CoordinateReadBack reading={read} />}
            {isReadCoordinates(read) && <RoutePlanNote check={routeCheck} />}
          </div>
        </div>
      )}
    </fieldset>
  );
};
