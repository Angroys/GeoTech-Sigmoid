import type { Agency } from "@/entities/agency";

export type OwnerSignUpValues = {
  fullName: string;
  fiscalCode: string;
  email: string;
  password: string;
};

export type InspectorSignUpValues = {
  fullName: string;
  agency: Agency | "";
  badgeNumber: string;
  email: string;
  password: string;
};
