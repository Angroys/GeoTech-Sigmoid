import type { FC } from "react";

import { RoleSwitch } from "@/features/select-role";
import { DemoSignInButton, SignInForm } from "@/features/sign-in";
import { SignUpForm } from "@/features/sign-up";
import { ParcelMap } from "@/widgets/parcel-map";

import { MODE_COPY, ROLE_HEADLINE } from "../config/copy";
import { OTHER_MODE } from "../model/auth-mode";
import { useAuthLocation } from "../model/use-auth-location";
import { AuthLayout } from "./auth-layout";

export const AuthPage: FC = () => {
  const { mode, role, setMode, setRole } = useAuthLocation();
  const copy = MODE_COPY[mode];

  return (
    <AuthLayout role={role} visual={<ParcelMap role={role} />}>
      <h1 className="text-[2rem] leading-tight font-semibold tracking-[-0.02em] text-balance">{copy.title}</h1>
      <p className="text-muted-foreground mt-3 max-w-[36ch] text-[0.9375rem] leading-relaxed text-pretty">
        {ROLE_HEADLINE[role]}
      </p>

      <div className="mt-8">
        <RoleSwitch role={role} onChange={setRole} />
      </div>

      <div className="mt-6">{mode === "sign-in" ? <SignInForm role={role} /> : <SignUpForm role={role} />}</div>

      {mode === "sign-in" && (
        <div className="border-border mt-6 border-t pt-6">
          <DemoSignInButton role={role} />
        </div>
      )}

      <p className="text-muted-foreground mt-8 text-sm">
        {copy.switchPrompt}{" "}
        <button
          type="button"
          onClick={() => setMode(OTHER_MODE[mode])}
          className="text-primary focus-visible:ring-ring/50 rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]"
        >
          {copy.switchAction}
        </button>
      </p>
    </AuthLayout>
  );
};
