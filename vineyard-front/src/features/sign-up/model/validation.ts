import { emailRules, firstError, matches, minLength, required, type FieldErrors } from "@/shared/lib/form";

import type { InspectorSignUpValues, OwnerSignUpValues } from "./types";

export const MIN_PASSWORD_LENGTH = 8;
export const FISCAL_CODE_LENGTH = 13;

const FISCAL_CODE_PATTERN = new RegExp(`^[0-9]{${FISCAL_CODE_LENGTH}}$`);
const BADGE_NUMBER_PATTERN = /^[A-Z]{2,4}-\d{3,6}$/;

const newPasswordRules = [
  required("Create a password."),
  minLength(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`),
];

const fullNameRules = [required("Enter your full name as it appears on your ID.")];

export const validateOwnerSignUp = (values: OwnerSignUpValues): FieldErrors<OwnerSignUpValues> => ({
  fullName: firstError(values.fullName, fullNameRules),
  fiscalCode: firstError(values.fiscalCode, [
    required("Enter your IDNO or IDNP."),
    matches(FISCAL_CODE_PATTERN, `The code has exactly ${FISCAL_CODE_LENGTH} digits.`),
  ]),
  email: firstError(values.email, emailRules),
  password: firstError(values.password, newPasswordRules),
});

export const validateInspectorSignUp = (values: InspectorSignUpValues): FieldErrors<InspectorSignUpValues> => ({
  fullName: firstError(values.fullName, fullNameRules),
  agency: firstError(values.agency, [required("Choose the agency you work for.")]),
  badgeNumber: firstError(values.badgeNumber.toUpperCase(), [
    required("Enter your badge number."),
    matches(BADGE_NUMBER_PATTERN, "Use the format on your badge, for example ANSA-0417."),
  ]),
  email: firstError(values.email, emailRules),
  password: firstError(values.password, newPasswordRules),
});
