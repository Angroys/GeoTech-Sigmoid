import type { FC } from "react";

import { LinkButton, StatusMessage, SubmitButton, TextField } from "@/shared/ui";

import { useAddVineyardForm } from "../model/use-add-vineyard-form";
import { ImageryField } from "./imagery-field";
import { TilesField } from "./tiles-field";
import { UploadProgressPanel } from "./upload-progress";

const TODAY = new Date().toISOString().slice(0, 10);

export const AddVineyardForm: FC = () => {
  const { values, errors, status, setValue, handleSubmit, imagery, tiles, upload, canUseSample, addWithSample, checkImagery } =
    useAddVineyardForm();
  const isBusy = status.kind === "submitting";

  return (
    <form noValidate onSubmit={handleSubmit} className="grid gap-10">
      <fieldset className="grid gap-5">
        <legend className="mb-1 text-[0.9375rem] font-semibold">Vineyard</legend>
        <TextField
          label="Name"
          hint="How the vineyard is known, e.g. Sireț3 or Hîncești north."
          error={errors.name}
          name="name"
          autoComplete="off"
          required
          value={values.name}
          onValueChange={value => setValue("name", value)}
        />
        <TextField
          label="Location"
          hint="Village and district."
          error={errors.location}
          name="location"
          autoComplete="off"
          required
          value={values.location}
          onValueChange={value => setValue("location", value)}
        />
        <TextField
          label="Surveyed on"
          hint="The day the drone flew."
          error={errors.capturedOn}
          name="capturedOn"
          type="date"
          max={TODAY}
          required
          className="sm:max-w-60"
          value={values.capturedOn}
          onValueChange={value => setValue("capturedOn", value)}
        />
      </fieldset>

      <TilesField tiles={tiles} />

      <ImageryField
        url={values.imageryUrl}
        error={errors.imageryUrl}
        state={imagery.state}
        onChange={value => setValue("imageryUrl", value)}
        onCheck={checkImagery}
      />

      <div className="grid gap-4">
        <UploadProgressPanel progress={upload.progress} onCancel={upload.cancel} />
        <StatusMessage status={status} />
        {canUseSample && !isBusy && (
          <p className="text-muted-foreground text-sm">
            Demo account:{" "}
            <LinkButton onClick={() => void addWithSample()}>add this vineyard with the Sireț3 sample results</LinkButton>{" "}
            instead, to try the rest of the app.
          </p>
        )}
        <div>
          <SubmitButton label="Upload tiles and process" isSubmitting={isBusy} />
        </div>
      </div>
    </form>
  );
};
