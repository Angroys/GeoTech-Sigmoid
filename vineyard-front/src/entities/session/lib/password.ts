const SALT_BYTES = 16;

const toHex = (buffer: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");

export const createSalt = () => toHex(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));

export const hashPassword = async (password: string, salt: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${password}`));
  return toHex(digest);
};
