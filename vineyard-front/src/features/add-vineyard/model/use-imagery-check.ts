import { useCallback, useState } from "react";

import { ImageryCheckError, inspectImagery, type LngLatBounds } from "@/entities/survey";
import { ApiError } from "@/shared/api";

export type ImageryCheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "found"; url: string; bounds: LngLatBounds }
  | { kind: "failed"; url: string; message: string };

export const useImageryCheck = () => {
  const [state, setState] = useState<ImageryCheckState>({ kind: "idle" });

  const check = useCallback(async (url: string): Promise<LngLatBounds> => {
    setState({ kind: "checking" });
    try {
      const bounds = await inspectImagery(url);
      setState({ kind: "found", url, bounds });
      return bounds;
    } catch (error) {
      const message = error instanceof ImageryCheckError ? error.message : "The image could not be checked.";
      setState({ kind: "failed", url, message });
      throw new ApiError(message);
    }
  }, []);

  const ensure = useCallback(
    async (url: string) => (state.kind === "found" && state.url === url ? state.bounds : check(url)),
    [state, check],
  );

  const reset = useCallback(() => setState({ kind: "idle" }), []);

  return { state, check, ensure, reset };
};
