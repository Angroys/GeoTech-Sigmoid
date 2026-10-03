import type { FC } from "react";

import { ParcelFacts, ParcelOutline, type Parcel } from "@/entities/parcel";
import type { FieldErrors } from "@/shared/lib/form";
import { LinkButton, StatusMessage, SubmitButton, TextField } from "@/shared/ui";

import { useAddVineyardForm } from "../model/use-add-vineyard-form";
import type { AddVineyardValues } from "../model/validation";
import { CoveredParcelsField } from "./covered-parcels-field";
import { ImageryField } from "./imagery-field";
import { TilesField } from "./tiles-field";
import { UploadProgressPanel } from "./upload-progress";

const TODAY = new Date().toISOString().slice(0, 10);

type ParcelCardProps = { parcel: Parcel };

const ParcelCard: FC<ParcelCardProps> = ({ parcel }) => {
  return (
    <section aria-label="Parcel" className="border-border flex items-center gap-4 rounded-lg border p-3">
      <ParcelOutline outline={parcel.outline} className="size-16 shrink-0 rounded-md" />
      <ParcelFacts parcel={parcel} />
    </section>
  );
};

type VineyardDetailsProps = {
  values: AddVineyardValues;
  errors: FieldErrors<AddVineyardValues>;
  onChange: (field: keyof AddVineyardValues, value: string) => void;
};

const VineyardDetails: FC<VineyardDetailsProps> = ({ values, errors, onChange }) => {
  return (
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
        onValueChange={value => onChange("name", value)}
      />
      <TextField
        label="Location"
        hint="Village and district."
        error={errors.location}
        name="location"
        autoComplete="off"
        required
        value={values.location}
        onValueChange={value => onChange("location", value)}
      />
    </fieldset>
  );
};

type AddVineyardFormProps = { parcel: Parcel | null };

export const AddVineyardForm: FC<AddVineyardFormProps> = ({ parcel }) => {
  const form = useAddVineyardForm(parcel);
  const { values, errors, status, setValue, handleSubmit, imagery, tiles, upload } = form;
  const isBusy = status.kind === "submitting";

  return (
    <form noValidate onSubmit={handleSubmit} className="grid gap-10">
      {parcel ? (
        <ParcelCard parcel={parcel} />
      ) : (
        <VineyardDetails values={values} errors={errors} onChange={(field, value) => setValue(field, value)} />
      )}

      <div className="grid gap-8">
        <p className="text-muted-foreground -mb-4 text-sm leading-relaxed">
          Add the drone survey&rsquo;s image tiles, a link to its orthomosaic, or both.
        </p>
        <TilesField tiles={tiles} />
        <ImageryField
          url={values.imageryUrl}
          error={errors.imageryUrl}
          state={imagery.state}
          onChange={value => setValue("imageryUrl", value)}
          onCheck={form.checkImagery}
        />
        <CoveredParcelsField covered={form.covered} />
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
      </div>

      <div className="grid gap-4">
        <UploadProgressPanel progress={upload.progress} onCancel={upload.cancel} />
        <StatusMessage status={status} />
        {form.canUseSample && !isBusy && (
          <p className="text-muted-foreground text-sm">
            Demo account:{" "}
            <LinkButton onClick={() => void form.addWithSample()}>add this survey with the Sireț3 sample results</LinkButton>{" "}
            instead, to try the rest of the app.
          </p>
        )}
        <div>
          <SubmitButton label="Send for processing" isSubmitting={isBusy} />
        </div>
      </div>
    </form>
  );
};
