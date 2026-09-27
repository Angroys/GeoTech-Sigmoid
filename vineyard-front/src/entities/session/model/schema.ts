import { z } from "zod";

import { AGENCY_VALUES } from "@/entities/agency/@x/session";
import { ROLES } from "@/entities/role/@x/session";

export const accountIdSchema = z.uuid().brand<"AccountId">();

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const HEX_SALT = /^[0-9a-f]{32}$/;

const accountFields = {
  id: accountIdSchema,
  email: z.email(),
  fullName: z.string().min(1),
  passwordHash: z.string().regex(HEX_SHA256),
  salt: z.string().regex(HEX_SALT),
  createdAt: z.iso.datetime(),
  isDemo: z.boolean(),
};

export const ownerAccountSchema = z.object({
  ...accountFields,
  role: z.literal("owner"),
  fiscalCode: z.string().regex(/^\d{13}$/),
  status: z.literal("active"),
});

export const inspectorAccountSchema = z.object({
  ...accountFields,
  role: z.literal("inspector"),
  agency: z.enum(AGENCY_VALUES),
  badgeNumber: z.string().min(1),
  status: z.enum(["active", "pending_confirmation"]),
});

export const accountListSchema = z.array(z.discriminatedUnion("role", [ownerAccountSchema, inspectorAccountSchema]));

export const sessionSchema = z.object({
  accountId: accountIdSchema,
  role: z.enum(ROLES),
  fullName: z.string().min(1),
  email: z.email(),
  isDemo: z.boolean(),
  inspector: z.object({ agency: z.enum(AGENCY_VALUES), badgeNumber: z.string().min(1) }).nullable().default(null),
  signedInAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
