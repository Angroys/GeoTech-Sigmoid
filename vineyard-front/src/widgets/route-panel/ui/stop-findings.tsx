import type { FC } from "react";

import type { RouteStop } from "@/entities/survey";
import { FindingPicker, type RouteProgressState } from "@/features/track-route-progress";

type StopFindingsProps = { stop: RouteStop; progress: RouteProgressState };

export const StopFindings: FC<StopFindingsProps> = ({ stop, progress }) => {
  return (
    <FindingPicker
      kind={stop.kind}
      record={progress.recordOf(stop.targetId)}
      onFindingChange={finding => progress.setFinding(stop.targetId, finding)}
      onNoteChange={note => progress.setNote(stop.targetId, note)}
    />
  );
};
