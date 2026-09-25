import { ROLE_COPY, type Role } from "@/entities/role";
import { useForm } from "@/shared/lib/form";
import { FormField, Input, PasswordInput, StatusMessage, SubmitButton } from "@/shared/ui";

import { signIn } from "../api/sign-in";
import type { SignInValues } from "../model/types";
import { validateSignIn } from "../model/validation";

const INITIAL_VALUES: SignInValues = { email: "", password: "" };

type SignInFormProps = { role: Role };

export const SignInForm = ({ role }: SignInFormProps) => {
  const { values, errors, status, setValue, handleSubmit } = useForm({
    initialValues: INITIAL_VALUES,
    validate: validateSignIn,
    submit: credentials => signIn({ ...credentials, role }),
    successMessage: "Signed in.",
  });

  return (
    <form noValidate onSubmit={handleSubmit} className="grid gap-5">
      <FormField label={ROLE_COPY[role].emailLabel} error={errors.email}>
        {control => (
          <Input
            {...control}
            name="email"
            type="email"
            autoComplete="username"
            value={values.email}
            onChange={event => setValue("email", event.target.value)}
          />
        )}
      </FormField>

      <FormField label="Password" error={errors.password}>
        {control => (
          <PasswordInput
            {...control}
            name="password"
            autoComplete="current-password"
            value={values.password}
            onChange={event => setValue("password", event.target.value)}
          />
        )}
      </FormField>

      <StatusMessage status={status} />
      <SubmitButton label="Sign in" isSubmitting={status.kind === "submitting"} />
    </form>
  );
};
