import { useCallback } from "react";

import { isRole, type Role } from "@/entities/role";
import { ROUTES } from "@/shared/config";
import { navigate, useLocation } from "@/shared/lib/router";

import type { AuthMode } from "./auth-mode";

const PATH_BY_MODE = { "sign-in": ROUTES.signIn, "sign-up": ROUTES.signUp } as const satisfies Record<AuthMode, string>;

type AuthLocation = { mode: AuthMode; role: Role };

const toUrl = ({ mode, role }: AuthLocation) => `${PATH_BY_MODE[mode]}?role=${role}`;

export const useAuthLocation = () => {
  const { pathname, searchParams } = useLocation();
  const roleParam = searchParams.get("role");
  const mode: AuthMode = pathname === ROUTES.signUp ? "sign-up" : "sign-in";
  const role: Role = isRole(roleParam) ? roleParam : "owner";

  const setMode = useCallback((nextMode: AuthMode) => navigate(toUrl({ mode: nextMode, role })), [role]);
  const setRole = useCallback((nextRole: Role) => navigate(toUrl({ mode, role: nextRole }), { replace: true }), [mode]);

  return { mode, role, setMode, setRole };
};
