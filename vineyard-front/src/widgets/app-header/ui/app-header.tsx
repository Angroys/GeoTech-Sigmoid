import type { FC } from "react";

import { ROLE_COPY, type Role } from "@/entities/role";
import { useSession } from "@/entities/session";
import { SignOutButton } from "@/features/sign-out";
import { Wordmark } from "@/shared/ui";

type AppHeaderProps = { role: Role };

export const AppHeader: FC<AppHeaderProps> = ({ role }) => {
  const session = useSession();

  return (
    <header className="border-border border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-8">
        <Wordmark />
        <div className="flex items-center gap-5 text-sm">
          <p className="max-sm:hidden">
            <span className="text-primary font-medium">{ROLE_COPY[role].label}</span>
            {session && <span className="text-muted-foreground">, signed in as {session.fullName}</span>}
          </p>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
};
