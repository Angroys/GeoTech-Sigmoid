import { emailRules, firstError, required, type FieldErrors } from "@/shared/lib/form";

import type { SignInValues } from "./types";

export const validateSignIn = (values: SignInValues): FieldErrors<SignInValues> => ({
  email: firstError(values.email, emailRules),
  password: firstError(values.password, [required("Enter your password.")]),
});
