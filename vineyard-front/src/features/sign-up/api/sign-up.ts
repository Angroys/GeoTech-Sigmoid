import { postJson } from "@/shared/api";

import type { InspectorSignUpValues, OwnerSignUpValues } from "../model/types";

type SignUpRequest = ({ role: "owner" } & OwnerSignUpValues) | ({ role: "inspector" } & InspectorSignUpValues);

export const signUp = (request: SignUpRequest) => postJson("/api/auth/sign-up", request);
