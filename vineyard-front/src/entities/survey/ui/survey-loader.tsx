import { CircleAlert, LoaderCircle } from "lucide-react";
import type { FC, ReactNode } from "react";

import { assertNever } from "@/shared/lib/types";

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
    case "ready":
      return <>{children(state.survey)}</>;
    default:
      return assertNever(state);
  }
};
