import { LoaderCircle } from "lucide-react";

import { Button } from "./button";

type SubmitButtonProps = {
  label: string;
  isSubmitting: boolean;
};

export const SubmitButton = ({ label, isSubmitting }: SubmitButtonProps) => (
  <Button type="submit" size="lg" className="w-full" disabled={isSubmitting} aria-busy={isSubmitting}>
    {isSubmitting && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />}
    {label}
  </Button>
);
