import { expect, test } from "bun:test";

import { randomUUID, sha256Fallback } from ".";

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");

test("SHA-256 fallback matches WebCrypto", async () => {
  for (const text of ["", "abc", "salt:password", "x".repeat(200)]) {
    const data = new TextEncoder().encode(text);
    expect(hex(sha256Fallback(data))).toBe(hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data))));
  }
});

test("randomUUID works without crypto.randomUUID", () => {
  const original = crypto.randomUUID;
  // @ts-expect-error simulate an insecure (plain-HTTP LAN) context
  crypto.randomUUID = undefined;
  try {
    expect(randomUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    crypto.randomUUID = original;
  }
});
