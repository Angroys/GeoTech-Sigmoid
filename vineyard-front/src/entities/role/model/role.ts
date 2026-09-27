export const ROLES = ["owner", "inspector"] as const;
export type Role = (typeof ROLES)[number];

export const isRole = (value: unknown): value is Role => ROLES.some(role => role === value);
