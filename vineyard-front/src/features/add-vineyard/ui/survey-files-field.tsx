import { Circle, CircleAlert, CircleCheck, LoaderCircle, Upload, X } from "lucide-react";
import { useId, useState, type ChangeEvent, type DragEvent, type FC } from "react";

import { isServerPlanned, SURVEY_FILE_KEYS, SURVEY_FILE_NAMES, type SurveyFileKey } from "@/entities/survey";
import { cn } from "@/shared/lib/cn";
import { formatCount } from "@/shared/lib/format";
import { LinkButton } from "@/shared/ui";

import { SURVEY_FILE_LABELS } from "../config/survey-file-labels";
import type { SurveyFileEntry, SurveyFilesState } from "../model/use-survey-files";

type FileRowProps = {
  fileKey: SurveyFileKey;
  isOptional: boolean;
  entry: SurveyFileEntry | undefined;
  isProvidedElsewhere: boolean;
  onRemove: (key: SurveyFileKey) => void;
};

const FileRow: FC<FileRowProps> = ({ fileKey, isOptional, entry, isProvidedElsewhere, onRemove }) => {
  const status = entry?.check.status ?? (isProvidedElsewhere ? "valid" : isOptional ? "optional" : "missing");
  const Icon = status === "valid" ? CircleCheck : status === "invalid" ? CircleAlert : Circle;
  const detail = entry
    ? entry.check.status === "valid"
      ? `${formatCount(entry.check.featureCount)} ${entry.check.featureCount === 1 ? "feature" : "features"}`
      : entry.check.message
    : isProvidedElsewhere
      ? "From the pasted coordinates"
      : isOptional
        ? "Optional. Without it, the server plans this route from the starting point."
        : "Not added yet";

  return (
    <li className="grid grid-cols-[1.25rem_1fr_auto] items-start gap-3 px-3 py-2.5">
      <Icon
        className={cn(
          "mt-0.5 size-4",
          status === "valid" && "text-primary",
          status === "invalid" && "text-destructive",
          (status === "missing" || status === "optional") && "text-muted-foreground",
        )}
        aria-hidden
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{SURVEY_FILE_NAMES[fileKey]}</span>
        <span className="text-muted-foreground block text-xs">{SURVEY_FILE_LABELS[fileKey]}</span>
        <span
          className={cn(
            "mt-0.5 block text-xs break-words",
            status === "invalid" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {status === "invalid" ? "Problem: " : ""}
          {detail}
        </span>
      </span>
      {entry && (
        <button
          type="button"
          onClick={() => onRemove(fileKey)}
          aria-label={`Remove ${SURVEY_FILE_NAMES[fileKey]}`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 grid size-7 place-items-center rounded-md outline-none focus-visible:ring-[3px]"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </li>
  );
};

type SurveyFilesFieldProps = {
  files: SurveyFilesState;
  hasTypedStart: boolean;
};

export const SurveyFilesField: FC<SurveyFilesFieldProps> = ({ files, hasTypedStart }) => {
  const inputId = useId();
  const hintId = useId();
  const [isDragging, setIsDragging] = useState(false);

  const takeFiles = (list: FileList | null) => {
    if (list && list.length > 0) void files.addFiles([...list]);
  };
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    takeFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    takeFiles(event.dataTransfer.files);
  };

  return (
    <fieldset className="grid gap-4">
      <legend className="mb-1 text-[0.9375rem] font-semibold">
        Survey data <span className="text-muted-foreground font-normal">(required)</span>
      </legend>
      <p id={hintId} className="text-muted-foreground -mt-2 text-sm leading-relaxed">
        The GeoJSON files the processing pipeline writes for one survey, in EPSG:32635. Add them all at once or one by
        one; each is checked against the annotation format as it arrives.
      </p>

      <div
        onDragOver={event => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={cn(
          "grid justify-items-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors motion-reduce:transition-none",
          isDragging ? "border-primary bg-primary/5" : "border-input bg-muted/40",
        )}
      >
        <Upload className="text-muted-foreground size-6" aria-hidden />
        <p className="text-sm font-medium">Drop the survey files here</p>
        <p className="text-muted-foreground text-sm">
          or{" "}
          <label
            htmlFor={inputId}
            className="text-primary cursor-pointer font-medium underline-offset-4 hover:underline has-[+input:focus-visible]:underline"
          >
            choose files
          </label>
        </p>
        <input
          id={inputId}
          type="file"
          multiple
          accept=".geojson,.json,application/geo+json,application/json"
          onChange={onChange}
          aria-describedby={hintId}
          className="sr-only"
        />
        <LinkButton onClick={() => void files.addSampleFiles()} className="mt-1 text-xs">
          Load the Sireț3 sample files
        </LinkButton>
      </div>

      <div aria-live="polite" className="grid gap-2">
        {files.isReading && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            Checking the files
          </p>
        )}
        {files.ignored.length > 0 && (
          <p className="text-muted-foreground text-sm">
            Not part of the survey data, so left out: {files.ignored.join(", ")}.
          </p>
        )}
      </div>

      <ul aria-label="Survey files" className="border-border divide-border divide-y rounded-lg border">
        {SURVEY_FILE_KEYS.map(key => {
          return (
            <FileRow
              key={key}
              fileKey={key}
              isOptional={isServerPlanned(key)}
              entry={key === "start" && hasTypedStart ? undefined : files.entries[key]}
              isProvidedElsewhere={key === "start" && hasTypedStart}
              onRemove={files.removeFile}
            />
          );
        })}
      </ul>
    </fieldset>
  );
};
