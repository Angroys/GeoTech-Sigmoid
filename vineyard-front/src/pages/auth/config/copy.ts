import type { Role } from "@/entities/role";

import type { AuthMode } from "../model/auth-mode";

type ModeCopy = {
  title: string;
  switchPrompt: string;
  switchAction: string;
};

export const MODE_COPY = {
  "sign-in": { title: "Sign in", switchPrompt: "New to Vineyard?", switchAction: "Create an account" },
  "sign-up": { title: "Create an account", switchPrompt: "Already registered?", switchAction: "Sign in" },
} as const satisfies Record<AuthMode, ModeCopy>;

export const ROLE_HEADLINE = {
  owner: "Your parcels, drone surveys and inspection results in one register.",
  inspector: "Check registered parcels and file inspection reports from the field.",
} as const satisfies Record<Role, string>;
