export type FieldErrors<Values> = { [Field in keyof Values]?: string | undefined };

export type SubmitStatus =
  { kind: "idle" } | { kind: "submitting" } | { kind: "success"; message: string } | { kind: "error"; message: string };
