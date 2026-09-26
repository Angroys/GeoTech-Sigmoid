import { firstError, matches, required, type FieldErrors, type Rule } from "@/shared/lib/form";


export type AddVineyardValues = {
  name: string;
  location: string;
  capturedOn: string;
  groundSampleCm: string;
  imageryUrl: string;
};

export const INITIAL_VALUES: AddVineyardValues = {
  name: "",
  location: "",
  capturedOn: "",
  groundSampleCm: "",
  imageryUrl: "",
};

const DECIMAL = /^\d+([.,]\d+)?$/;

const notInFuture: Rule = value =>
  value && value > new Date().toISOString().slice(0, 10) ? "The survey date is in the future." : undefined;

const optional =
  (rules: Rule[]): Rule =>
  value =>
    value.trim() === "" ? undefined : firstError(value, rules);

const isHttpsUrl: Rule = value => {
  try {
    return new URL(value.trim()).protocol === "https:" ? undefined : "Use a link that starts with https://.";
  } catch {
    return "Enter a full link, starting with https://.";
  }
};

export const validateAddVineyard = (values: AddVineyardValues): FieldErrors<AddVineyardValues> => ({
  name: firstError(values.name, [required("Name the vineyard.")]),
  location: firstError(values.location, [required("Say where the vineyard is.")]),
  capturedOn: firstError(values.capturedOn, [required("Enter the day the drone flew."), notInFuture]),
  groundSampleCm: firstError(values.groundSampleCm, [
    optional([matches(DECIMAL, "Enter a number of centimetres, such as 3.5.")]),
  ]),
  imageryUrl: firstError(values.imageryUrl, [optional([isHttpsUrl])]),
});

export const parseGroundSample = (value: string) => {
  const trimmed = value.trim().replace(",", ".");
  return trimmed === "" ? null : Number(trimmed);
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export const formatSurveyDate = (isoDate: string) => DATE_FORMAT.format(new Date(`${isoDate}T00:00:00Z`));
