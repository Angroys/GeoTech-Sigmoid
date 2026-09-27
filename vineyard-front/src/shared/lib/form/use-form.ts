import { useState, type FormEvent } from "react";

import { ApiError } from "@/shared/api";

import { hasErrors } from "./rules";
import type { FieldErrors, SubmitStatus } from "./types";

type UseFormOptions<Values> = {
  initialValues: Values;
  validate: (values: Values) => FieldErrors<Values>;
  submit: (values: Values) => Promise<void>;
  successMessage: string;
  onSuccess?: (() => void) | undefined;
};

const UNEXPECTED_ERROR = "Something went wrong on our side. Try again in a minute.";

const focusFirstInvalidField = <Values>(form: HTMLFormElement, errors: FieldErrors<Values>) => {
  const firstInvalid = Object.entries(errors).find(([, message]) => Boolean(message));
  if (!firstInvalid) return;

  const field = form.elements.namedItem(firstInvalid[0]);
  if (field instanceof HTMLElement) field.focus();
};

export const useForm = <Values extends Record<string, string>>({
  initialValues,
  validate,
  submit,
  successMessage,
  onSuccess,
}: UseFormOptions<Values>) => {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<FieldErrors<Values>>({});
  const [hasAttempted, setHasAttempted] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>({ kind: "idle" });

  const setValue = <Field extends keyof Values>(field: Field, value: Values[Field]) => {
    const nextValues = { ...values, [field]: value };
    setValues(nextValues);
    if (hasAttempted) setErrors(validate(nextValues));
    if (status.kind === "error") setStatus({ kind: "idle" });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setHasAttempted(true);

    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) {
      focusFirstInvalidField(event.currentTarget, nextErrors);
      return;
    }

    setStatus({ kind: "submitting" });
    try {
      await submit(values);
      setStatus({ kind: "success", message: successMessage });
      onSuccess?.();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : UNEXPECTED_ERROR;
      setStatus({ kind: "error", message });
    }
  };

  return { values, errors, status, setValue, handleSubmit };
};
