import { useMemo, useRef, type FC } from "react";

import { vineyardUrl } from "@/entities/role";
import { useSession } from "@/entities/session";
import { SURVEY_FILE_NAMES, type SurveyId } from "@/entities/survey";
import { ApiError } from "@/shared/api";
import { useForm } from "@/shared/lib/form";
import { isReadCoordinates, readCoordinates } from "@/shared/lib/geo";
import { navigate } from "@/shared/lib/router";
import { FormField, Input, StatusMessage, SubmitButton } from "@/shared/ui";

import { saveVineyard } from "../api/save-vineyard";
import { routeOffsetFromStart, startFileFrom } from "../model/start-point";
import { useImageryCheck } from "../model/use-imagery-check";
import { useSurveyFiles } from "../model/use-survey-files";
import { INITIAL_VALUES, usesPastedStart, validateAddVineyard, type AddVineyardValues } from "../model/validation";
import { ImageryField } from "./imagery-field";
import { StartPointField, type RouteCheck } from "./start-point-field";
import { SurveyFilesField } from "./survey-files-field";

const TODAY = new Date().toISOString().slice(0, 10);

export const AddVineyardForm: FC = () => {
  const session = useSession();
  const imagery = useImageryCheck();
  const createdId = useRef<SurveyId | null>(null);

  const { values, errors, status, setValue, handleSubmit } = useForm({
    initialValues: INITIAL_VALUES,
    validate: validateAddVineyard,
    submit: async submitted => {
      if (!session) throw new ApiError("Sign in again to add a vineyard.");
      const surveyFiles = files.toSurveyFiles();
      if (!surveyFiles) {
        const problems = [...files.summary.missing, ...files.summary.invalid].map(key => SURVEY_FILE_NAMES[key]);
        throw new ApiError(`The survey data is not complete. Add or fix: ${problems.join(", ")}.`);
      }
      const imageryUrl = submitted.imageryUrl.trim();
      const imageryBounds = imageryUrl ? await imagery.ensure(imageryUrl) : null;
      createdId.current = await saveVineyard({ values: submitted, files: surveyFiles, imageryBounds, session });
    },
    successMessage: "Vineyard added. Opening its map.",
    onSuccess: () => {
      if (createdId.current) navigate(vineyardUrl("owner", createdId.current));
    },
  });

  const isPasted = usesPastedStart(values);
  const pastedRead = useMemo(() => readCoordinates(values.startText), [values.startText]);
  const typedStart = isPasted && isReadCoordinates(pastedRead) ? pastedRead.utm : null;
  const startOverride = useMemo(() => (typedStart ? startFileFrom(typedStart) : null), [typedStart]);
  const files = useSurveyFiles(startOverride);

  const completeFiles = files.toSurveyFiles();
  const hasRouteFiles = Boolean(files.entries.inspectionRoute ?? files.entries.wasteRoute);
  const routeCheck: RouteCheck = !hasRouteFiles
    ? { kind: "server-plans" }
    : typedStart && completeFiles
      ? { kind: "offset", metres: routeOffsetFromStart(completeFiles, typedStart) ?? 0 }
      : { kind: "waiting-for-files" };

  const setText = (field: keyof AddVineyardValues) => (value: string) => setValue(field, value);

  return (
    <form noValidate onSubmit={handleSubmit} className="grid gap-10">
      <fieldset className="grid gap-5">
        <legend className="mb-1 text-[0.9375rem] font-semibold">Vineyard</legend>
        <FormField label="Name" hint="How the vineyard is known, e.g. Sireț3 or Hîncești north." error={errors.name}>
          {control => {
            return (
              <Input
                {...control}
                name="name"
                autoComplete="off"
                required
                value={values.name}
                onChange={event => setText("name")(event.target.value)}
              />
            );
          }}
        </FormField>
        <FormField label="Location" hint="Village and district." error={errors.location}>
          {control => {
            return (
              <Input
                {...control}
                name="location"
                autoComplete="off"
                required
                value={values.location}
                onChange={event => setText("location")(event.target.value)}
              />
            );
          }}
        </FormField>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Surveyed on" hint="The day the drone flew." error={errors.capturedOn}>
            {control => {
              return (
                <Input
                  {...control}
                  name="capturedOn"
                  type="date"
                  max={TODAY}
                  required
                  value={values.capturedOn}
                  onChange={event => setText("capturedOn")(event.target.value)}
                />
              );
            }}
          </FormField>
          <FormField
            label="Ground sample distance, cm (optional)"
            hint="Size of one pixel on the ground."
            error={errors.groundSampleCm}
          >
            {control => {
              return (
                <Input
                  {...control}
                  name="groundSampleCm"
                  inputMode="decimal"
                  autoComplete="off"
                  className="tabular-nums"
                  value={values.groundSampleCm}
                  onChange={event => setText("groundSampleCm")(event.target.value)}
                />
              );
            }}
          </FormField>
        </div>
      </fieldset>

      <ImageryField
        url={values.imageryUrl}
        error={errors.imageryUrl}
        state={imagery.state}
        onChange={setText("imageryUrl")}
        onCheck={() => void imagery.check(values.imageryUrl.trim()).catch(() => undefined)}
      />

      <StartPointField
        isPasted={isPasted}
        text={values.startText}
        error={errors.startText ?? (pastedRead.kind === "invalid" ? pastedRead.message : undefined)}
        read={pastedRead}
        routeCheck={routeCheck}
        onSourceChange={source => setValue("startSource", source)}
        onTextChange={text => setValue("startText", text)}
      />

      <SurveyFilesField files={files} hasTypedStart={startOverride !== null} />

      <div className="grid gap-4">
        <StatusMessage status={status} />
        <div>
          <SubmitButton label="Add vineyard" isSubmitting={status.kind === "submitting"} />
        </div>
      </div>
    </form>
  );
};
