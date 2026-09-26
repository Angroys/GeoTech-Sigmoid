import type { Position } from "geojson";
import { useCallback, useMemo, useState, type FormEvent } from "react";

import { isReadCoordinates, readCoordinates, type CoordinateReading } from "@/shared/lib/geo";

import { distanceBetweenM } from "./distance-from-start";
import { useCurrentLocation, type FoundLocation } from "./use-current-location";

const COORDINATE_DIGITS = 6;

const draftError = (reading: CoordinateReading, wasSubmitted: boolean) => {
  if (reading.kind === "invalid") return reading.message;
  if (reading.kind === "empty" && wasSubmitted) {
    return "Paste the coordinates of your starting point, or use your location.";
  }
  return undefined;
};

export const useStartDraft = (vineyardStart: Position, onPlan: (lngLat: Position) => void) => {
  const [text, setText] = useState("");
  const [wasSubmitted, setWasSubmitted] = useState(false);

  const fillFromLocation = useCallback(({ latitude, longitude }: FoundLocation) => {
    setText(`${latitude.toFixed(COORDINATE_DIGITS)}, ${longitude.toFixed(COORDINATE_DIGITS)}`);
  }, []);
  const location = useCurrentLocation(fillFromLocation);

  const reading = useMemo(() => readCoordinates(text), [text]);
  const distanceM = isReadCoordinates(reading) ? distanceBetweenM(reading.lngLat, vineyardStart) : null;

  const error = draftError(reading, wasSubmitted);

  const changeText = (next: string) => {
    setText(next);
    location.forget();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWasSubmitted(true);
    if (isReadCoordinates(reading)) onPlan(reading.lngLat);
  };

  return { text, changeText, reading, distanceM, error, location, submit };
};
