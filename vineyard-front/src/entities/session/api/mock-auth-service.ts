import type { Role } from "@/entities/role/@x/session";
import { ApiError } from "@/shared/api";
import { readItem, writeItem } from "@/shared/lib/storage";

import { createSalt, hashPassword } from "../lib/password";
import { accountIdSchema, accountListSchema } from "../model/schema";
import { clearSession, saveSession } from "../model/session-store";
import type {
  Account,
  InspectorAccount,
  InspectorRegistration,
  OwnerAccount,
  OwnerRegistration,
  Session,
} from "../model/types";

const ACCOUNTS_KEY = "vineyard:accounts:v1";
const SESSION_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RESPONSE_DELAY_MS = 450;

const STORAGE_BLOCKED =
  "This browser is blocking site data, so the demo cannot keep you signed in. Allow site data and try again.";
const WRONG_CREDENTIALS = "The email or password is incorrect.";

const respond = () => new Promise(resolve => setTimeout(resolve, RESPONSE_DELAY_MS));

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const newAccountId = () => accountIdSchema.parse(crypto.randomUUID());

const UNUSABLE_PASSWORD = { passwordHash: "0".repeat(64), salt: "0".repeat(32) };

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

const saveAccounts = (accounts: Account[]) => {
  if (!writeItem(ACCOUNTS_KEY, accounts)) throw new ApiError(STORAGE_BLOCKED);
};

const loadAccounts = (): Account[] => {
  const stored = readItem(ACCOUNTS_KEY, accountListSchema);
  if (stored) return stored;

  const seeded = createDemoAccounts();
  writeItem(ACCOUNTS_KEY, seeded);
  return seeded;
};

const findByEmail = (accounts: Account[], email: string) =>
  accounts.find(account => account.email === normalizeEmail(email));

const assertEmailIsFree = (accounts: Account[], email: string) => {
  if (findByEmail(accounts, email)) {
    throw new ApiError("An account with this email already exists. Sign in instead.");
  }
};

const startSession = (account: Account): Session => {
  const now = Date.now();
  const session: Session = {
    accountId: account.id,
    role: account.role,
    fullName: account.fullName,
    email: account.email,
    isDemo: account.isDemo,
    signedInAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_DAYS * MS_PER_DAY).toISOString(),
  };
  if (!saveSession(session)) throw new ApiError(STORAGE_BLOCKED);
  return session;
};

const credentialsFor = async (password: string) => {
  const salt = createSalt();
  return { salt, passwordHash: await hashPassword(password, salt) };
};

export const registerOwner = async (registration: OwnerRegistration): Promise<Session> => {
  await respond();
  const accounts = loadAccounts();
  assertEmailIsFree(accounts, registration.email);

  const account: OwnerAccount = {
    id: newAccountId(),
    role: "owner",
    status: "active",
    isDemo: false,
    email: normalizeEmail(registration.email),
    fullName: registration.fullName.trim(),
    fiscalCode: registration.fiscalCode,
    createdAt: new Date().toISOString(),
    ...(await credentialsFor(registration.password)),
  };
  saveAccounts([...accounts, account]);
  return startSession(account);
};

export const registerInspector = async (registration: InspectorRegistration): Promise<void> => {
  await respond();
  const accounts = loadAccounts();
  assertEmailIsFree(accounts, registration.email);

  const account: InspectorAccount = {
    id: newAccountId(),
    role: "inspector",
    status: "pending_confirmation",
    isDemo: false,
    email: normalizeEmail(registration.email),
    fullName: registration.fullName.trim(),
    agency: registration.agency,
    badgeNumber: registration.badgeNumber.trim().toUpperCase(),
    createdAt: new Date().toISOString(),
    ...(await credentialsFor(registration.password)),
  };
  saveAccounts([...accounts, account]);
};

type PasswordSignIn = { email: string; password: string; role: Role };

const ROLE_NAME = { owner: "a vineyard owner", inspector: "a state inspector" } as const satisfies Record<Role, string>;

export const signInWithPassword = async ({ email, password, role }: PasswordSignIn): Promise<Session> => {
  await respond();
  const account = findByEmail(loadAccounts(), email);
  if (!account) throw new ApiError(WRONG_CREDENTIALS);
  if ((await hashPassword(password, account.salt)) !== account.passwordHash) throw new ApiError(WRONG_CREDENTIALS);

  if (account.role !== role) {
    throw new ApiError(`This account is registered as ${ROLE_NAME[account.role]}. Switch the role above to sign in.`);
  }
  if (account.role === "inspector" && account.status === "pending_confirmation") {
    throw new ApiError("Your agency has not confirmed your badge number yet. You can sign in once it does.");
  }
  return startSession(account);
};

export const signInAsDemo = async (role: Role): Promise<Session> => {
  await respond();
  const account = loadAccounts().find(candidate => candidate.isDemo && candidate.role === role);
  if (!account) throw new ApiError("The demo account is missing. Clear this site's data and reload the page.");
  return startSession(account);
};

export const signOut = () => clearSession();
