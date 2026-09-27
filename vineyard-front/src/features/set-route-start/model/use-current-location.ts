import { useCallback, useState } from "react";

export type LocationStatus =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "found"; accuracyM: number }
  | { kind: "failed"; message: string };

export type FoundLocation = { latitude: number; longitude: number };

const failureMessage = (error: GeolocationPositionError) => {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location access is blocked for this site. Allow it in the browser, or paste the coordinates.";
  }
  if (error.code === error.TIMEOUT) return "Finding your location took too long. Try again, or paste the coordinates.";
  return "Your location could not be found. Paste the coordinates instead.";
};

export const useCurrentLocation = (onFound: (location: FoundLocation) => void) => {
  const [status, setStatus] = useState<LocationStatus>({ kind: "idle" });

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus({ kind: "failed", message: "This browser cannot share its location. Paste the coordinates instead." });
      return;
    }
    setStatus({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        onFound({ latitude: coords.latitude, longitude: coords.longitude });
        setStatus({ kind: "found", accuracyM: coords.accuracy });
      },
      error => setStatus({ kind: "failed", message: failureMessage(error) }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }, [onFound]);

  const forget = useCallback(() => setStatus({ kind: "idle" }), []);

  return { status, locate, forget };
};
