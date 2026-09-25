import type { Role } from "@/entities/role";

export const SIGN_UP_SUCCESS = {
  owner: "Account created. You can sign in now.",
  inspector: "Request sent. You can sign in once your agency confirms your badge number.",
} as const satisfies Record<Role, string>;
