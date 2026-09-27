import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import type { FC } from "react";

import { assertNever } from "@/shared/lib/types";
import { Button, FormField, Input } from "@/shared/ui";

import type { ImageryCheckState } from "../model/use-imagery-check";

type ImageryStatusProps = { state: ImageryCheckState; url: string };

const ImageryStatus: FC<ImageryStatusProps> = ({ state, url }) => {
  switch (state.kind) {
    case "idle":
      return null;
    case "checking":
      return (
        <span className="text-muted-foreground flex items-center gap-2">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Reading the image
        </span>
      );
    case "found":
      if (state.url !== url) return null;
      return (
        <span className="text-primary flex items-center gap-2">
          <CircleCheck className="size-4" aria-hidden />
          Image found. It will be drawn under the survey layers.
        </span>
      );
    case "failed":
      if (state.url !== url) return null;
      return (
        <span className="text-destructive flex items-center gap-2">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          {state.message}
        </span>
      );
    default:
      return assertNever(state);
  }
};

type ImageryFieldProps = {
  url: string;
  error: string | undefined;
  state: ImageryCheckState;
  onChange: (url: string) => void;
  onCheck: () => void;
};

export const ImageryField: FC<ImageryFieldProps> = ({ url, error, state, onChange, onCheck }) => {
  return (
    <fieldset className="grid gap-4">
      <legend className="mb-1 text-[0.9375rem] font-semibold">
        Orthomosaic link
      </legend>
      <FormField
        label="Link to the orthomosaic"
        hint="A public Cloud Optimized GeoTIFF of the whole survey, such as the download link of an OpenAerialMap image. It is also shown as the map background."
        error={error}
      >
        {control => {
          return (
            <div className="flex gap-2">
              <Input
                {...control}
                name="imageryUrl"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://…/orthomosaic.tif"
                value={url}
                onChange={event => onChange(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={onCheck}
                disabled={url.trim() === "" || state.kind === "checking"}
              >
                Check image
              </Button>
            </div>
          );
        }}
      </FormField>
      <p aria-live="polite" className="-mt-2 text-sm">
        <ImageryStatus state={state} url={url.trim()} />
      </p>
    </fieldset>
  );
};
