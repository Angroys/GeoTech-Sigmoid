import { CircleAlert, Hourglass, LoaderCircle } from "lucide-react";
import type { FC } from "react";

import type { Role } from "@/entities/role";
import { useSurvey, type SurveySource } from "@/entities/survey";
import { formatQuantity } from "@/shared/lib/format";
import { assertNever } from "@/shared/lib/types";

import { VineyardFacts } from "./vineyard-facts";

const SUBMITTED_AT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type SurveyFactsProps = { source: SurveySource; role: Role };

export const SurveyFacts: FC<SurveyFactsProps> = ({ source, role }) => {
  const state = useSurvey(source);

  switch (state.status) {
    case "loading":
      return (
        <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Loading the measurements
        </p>
      );
    case "error":
      return (
        <p className="text-destructive flex gap-2 text-sm" role="alert">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          The measurements could not be opened.
        </p>
      );
    case "processing":
      return state.job.state === "failed" ? (
        <p className="text-destructive flex gap-2 text-sm" role="alert">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Processing failed: {state.job.message}
        </p>
      ) : (
        <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
          <Hourglass className="size-4" aria-hidden />
          Processing {formatQuantity(state.job.tileCount, "tile", "tiles")}, submitted{" "}
          {SUBMITTED_AT.format(new Date(state.job.submittedAt))}
        </p>
      );
    case "ready":
      return <VineyardFacts survey={state.survey} source={source} role={role} />;
    default:
      return assertNever(state);
  }
};
