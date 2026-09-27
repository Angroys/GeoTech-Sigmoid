import { expect, test } from "bun:test";

import { ApiError } from "@/shared/api";

import { isRetryable } from "./use-tile-upload";

test("tiles rejected by the service are not uploaded again, network and server errors are", () => {
  expect(isRetryable(new ApiError("bad.tif: The file is not a TIFF image.", 422))).toBe(false);
  expect(isRetryable(new ApiError("Processing is running.", 409))).toBe(false);
  expect(isRetryable(new ApiError("offline"))).toBe(true);
  expect(isRetryable(new ApiError("upstream", 502))).toBe(true);
  expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
});
