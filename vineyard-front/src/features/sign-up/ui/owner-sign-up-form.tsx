import type { FC } from "react";

import { ROLE_COPY } from "@/entities/role";
import { useForm } from "@/shared/lib/form";
import { PasswordField, StatusMessage, SubmitButton, TextField } from "@/shared/ui";

import { signUpOwner } from "../api/sign-up";
import { SIGN_UP_SUCCESS } from "../config/messages";
import type { OwnerSignUpValues } from "../model/types";
import { FISCAL_CODE_LENGTH, MIN_PASSWORD_LENGTH, validateOwnerSignUp } from "../model/validation";

const INITIAL_VALUES: OwnerSignUpValues = { fullName: "", fiscalCode: "", email: "", password: "" };

const digitsOnly = (value: string) => value.replace(/\D/g, "");

export const OwnerSignUpForm: FC = () => {
  const { values, errors, status, setValue, handleSubmit } = useForm({
    initialValues: INITIAL_VALUES,
    validate: validateOwnerSignUp,
    submit: signUpOwner,
    successMessage: SIGN_UP_SUCCESS.owner,
  });

  return (
    <form noValidate onSubmit={handleSubmit} className="grid gap-5">
      <TextField
        label="Full name"
        error={errors.fullName}
        name="fullName"
        autoComplete="name"
        value={values.fullName}
        onValueChange={value => setValue("fullName", value)}
      />
      <TextField
        label="IDNO or IDNP"
        hint="The 13-digit fiscal code of your company or your personal code. We use it to find your parcels."
        error={errors.fiscalCode}
        name="fiscalCode"
        inputMode="numeric"
        maxLength={FISCAL_CODE_LENGTH}
        className="tabular-nums"
        value={values.fiscalCode}
        onValueChange={value => setValue("fiscalCode", digitsOnly(value))}
      />
      <TextField
        label={ROLE_COPY.owner.emailLabel}
        error={errors.email}
        name="email"
        type="email"
        autoComplete="email"
        value={values.email}
        onValueChange={value => setValue("email", value)}
      />
      <PasswordField
        label="Password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        error={errors.password}
        name="password"
        autoComplete="new-password"
        value={values.password}
        onValueChange={value => setValue("password", value)}
      />

      <StatusMessage status={status} />
      <SubmitButton label="Create account" isSubmitting={status.kind === "submitting"} />
    </form>
  );
};
