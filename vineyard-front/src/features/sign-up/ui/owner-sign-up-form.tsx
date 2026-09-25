import { ROLE_COPY } from "@/entities/role";
import { useForm } from "@/shared/lib/form";
import { FormField, Input, PasswordInput, StatusMessage, SubmitButton } from "@/shared/ui";

import { signUp } from "../api/sign-up";
import { SIGN_UP_SUCCESS } from "../config/messages";
import type { OwnerSignUpValues } from "../model/types";
import { FISCAL_CODE_LENGTH, MIN_PASSWORD_LENGTH, validateOwnerSignUp } from "../model/validation";

const INITIAL_VALUES: OwnerSignUpValues = { fullName: "", fiscalCode: "", email: "", password: "" };

export const OwnerSignUpForm = () => {
  const { values, errors, status, setValue, handleSubmit } = useForm({
    initialValues: INITIAL_VALUES,
    validate: validateOwnerSignUp,
    submit: owner => signUp({ role: "owner", ...owner }),
    successMessage: SIGN_UP_SUCCESS.owner,
  });

  return (
    <form noValidate onSubmit={handleSubmit} className="grid gap-5">
      <FormField label="Full name" error={errors.fullName}>
        {control => (
          <Input
            {...control}
            name="fullName"
            autoComplete="name"
            value={values.fullName}
            onChange={event => setValue("fullName", event.target.value)}
          />
        )}
      </FormField>

      <FormField
        label="IDNO or IDNP"
        hint="The 13-digit fiscal code of your company or your personal code. We use it to find your parcels."
        error={errors.fiscalCode}
      >
        {control => (
          <Input
            {...control}
            name="fiscalCode"
            inputMode="numeric"
            maxLength={FISCAL_CODE_LENGTH}
            className="tabular-nums"
            value={values.fiscalCode}
            onChange={event => setValue("fiscalCode", event.target.value.replace(/\D/g, ""))}
          />
        )}
      </FormField>

      <FormField label={ROLE_COPY.owner.emailLabel} error={errors.email}>
        {control => (
          <Input
            {...control}
            name="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={event => setValue("email", event.target.value)}
          />
        )}
      </FormField>

      <FormField label="Password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} error={errors.password}>
        {control => (
          <PasswordInput
            {...control}
            name="password"
            autoComplete="new-password"
            value={values.password}
            onChange={event => setValue("password", event.target.value)}
          />
        )}
      </FormField>

      <StatusMessage status={status} />
      <SubmitButton label="Create account" isSubmitting={status.kind === "submitting"} />
    </form>
  );
};
