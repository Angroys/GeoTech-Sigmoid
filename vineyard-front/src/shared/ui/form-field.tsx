import { useId, type ReactNode } from "react";

import { Label } from "./label";

type ControlProps = {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
};

type FormFieldProps = {
  label: string;
  hint?: string;
  error?: string;
  children: (controlProps: ControlProps) => ReactNode;
};

/** Wires a label, hint and error message to whatever control it renders. */
export const FormField = ({ label, hint, error, children }: FormFieldProps) => {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  // The error replaces the hint, so only one of them describes the control at a time.
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {hint && !error && (
        <p id={hintId} className="text-muted-foreground text-[0.8125rem] leading-snug">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-destructive text-[0.8125rem] leading-snug">
          {error}
        </p>
      )}
    </div>
  );
};
