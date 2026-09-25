import { useCallback, useEffect, useState } from "react";

import { isRole, type Role } from "@/entities/role";

import type { AuthMode } from "./auth-mode";

const PATH_BY_MODE = { "sign-in": "/sign-in", "sign-up": "/sign-up" } as const satisfies Record<AuthMode, string>;

type AuthLocation = { mode: AuthMode; role: Role };

const readLocation = (): AuthLocation => {
  const role = new URLSearchParams(window.location.search).get("role");
  return {
    mode: window.location.pathname === PATH_BY_MODE["sign-up"] ? "sign-up" : "sign-in",
    role: isRole(role) ? role : "owner",
  };
};

const toUrl = ({ mode, role }: AuthLocation) => `${PATH_BY_MODE[mode]}?role=${role}`;

/** Keeps the auth screen and role in the URL so a link can open, say, inspector sign-up directly. */
export const useAuthLocation = () => {
  const [location, setLocation] = useState(readLocation);

  useEffect(() => {
    const syncFromHistory = () => setLocation(readLocation());
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);

  const navigate = useCallback((next: AuthLocation, historyMode: "push" | "replace") => {
    const url = toUrl(next);
    if (historyMode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
    setLocation(next);
  }, []);

  const setMode = useCallback((mode: AuthMode) => navigate({ ...location, mode }, "push"), [location, navigate]);
  const setRole = useCallback((role: Role) => navigate({ ...location, role }, "replace"), [location, navigate]);

  return { ...location, setMode, setRole };
};
