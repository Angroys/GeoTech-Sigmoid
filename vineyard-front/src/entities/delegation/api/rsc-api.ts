import { ApiError } from "@/shared/api";

import { demoDelegationRecords } from "../config/demo-delegations";
import { delegationDtoSchema, delegationListSchema, type DelegationDto } from "../model/schema";
import type { Delegation, DelegationSource } from "../model/types";

const API_BASE = "/api/rsc/delegations";
const SERVICE_UNAVAILABLE = 503;
const NOT_FOUND = 404;

export type DelegationList = { delegations: Delegation[]; source: DelegationSource };
export type DelegationLookup = { delegation: Delegation | null; source: DelegationSource };

const toDelegation = (dto: DelegationDto, isDemo: boolean): Delegation => ({
  number: dto.number,
  rscNumber: dto.rsc_number,
  controlBody: dto.control_body,
  controlType: dto.control_type,
  legalBasis: dto.legal_basis,
  purpose: dto.purpose,
  checklist: dto.checklist,
  operator: dto.operator,
  inspectors: dto.inspectors.map(inspector => ({ fullName: inspector.full_name, badgeNumber: inspector.badge_number })),
  startDate: dto.start_date,
  durationDays: dto.duration_days,
  status: dto.status,
  isDemo,
});

const demoDelegations = () => demoDelegationRecords().map(record => toDelegation(delegationDtoSchema.parse(record), true));

const request = async (path: string): Promise<Response | null> => {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`);
  } catch {
    throw new ApiError("The State Register of Controls could not be reached. Check your connection and try again.");
  }
  if (response.status === SERVICE_UNAVAILABLE) return null;
  if (response.status === NOT_FOUND || response.ok) return response;
  throw new ApiError(`The State Register of Controls answered HTTP ${response.status}.`, response.status);
};

const isAssignedTo = (badgeNumber: string) => (delegation: Delegation) =>
  delegation.inspectors.some(inspector => inspector.badgeNumber === badgeNumber);

export const listInspectorDelegations = async (badgeNumber: string): Promise<DelegationList> => {
  const response = await request(`?inspector=${encodeURIComponent(badgeNumber)}`);
  if (!response) return { delegations: demoDelegations().filter(isAssignedTo(badgeNumber)), source: "demo" };
  const body = delegationListSchema.parse(await response.json());
  return { delegations: body.delegations.map(dto => toDelegation(dto, false)), source: "rsc" };
};

export const findDelegation = async (number: string): Promise<DelegationLookup> => {
  const response = await request(`/${encodeURIComponent(number)}`);
  if (!response) {
    return { delegation: demoDelegations().find(delegation => delegation.number === number) ?? null, source: "demo" };
  }
  if (response.status === NOT_FOUND) return { delegation: null, source: "rsc" };
  return { delegation: toDelegation(delegationDtoSchema.parse(await response.json()), false), source: "rsc" };
};
