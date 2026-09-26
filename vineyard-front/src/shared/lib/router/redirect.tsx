import { useEffect, type FC } from "react";

import { navigate } from "./router";

type RedirectProps = { to: string };

export const Redirect: FC<RedirectProps> = ({ to }) => {
  useEffect(() => {
    navigate(to, { replace: true });
  }, [to]);

  return null;
};
