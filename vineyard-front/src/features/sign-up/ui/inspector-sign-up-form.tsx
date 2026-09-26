import { ChevronDown } from "lucide-react";

import { AGENCIES, toAgency } from "@/entities/agency";
import { ROLE_COPY } from "@/entities/role";
import { cn } from "@/shared/lib/cn";
import { useForm } from "@/shared/lib/form";
import { FormField, Input, PasswordInput, StatusMessage, SubmitButton } from "@/shared/ui";

import { signUpInspector } from "../api/sign-up";
import { SIGN_UP_SUCCESS } from "../config/messages";
import type { InspectorSignUpValues } from "../model/types";
import { MIN_PASSWORD_LENGTH, validateInspectorSignUp } from "../model/validation";

const INITIAL_VALUES: InspectorSignUpValues = { fullName: "", agency: "", badgeNumber: "", email: "", password: "" };

export const InspectorSignUpForm = () => {
  const { values, errors, status, setValue, handleSubmit } = useForm({
    initialValues: INITIAL_VALUES,
    validate: validateInspectorSignUp,
    submit: signUpInspector,
    successMessage: SIGN_UP_SUCCESS.inspector,
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

      <FormField label="Agency" error={errors.agency}>
        {control => (
          <div className="relative">
            <select
              {...control}
              name="agency"
              value={values.agency}
              onChange={event => setValue("agency", toAgency(event.target.value))}
              className={cn(
                "border-input bg-popover focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 h-11 w-full appearance-none rounded-md border px-3 pr-10 text-base shadow-xs outline-none focus-visible:ring-[3px] md:text-sm [&>option]:text-foreground",
                values.agency === "" && "text-muted-foreground",
              )}
            >
              <option value="" disabled>
                Choose your agency
              </option>
              {AGENCIES.map(agency => (
                <option key={agency.value} value={agency.value}>
                  {agency.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="text-muted-foreground pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2"
              aria-hidden
            />
          </div>
        )}
      </FormField>

      <FormField
        label="Badge number"
        hint="As printed on your service badge, for example ANSA-0417."
        error={errors.badgeNumber}
      >
        {control => (
          <Input
            {...control}
            name="badgeNumber"
            autoCapitalize="characters"
            className="tabular-nums uppercase"
            value={values.badgeNumber}
            onChange={event => setValue("badgeNumber", event.target.value.toUpperCase())}
          />
        )}
      </FormField>

      <FormField label={ROLE_COPY.inspector.emailLabel} error={errors.email}>
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

      <p className="text-muted-foreground text-sm leading-relaxed">
        Your agency confirms new inspector accounts before the first sign-in.
      </p>

      <StatusMessage status={status} />
      <SubmitButton label="Request access" isSubmitting={status.kind === "submitting"} />
    </form>
  );
};
