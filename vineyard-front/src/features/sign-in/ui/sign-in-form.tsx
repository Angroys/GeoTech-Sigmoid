import type { FC } from "react";

import { ROLE_COPY, type Role } from "@/entities/role";
import { useForm } from "@/shared/lib/form";
import { PasswordField, StatusMessage, SubmitButton, TextField } from "@/shared/ui";

import { signIn } from "../api/sign-in";
import type { SignInValues } from "../model/types";
import { validateSignIn } from "../model/validation";

const INITIAL_VALUES: SignInValues = { email: "", password: "" };

type SignInFormProps = { role: Role };

export const SignInForm: FC<SignInFormProps> = ({ role }) => {
  const { values, errors, status, setValue, handleSubmit } = useForm({
    initialValues: INITIAL_VALUES,
    validate: validateSignIn,
    submit: credentials => signIn(credentials, role),
    successMessage: "Signed in. Opening your survey.",
  });

  return (
    <form noValidate onSubmit={handleSubmit} className="grid gap-5">
      <TextField
        label={ROLE_COPY[role].emailLabel}
        error={errors.email}
        name="email"
        type="email"
        autoComplete="username"
        value={values.email}
        onValueChange={value => setValue("email", value)}
      />
      <PasswordField
        label="Password"
        error={errors.password}
        name="password"
        autoComplete="current-password"
        value={values.password}
        onValueChange={value => setValue("password", value)}
      />

      <StatusMessage status={status} />
      <SubmitButton label="Sign in" isSubmitting={status.kind === "submitting"} />
    </form>
  );
};
