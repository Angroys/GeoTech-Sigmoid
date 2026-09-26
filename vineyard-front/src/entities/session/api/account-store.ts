import { ApiError } from "@/shared/api";
import { readItem, writeItem } from "@/shared/lib/storage";

import { accountIdSchema, accountListSchema } from "../model/schema";
import type { Account } from "../model/types";

const ACCOUNTS_KEY = "vineyard:accounts:v1";

export const STORAGE_BLOCKED =
  "This browser is blocking site data, so the demo cannot keep you signed in. Allow site data and try again.";

const UNUSABLE_PASSWORD = { passwordHash: "0".repeat(64), salt: "0".repeat(32) };

export const newAccountId = () => accountIdSchema.parse(crypto.randomUUID());

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const createDemoAccounts = (): Account[] => {
  const createdAt = new Date().toISOString();
  return [
    {
      id: newAccountId(),
      role: "owner",
      status: "active",
      isDemo: true,
      email: "demo.owner@vineyard.test",
      fullName: "Demo vineyard owner",
      fiscalCode: "1003600000001",
      createdAt,
      ...UNUSABLE_PASSWORD,
    },
    {
      id: newAccountId(),
      role: "inspector",
      status: "active",
      isDemo: true,
      email: "demo.inspector@vineyard.test",
      fullName: "Demo state inspector",
      agency: "onvv",
      badgeNumber: "ONVV-0001",
      createdAt,
      ...UNUSABLE_PASSWORD,
    },
  ];
};

export const loadAccounts = (): Account[] => {
  const stored = readItem(ACCOUNTS_KEY, accountListSchema);
  if (stored) return stored;

  const seeded = createDemoAccounts();
  writeItem(ACCOUNTS_KEY, seeded);
  return seeded;
};

export const saveAccounts = (accounts: Account[]) => {
  if (!writeItem(ACCOUNTS_KEY, accounts)) throw new ApiError(STORAGE_BLOCKED);
};

export const findByEmail = (accounts: Account[], email: string) =>
  accounts.find(account => account.email === normalizeEmail(email));
