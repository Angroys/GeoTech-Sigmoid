import { LoaderCircle } from "lucide-react";
import { useId, type FC } from "react";

import { isServerPlanned, SURVEY_FILE_KEYS } from "@/entities/survey";

import type { SurveyFilesState } from "../model/use-survey-files";
import { FileDropZone } from "./file-drop-zone";
import { FileGroup, FileStatusLegend } from "./file-checklist";

const REQUIRED_KEYS = SURVEY_FILE_KEYS.filter(key => !isServerPlanned(key));
const ROUTE_KEYS = SURVEY_FILE_KEYS.filter(isServerPlanned);

type ReadingNoteProps = { files: SurveyFilesState };

const ReadingNote: FC<ReadingNoteProps> = ({ files }) => {
  return (
    <div aria-live="polite" className="grid gap-2 empty:hidden">
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
  );
};

type SurveyFilesFieldProps = { files: SurveyFilesState };

export const SurveyFilesField: FC<SurveyFilesFieldProps> = ({ files }) => {
  const hintId = useId();

  return (
    <fieldset className="grid gap-4">
      <legend className="mb-1 text-[0.9375rem] font-semibold">
        Survey data <span className="text-muted-foreground font-normal">(required)</span>
      </legend>
      <p id={hintId} className="text-muted-foreground -mt-2 text-sm leading-relaxed">
        The GeoJSON files the processing pipeline writes for one survey, in EPSG:32635. Each is checked against the
        annotation format as it arrives.
      </p>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <FileDropZone
          describedBy={hintId}
          onFiles={selected => void files.addFiles(selected)}
          onLoadSample={() => void files.addSampleFiles()}
        />
        <div className="grid content-start gap-3">
          <FileGroup
            title="Required"
            keys={REQUIRED_KEYS}
            entries={files.entries}
            isOptional={false}
            onRemove={files.removeFile}
          />
          <FileGroup
            title="Routes"
            note="Optional. Leave them out and the server plans both routes from start.geojson."
            keys={ROUTE_KEYS}
            entries={files.entries}
            isOptional
            onRemove={files.removeFile}
          />
          <FileStatusLegend />
        </div>
      </div>

      <ReadingNote files={files} />
    </fieldset>
  );
};
