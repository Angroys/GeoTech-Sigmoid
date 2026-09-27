import { useId, type FC } from "react";

import type { RouteStop } from "@/entities/survey";
import { cn } from "@/shared/lib/cn";

import { FINDING_LABEL, FINDINGS_BY_KIND, NOTE_MAX_LENGTH, type Finding } from "../config/findings";
import type { StopRecord } from "../model/stop-records";

type FindingPickerProps = {
  kind: RouteStop["kind"];
  record: StopRecord;
  onFindingChange: (finding: Finding | null) => void;
  onNoteChange: (note: string) => void;
};

export const FindingPicker: FC<FindingPickerProps> = ({ kind, record, onFindingChange, onNoteChange }) => {
  const noteId = useId();

  return (
    <div className="grid gap-2">
      <fieldset>
        <legend className="text-muted-foreground mb-1.5 text-xs">Finding</legend>
        <div className="flex flex-wrap gap-1.5">
          {FINDINGS_BY_KIND[kind].map(finding => {
            const isChosen = record.finding === finding;
            return (
              <button
                key={finding}
                type="button"
                aria-pressed={isChosen}
                onClick={() => onFindingChange(isChosen ? null : finding)}
                className={cn(
                  "focus-visible:ring-ring/50 rounded-full border px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-[3px]",
                  isChosen
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {FINDING_LABEL[finding]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label htmlFor={noteId} className="text-muted-foreground text-xs">
        Note (optional)
      </label>
      <textarea
        id={noteId}
        rows={2}
        maxLength={NOTE_MAX_LENGTH}
        value={record.note}
        onChange={event => onNoteChange(event.target.value)}
        className="border-input bg-popover focus-visible:border-ring focus-visible:ring-ring/50 -mt-1 w-full resize-y rounded-md border px-2.5 py-1.5 text-sm outline-none focus-visible:ring-[3px]"
      />
    </div>
  );
};
