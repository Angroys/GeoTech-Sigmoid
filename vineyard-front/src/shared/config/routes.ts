export const ROUTES = {
  signIn: "/sign-in",
  signUp: "/sign-up",
  owner: "/owner",
  inspector: "/inspector",
  addVineyard: "/owner/new",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

export const ADD_VINEYARD_SEGMENT = "new";
