import type { FieldErrors } from "./types";

export type Rule = (value: string) => string | undefined;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const required =
  (message: string): Rule =>
  value =>
    value.trim() ? undefined : message;

export const matches =
  (pattern: RegExp, message: string): Rule =>
  value =>
    pattern.test(value.trim()) ? undefined : message;

export const minLength =
  (length: number, message: string): Rule =>
  value =>
    value.length >= length ? undefined : message;

export const firstError = (value: string, rules: Rule[]) => {
  for (const rule of rules) {
    const error = rule(value);
    if (error) return error;
  }
  return undefined;
};

export const hasErrors = <Values>(errors: FieldErrors<Values>) => Object.values(errors).some(Boolean);

export const emailRules: Rule[] = [
  required("Enter your email address."),
  matches(EMAIL_PATTERN, "Enter an email like name@example.md."),
];
