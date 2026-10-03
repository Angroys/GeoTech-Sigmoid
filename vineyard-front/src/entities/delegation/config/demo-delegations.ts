import type { z } from "zod";

import type { delegationDtoSchema } from "../model/schema";

const DAYS_UNTIL_DEMO_CONTROL = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const isoDateIn = (days: number) => new Date(Date.now() + days * MS_PER_DAY).toISOString().slice(0, 10);

export const demoDelegationRecords = (): z.input<typeof delegationDtoSchema>[] => [
  {
    number: "DC-2026-000417",
    rsc_number: "RSC-2026-118302",
    control_body: "National Office of Vine and Wine (ONVV)",
    control_type: "planned",
    legal_basis: "Law No. 131/2012 on state control; Law No. 57/2006 on vine and wine",
    purpose: "Phytosanitary and planting check of the operator's vineyard parcels",
    checklist: "Vineyard plantation checklist (missing vines, waste, row condition)",
    operator: { name: "Demo vineyard owner", idno: "1003600000001" },
    inspectors: [{ full_name: "Demo state inspector", badge_number: "ONVV-0001" }],
    start_date: isoDateIn(DAYS_UNTIL_DEMO_CONTROL),
    duration_days: 3,
    status: "registered",
  },
];
