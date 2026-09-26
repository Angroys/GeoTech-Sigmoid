import { X } from "lucide-react";
import type { FC } from "react";

import { SURVEY_FILE_NAMES, type SurveyFileKey } from "@/entities/survey";
import { cn } from "@/shared/lib/cn";
import { formatCount } from "@/shared/lib/format";

import { SURVEY_FILE_LABELS } from "../config/survey-file-labels";
import type { SurveyFileEntry } from "../model/use-survey-files";

type FileStatus = "added" | "problem" | "needed" | "optional";

const STATUS_STYLE = {
  added: { label: "Added", dot: "bg-primary border-primary" },
  problem: { label: "Problem", dot: "bg-destructive border-destructive" },
  needed: { label: "Needed", dot: "bg-pending border-pending" },
  optional: { label: "Optional", dot: "border-muted-foreground bg-transparent" },
} as const satisfies Record<FileStatus, { label: string; dot: string }>;

const LEGEND_ORDER: readonly FileStatus[] = ["added", "needed", "problem", "optional"];

const statusOf = (entry: SurveyFileEntry | undefined, isOptional: boolean): FileStatus => {
  if (entry) return entry.check.status === "valid" ? "added" : "problem";
  return isOptional ? "optional" : "needed";
};

type StatusDotProps = { status: FileStatus };

const StatusDot: FC<StatusDotProps> = ({ status }) => {
  return <span className={cn("size-2.5 shrink-0 rounded-full border-2", STATUS_STYLE[status].dot)} aria-hidden />;
};

type FileRowProps = {
  fileKey: SurveyFileKey;
  entry: SurveyFileEntry | undefined;
  isOptional: boolean;
  onRemove: (key: SurveyFileKey) => void;
};

const FileRow: FC<FileRowProps> = ({ fileKey, entry, isOptional, onRemove }) => {
  const status = statusOf(entry, isOptional);
  const fileName = SURVEY_FILE_NAMES[fileKey];

  return (
    <li
      className={cn(
        "grid grid-cols-[0.625rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2",
        status === "problem" && "bg-destructive/5",
      )}
    >
      <StatusDot status={status} />
      <p className="flex min-w-0 items-baseline gap-2 text-sm">
        <span className="shrink-0 font-medium">{fileName}</span>
        <span className="text-muted-foreground truncate text-xs">{SURVEY_FILE_LABELS[fileKey]}</span>
        <span className="sr-only">, {STATUS_STYLE[status].label}</span>
      </p>
      <span className="flex items-center gap-1">
        {entry?.check.status === "valid" && (
          <span className="text-muted-foreground text-xs tabular-nums" title="Features in the file">
            {formatCount(entry.check.featureCount)}
          </span>
        )}
        {entry && (
          <button
            type="button"
            onClick={() => onRemove(fileKey)}
            aria-label={`Remove ${fileName}`}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -my-1 grid size-6 place-items-center rounded-md outline-none focus-visible:ring-[3px]"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </span>
      {entry?.check.status === "invalid" && (
        <p className="text-destructive col-start-2 col-end-4 mt-1 text-xs leading-snug break-words">
          {entry.check.message}
        </p>
      )}
    </li>
  );
};

type FileGroupProps = {
  title: string;
  note?: string;
  keys: readonly SurveyFileKey[];
  entries: Partial<Record<SurveyFileKey, SurveyFileEntry>>;
  isOptional: boolean;
  onRemove: (key: SurveyFileKey) => void;
};

export const FileGroup: FC<FileGroupProps> = ({ title, note, keys, entries, isOptional, onRemove }) => {
  const addedCount = keys.filter(key => entries[key]?.check.status === "valid").length;

  return (
    <section className="border-border overflow-hidden rounded-lg border">
      <header className="bg-muted/60 flex items-baseline justify-between gap-3 px-3 py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-muted-foreground text-xs tabular-nums">
          {addedCount} of {keys.length} added
        </span>
      </header>
      {note && <p className="text-muted-foreground border-border border-t px-3 py-2 text-xs leading-snug">{note}</p>}
      <ul className="divide-border border-border divide-y border-t">
        {keys.map(key => {
          return (
            <FileRow key={key} fileKey={key} entry={entries[key]} isOptional={isOptional} onRemove={onRemove} />
          );
        })}
      </ul>
    </section>
  );
};

export const FileStatusLegend: FC = () => {
  return (
    <ul aria-hidden className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {LEGEND_ORDER.map(status => {
        return (
          <li key={status} className="flex items-center gap-1.5">
            <StatusDot status={status} />
            {STATUS_STYLE[status].label}
          </li>
        );
      })}
    </ul>
  );
};
