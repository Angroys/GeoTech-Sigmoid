export const AGENCY_VALUES = ["ansa", "onvv", "maia"] as const;

export type Agency = (typeof AGENCY_VALUES)[number];

const AGENCY_LABEL = {
  ansa: "National Food Safety Agency (ANSA)",
  onvv: "National Office of Vine and Wine (ONVV)",
  maia: "Ministry of Agriculture and Food Industry",
} as const satisfies Record<Agency, string>;

export const AGENCIES = AGENCY_VALUES.map(value => {
  return { value, label: AGENCY_LABEL[value] };
});

export const agencyLabel = (agency: Agency) => AGENCY_LABEL[agency];

export const toAgency = (value: string): Agency | "" => AGENCY_VALUES.find(agency => agency === value) ?? "";
