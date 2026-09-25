export type FieldErrors<Values> = Partial<Record<keyof Values, string>>;

export type SubmitStatus =
  { kind: "idle" } | { kind: "submitting" } | { kind: "success"; message: string } | { kind: "error"; message: string };
