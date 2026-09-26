import { useState } from "react";

import type { Role } from "@/entities/role";
import { signInAsDemo } from "@/entities/session";
import { ApiError } from "@/shared/api";

type DemoSignInState = { kind: "idle" } | { kind: "opening" } | { kind: "error"; message: string };

const UNEXPECTED_ERROR = "The demo could not be opened. Reload the page and try again.";

export const useDemoSignIn = (role: Role) => {
  const [state, setState] = useState<DemoSignInState>({ kind: "idle" });

  const openDemo = async () => {
    setState({ kind: "opening" });
    try {
      await signInAsDemo(role);
    } catch (error) {
      setState({ kind: "error", message: error instanceof ApiError ? error.message : UNEXPECTED_ERROR });
    }
  };

  return { state, openDemo };
};
