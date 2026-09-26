import { registerInspector, registerOwner } from "@/entities/session";
import { ApiError } from "@/shared/api";

import type { InspectorSignUpValues, OwnerSignUpValues } from "../model/types";

export const signUpOwner = async (values: OwnerSignUpValues) => {
  await registerOwner(values);
};

export const signUpInspector = async ({ agency, ...values }: InspectorSignUpValues) => {
  if (agency === "") throw new ApiError("Choose the agency you work for.");
  await registerInspector({ ...values, agency });
};
