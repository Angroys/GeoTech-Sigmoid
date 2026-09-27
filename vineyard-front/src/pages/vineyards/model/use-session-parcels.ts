import { useOwnerParcels } from "@/entities/parcel";
import { useSession } from "@/entities/session";

export const useSessionParcels = () => {
  const session = useSession();
  const fiscalCode = session?.owner?.fiscalCode ?? null;
  return { fiscalCode, state: useOwnerParcels(fiscalCode) };
};
