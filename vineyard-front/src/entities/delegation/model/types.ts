import type { DelegationDto, DelegationNumber } from "./schema";

export type ControlType = DelegationDto["control_type"];
export type DelegationStatus = DelegationDto["status"];

export type Delegation = {
  number: DelegationNumber;
  rscNumber: string;
  controlBody: string;
  controlType: ControlType;
  legalBasis: string;
  purpose: string;
  checklist: string;
  operator: { name: string; idno: string };
  inspectors: { fullName: string; badgeNumber: string }[];
  startDate: string;
  durationDays: number;
  status: DelegationStatus;
  isDemo: boolean;
};

export type DelegationSource = "rsc" | "demo";
