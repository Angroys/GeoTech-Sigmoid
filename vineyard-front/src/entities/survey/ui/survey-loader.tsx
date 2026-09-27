import { CircleAlert, Hourglass, LoaderCircle } from "lucide-react";
import type { FC, ReactNode } from "react";

import { formatQuantity } from "@/shared/lib/format";
import { assertNever } from "@/shared/lib/types";
import { AppLink } from "@/shared/ui";

import type { Survey } from "../model/types";
import type { SurveyState } from "../model/use-survey";

type SurveyLoaderProps = {
  state: SurveyState;
  children: (survey: Survey) => ReactNode;
};

export const SurveyLoader: FC<SurveyLoaderProps> = ({ state, children }) => {
  switch (state.status) {
    case "loading":
      return (
        <div role="status" className="text-muted-foreground grid min-h-dvh place-items-center text-sm">
          <p className="flex items-center gap-2">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            Loading the survey
          </p>
        </div>
      );
    case "error":
      return (
        <div role="alert" className="grid min-h-dvh place-items-center px-6">
          <div className="max-w-md">
            <p className="text-destructive flex items-center gap-2 font-medium">
              <CircleAlert className="size-4" aria-hidden />
              The survey could not be opened
            </p>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed whitespace-pre-line">{state.message}</p>
          </div>
        </div>
      );
    case "processing":
      return (
        <div role="status" className="grid min-h-dvh place-items-center px-6">
          <div className="max-w-md">
            <p className="flex items-center gap-2 font-medium">
              <Hourglass className="text-muted-foreground size-4" aria-hidden />
              {state.job.state === "failed" ? "Processing failed" : "The tiles are being processed"}
            </p>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              {state.job.state === "failed"
                ? state.job.message
                : `${formatQuantity(state.job.tileCount, "tile is", "tiles are")} being turned into canopies, rows, inter-rows, waste and measurements. The map opens once the results are ready.`}
            </p>
            <AppLink
              href="/"
              className="text-primary focus-visible:ring-ring/50 mt-4 inline-block rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]"
            >
              Back to all vineyards
            </AppLink>
          </div>
        </div>
      );
    case "ready":
      return <>{children(state.survey)}</>;
    default:
      return assertNever(state);
  }
};
