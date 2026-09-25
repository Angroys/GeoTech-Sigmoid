import type { Role } from "@/entities/role";

import { InspectorSignUpForm } from "./inspector-sign-up-form";
import { OwnerSignUpForm } from "./owner-sign-up-form";

type SignUpFormProps = { role: Role };

/** Each role registers with different details, so each gets its own form. */
export const SignUpForm = ({ role }: SignUpFormProps) =>
  role === "owner" ? <OwnerSignUpForm /> : <InspectorSignUpForm />;
