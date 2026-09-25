import type { ReactNode } from "react";

import type { Role } from "@/entities/role";
import { Wordmark } from "@/shared/ui";

type AuthLayoutProps = {
  role: Role;
  visual: ReactNode;
  children: ReactNode;
};

/** Split screen: brand and illustration on the left, the form column on the right. */
export const AuthLayout = ({ role, visual, children }: AuthLayoutProps) => (
  // data-role switches the accent colour tokens for everything inside.
  <div data-role={role} className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
    <aside className="bg-surface flex flex-col max-lg:h-56 lg:sticky lg:top-0 lg:h-dvh">
      <header className="px-6 pt-6 pb-2 lg:px-8 lg:pt-8">
        <Wordmark />
      </header>
      {visual}
    </aside>

    <main className="flex justify-center px-4 pt-10 pb-16 sm:px-8 lg:items-center lg:py-16">
      <div className="w-full max-w-[26rem]">{children}</div>
    </main>
  </div>
);
