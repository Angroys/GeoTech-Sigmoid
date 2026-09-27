import { Cpu, Database } from "lucide-react";
import type { FC } from "react";

import { cn } from "@/shared/lib/cn";

import { processingResultsOf, type SurveySource } from "../config/sources";

type ResultsOriginNoteProps = { source: SurveySource; showMessage?: boolean; className?: string };

/** Says whether a processed vineyard's layers come from the live model or from precomputed fallback labels. */
export const ResultsOriginNote: FC<ResultsOriginNoteProps> = ({ source, showMessage = false, className }) => {
  const results = processingResultsOf(source);
  if (!results?.origin) return null;

  const isFallback = results.origin === "fallback";
  const Icon = isFallback ? Database : Cpu;

  return (
    <div className={cn("grid gap-1", className)}>
      <p
        className={cn(
          "inline-flex items-center gap-1.5 justify-self-start rounded-sm border px-2 py-0.5 text-xs font-medium",
          isFallback ? "border-pending/40 text-pending" : "border-primary/30 text-primary",
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {isFallback ? "Precomputed labels (fallback)" : "Live model"}
      </p>
      {showMessage && results.message && (
        <p className="text-muted-foreground text-xs leading-snug">{results.message}</p>
      )}
    </div>
  );
};
