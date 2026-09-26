import type { z } from "zod";

import type { Agency } from "@/entities/agency/@x/session";

import type {
  accountIdSchema,
  accountListSchema,
  inspectorAccountSchema,
  ownerAccountSchema,
  sessionSchema,
} from "./schema";

export type AccountId = z.infer<typeof accountIdSchema>;
export type OwnerAccount = z.infer<typeof ownerAccountSchema>;
export type InspectorAccount = z.infer<typeof inspectorAccountSchema>;
export type Account = z.infer<typeof accountListSchema>[number];
export type Session = z.infer<typeof sessionSchema>;

type Credentials = { email: string; password: string };

export type OwnerRegistration = Credentials & { fullName: string; fiscalCode: string };

export type InspectorRegistration = Credentials & { fullName: string; agency: Agency; badgeNumber: string };
