export class ApiError extends Error {
  override name = "ApiError";

  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}
