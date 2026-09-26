import type { FC } from "react";

import { StatusMessage, SubmitButton, TextField } from "@/shared/ui";

import { useAddVineyardForm } from "../model/use-add-vineyard-form";
import { ImageryField } from "./imagery-field";
import { SurveyFilesField } from "./survey-files-field";

const TODAY = new Date().toISOString().slice(0, 10);

export const AddVineyardForm: FC = () => {
  const { values, errors, status, setValue, handleSubmit, imagery, files, checkImagery } = useAddVineyardForm();

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
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Surveyed on"
            hint="The day the drone flew."
            error={errors.capturedOn}
            name="capturedOn"
            type="date"
            max={TODAY}
            required
            value={values.capturedOn}
            onValueChange={value => setValue("capturedOn", value)}
          />
          <TextField
            label="Ground sample distance, cm (optional)"
            hint="Size of one pixel on the ground."
            error={errors.groundSampleCm}
            name="groundSampleCm"
            inputMode="decimal"
            autoComplete="off"
            className="tabular-nums"
            value={values.groundSampleCm}
            onValueChange={value => setValue("groundSampleCm", value)}
          />
        </div>
      </fieldset>

      <ImageryField
        url={values.imageryUrl}
        error={errors.imageryUrl}
        state={imagery.state}
        onChange={value => setValue("imageryUrl", value)}
        onCheck={checkImagery}
      />

      <SurveyFilesField files={files} />

      <div className="grid gap-4">
        <StatusMessage status={status} />
        <div>
          <SubmitButton label="Add vineyard" isSubmitting={status.kind === "submitting"} />
        </div>
      </div>
    </form>
  );
};
