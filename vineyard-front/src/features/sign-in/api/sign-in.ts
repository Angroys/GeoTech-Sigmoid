import type { Role } from "@/entities/role";
import { postJson } from "@/shared/api";

import type { SignInValues } from "../model/types";

type SignInRequest = SignInValues & { role: Role };

export const signIn = (request: SignInRequest) => postJson("/api/auth/sign-in", request);
