import type { Role } from "../model/role";

type RoleCopy = {
  label: string;
  emailLabel: string;
};

export const ROLE_COPY = {
  owner: { label: "Vineyard owner", emailLabel: "Email" },
  inspector: { label: "State inspector", emailLabel: "Agency email" },
} as const satisfies Record<Role, RoleCopy>;
