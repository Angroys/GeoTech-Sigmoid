import type { Role } from "@/entities/role";
import { signInWithPassword } from "@/entities/session";

import type { SignInValues } from "../model/types";

export const signIn = async (values: SignInValues, role: Role) => {
  await signInWithPassword({ ...values, role });
};
