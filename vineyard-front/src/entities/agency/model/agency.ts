export const AGENCIES = [
  { value: "ansa", label: "National Food Safety Agency (ANSA)" },
  { value: "onvv", label: "National Office of Vine and Wine (ONVV)" },
  { value: "maia", label: "Ministry of Agriculture and Food Industry" },
] as const;

export type Agency = (typeof AGENCIES)[number]["value"];

/** Narrows raw input, such as a select's value, to a known agency or "" for none. */
export const toAgency = (value: string): Agency | "" => AGENCIES.find(agency => agency.value === value)?.value ?? "";
