import type { ComponentProps, FC, MouseEvent } from "react";

import { navigate } from "@/shared/lib/router";

type AppLinkProps = Omit<ComponentProps<"a">, "href"> & { href: string };

export const AppLink: FC<AppLinkProps> = ({ href, onClick, ...props }) => {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    const isPlainClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (event.defaultPrevented || !isPlainClick) return;
    event.preventDefault();
    navigate(href);
  };

  return <a href={href} onClick={handleClick} {...props} />;
};
