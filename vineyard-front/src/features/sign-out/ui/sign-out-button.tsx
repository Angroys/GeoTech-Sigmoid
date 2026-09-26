import type { FC } from "react";

import { signOut } from "@/entities/session";

export const SignOutButton: FC = () => {
  return (
    <button
      type="button"
      onClick={signOut}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-sm text-sm outline-none focus-visible:ring-[3px]"
    >
      Sign out
    </button>
  );
};
