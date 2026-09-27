import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";

import { Input } from "./input";

type PasswordInputProps = Omit<ComponentProps<typeof Input>, "type">;

export const PasswordInput = (props: PasswordInputProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const ToggleIcon = isVisible ? EyeOff : Eye;

  return (
    <div className="relative">
      <Input {...props} type={isVisible ? "text" : "password"} className="pr-11" />
      <button
        type="button"
        onClick={() => setIsVisible(visible => !visible)}
        aria-label={isVisible ? "Hide password" : "Show password"}
        aria-pressed={isVisible}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md outline-none focus-visible:ring-[3px]"
      >
        <ToggleIcon className="size-[1.125rem]" aria-hidden />
      </button>
    </div>
  );
};
