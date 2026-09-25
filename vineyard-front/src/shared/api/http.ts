export class ApiError extends Error {
  override name = "ApiError";
}

const UNREACHABLE_MESSAGE = "The register is not responding. Check your connection and try again.";

const hasMessage = (body: unknown): body is { message: string } =>
  typeof body === "object" && body !== null && "message" in body && typeof body.message === "string";

const readErrorMessage = async (response: Response) => {
  try {
    const body: unknown = await response.json();
    return hasMessage(body) ? body.message : UNREACHABLE_MESSAGE;
  } catch {
    return UNREACHABLE_MESSAGE;
  }
};

/** Posts JSON and throws an ApiError with a message that is safe to show to the user. */
export const postJson = async (url: string, payload: object) => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError(UNREACHABLE_MESSAGE);
  }

  if (!response.ok) throw new ApiError(await readErrorMessage(response));
};
