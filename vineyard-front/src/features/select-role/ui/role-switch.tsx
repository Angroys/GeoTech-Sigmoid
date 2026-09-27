import { ROLE_COPY, ROLES, type Role } from "@/entities/role";

type RoleSwitchProps = {
  role: Role;
  onChange: (role: Role) => void;
};

export const RoleSwitch = ({ role, onChange }: RoleSwitchProps) => (
  <fieldset className="grid gap-2">
    <legend className="mb-2 text-sm font-medium">I am a</legend>
    <div className="bg-muted grid grid-cols-2 gap-1 rounded-lg p-1">
      {ROLES.map(option => (
        <label
          key={option}
          className="text-muted-foreground has-[:checked]:bg-popover has-[:checked]:text-foreground has-[:focus-visible]:ring-ring/50 relative cursor-pointer rounded-md px-3 py-2.5 text-center text-sm font-medium transition-colors has-[:checked]:shadow-[0_1px_2px_rgb(29_36_32/0.08)] has-[:focus-visible]:ring-[3px]"
        >
          <input
            type="radio"
            name="role"
            value={option}
            checked={role === option}
            onChange={() => onChange(option)}
            className="sr-only"
          />
          {ROLE_COPY[option].label}
        </label>
      ))}
    </div>
  </fieldset>
);
