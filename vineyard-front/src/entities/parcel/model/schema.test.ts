import { expect, test } from "bun:test";

import { cadastralNumberSchema } from "./schema";

test("accepts the 10- and 11-digit cadastral numbers used in Moldova", () => {
  expect(cadastralNumberSchema.safeParse("3631204101").success).toBe(true);
  expect(cadastralNumberSchema.safeParse("80371140111").success).toBe(true);
});

test("rejects numbers of any other length or with letters", () => {
  expect(cadastralNumberSchema.safeParse("123456789").success).toBe(false);
  expect(cadastralNumberSchema.safeParse("803711401112").success).toBe(false);
  expect(cadastralNumberSchema.safeParse("80371140A11").success).toBe(false);
});
