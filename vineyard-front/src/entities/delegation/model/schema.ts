import { z } from "zod";

export const delegationNumberSchema = z.string().regex(/^[A-Z0-9-]{4,40}$/).brand<"DelegationNumber">();

export type DelegationNumber = z.infer<typeof delegationNumberSchema>;

export const delegationDtoSchema = z.object({
  number: delegationNumberSchema,
  rsc_number: z.string().min(1),
  control_body: z.string().min(1),
  control_type: z.enum(["planned", "unannounced"]),
  legal_basis: z.string().min(1),
  purpose: z.string().min(1),
  checklist: z.string().min(1),
  operator: z.object({ name: z.string().min(1), idno: z.string().regex(/^\d{13}$/) }),
  inspectors: z.array(z.object({ full_name: z.string().min(1), badge_number: z.string().min(1) })),
  start_date: z.iso.date(),
  duration_days: z.number().int().positive(),
  status: z.enum(["registered", "in_progress", "completed"]),
});

export type DelegationDto = z.output<typeof delegationDtoSchema>;

export const delegationListSchema = z.object({ delegations: z.array(delegationDtoSchema) });
