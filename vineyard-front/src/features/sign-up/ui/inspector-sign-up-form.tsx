import type { FC } from "react";

import { ROLE_COPY } from "@/entities/role";
import { useForm } from "@/shared/lib/form";
import { PasswordField, StatusMessage, SubmitButton, TextField } from "@/shared/ui";

import { signUpInspector } from "../api/sign-up";
import { SIGN_UP_SUCCESS } from "../config/messages";
import type { InspectorSignUpValues } from "../model/types";
import { MIN_PASSWORD_LENGTH, validateInspectorSignUp } from "../model/validation";
import { AgencySelect } from "./agency-select";

const INITIAL_VALUES: InspectorSignUpValues = { fullName: "", agency: "", badgeNumber: "", email: "", password: "" };

export const InspectorSignUpForm: FC = () => {
  const { values, errors, status, setValue, handleSubmit } = useForm({
    initialValues: INITIAL_VALUES,
    validate: validateInspectorSignUp,
    submit: signUpInspector,
    successMessage: SIGN_UP_SUCCESS.inspector,
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
      <AgencySelect value={values.agency} error={errors.agency} onChange={agency => setValue("agency", agency)} />
      <TextField
        label="Badge number"
        hint="As printed on your service badge, for example ANSA-0417."
        error={errors.badgeNumber}
        name="badgeNumber"
        autoCapitalize="characters"
        className="tabular-nums uppercase"
        value={values.badgeNumber}
        onValueChange={value => setValue("badgeNumber", value.toUpperCase())}
      />
      <TextField
        label={ROLE_COPY.inspector.emailLabel}
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

      <p className="text-muted-foreground text-sm leading-relaxed">
        Your agency confirms new inspector accounts before the first sign-in.
      </p>

      <StatusMessage status={status} />
      <SubmitButton label="Request access" isSubmitting={status.kind === "submitting"} />
    </form>
  );
};
