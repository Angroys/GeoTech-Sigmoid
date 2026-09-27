import { LoaderCircle } from "lucide-react";
import type { FC } from "react";

import { formatCount } from "@/shared/lib/format";
import { assertNever } from "@/shared/lib/types";
import { Button } from "@/shared/ui";

import { formatBytes } from "../lib/format-bytes";
import type { UploadProgress } from "../model/use-tile-upload";

const describe = (progress: Exclude<UploadProgress, { phase: "idle" }>) => {
  switch (progress.phase) {
    case "creating":
      return "Registering the vineyard with the processing service";
    case "uploading":
      return `Uploading tile ${formatCount(Math.min(progress.doneCount + 1, progress.tileCount))} of ${formatCount(progress.tileCount)}, ${formatBytes(progress.sentBytes)} of ${formatBytes(progress.totalBytes)}`;
    case "starting":
      return "Starting the processing";
    default:
      return assertNever(progress);
  }
};

const ratioOf = (progress: UploadProgress) =>
  progress.phase === "uploading" && progress.totalBytes > 0 ? progress.sentBytes / progress.totalBytes : 0;

type UploadProgressPanelProps = { progress: UploadProgress; onCancel: () => void };

export const UploadProgressPanel: FC<UploadProgressPanelProps> = ({ progress, onCancel }) => {
  if (progress.phase === "idle") return null;

  return (
    <div role="status" className="border-border grid gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm tabular-nums">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          {describe(progress)}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
        <div
          className="bg-primary h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${ratioOf(progress) * 100}%` }}
        />
      </div>
      <p className="text-muted-foreground text-xs">Keep this page open until the upload finishes.</p>
    </div>
  );
};
