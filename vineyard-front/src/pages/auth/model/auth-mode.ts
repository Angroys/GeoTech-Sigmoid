const AUTH_MODES = ["sign-in", "sign-up"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export const OTHER_MODE = { "sign-in": "sign-up", "sign-up": "sign-in" } as const satisfies Record<AuthMode, AuthMode>;
