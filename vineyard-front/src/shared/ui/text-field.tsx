import type { ComponentProps, FC } from "react";

import { FormField } from "./form-field";
import { Input } from "./input";
import { PasswordInput } from "./password-input";

type FieldTextProps = {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  value: string;
  onValueChange: (value: string) => void;
};

type TextFieldProps = FieldTextProps & Omit<ComponentProps<typeof Input>, "value" | "onChange" | "id">;

export const TextField: FC<TextFieldProps> = ({ label, hint, error, value, onValueChange, ...inputProps }) => {
  return (
    <FormField label={label} hint={hint} error={error}>
      {control => (
        <Input {...inputProps} {...control} value={value} onChange={event => onValueChange(event.target.value)} />
      )}
    </FormField>
  );
};

type PasswordFieldProps = FieldTextProps & Omit<ComponentProps<typeof PasswordInput>, "value" | "onChange" | "id">;

export const PasswordField: FC<PasswordFieldProps> = ({ label, hint, error, value, onValueChange, ...inputProps }) => {
  return (
    <FormField label={label} hint={hint} error={error}>
      {control => (
        <PasswordInput
          {...inputProps}
          {...control}
          value={value}
          onChange={event => onValueChange(event.target.value)}
        />
      )}
    </FormField>
  );
};
