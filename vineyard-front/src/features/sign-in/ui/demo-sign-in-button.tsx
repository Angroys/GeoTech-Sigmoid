import { LoaderCircle } from "lucide-react";
import type { FC } from "react";

import { ROLE_COPY, type Role } from "@/entities/role";
import { Button } from "@/shared/ui";

import { useDemoSignIn } from "../model/use-demo-sign-in";

type DemoSignInButtonProps = { role: Role };

export const DemoSignInButton: FC<DemoSignInButtonProps> = ({ role }) => {
  const { state, openDemo } = useDemoSignIn(role);
  const isOpening = state.kind === "opening";

  return (
    <div className="grid gap-2">
      <Button type="button" variant="outline" size="lg" className="w-full" onClick={openDemo} disabled={isOpening}>
        {isOpening && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />}
        Try the demo as a {ROLE_COPY[role].label.toLowerCase()}
      </Button>
      <p role={state.kind === "error" ? "alert" : undefined} className="text-muted-foreground text-center text-xs">
        {state.kind === "error" ? state.message : "Uses the sample survey. Accounts are kept only in this browser."}
      </p>
    </div>
  );
};
