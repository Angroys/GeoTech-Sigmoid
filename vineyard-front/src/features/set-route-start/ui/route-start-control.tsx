import type { Position } from "geojson";
import { Hourglass, MapPin } from "lucide-react";
import { useState, type FC } from "react";

import { formatMetres } from "@/shared/lib/format";
import { formatLngLat } from "@/shared/lib/geo";
import { LinkButton } from "@/shared/ui";

import { distanceBetweenM } from "../model/distance-from-start";
import type { RouteStartRequest } from "../model/use-route-start";
import { RouteStartForm } from "./route-start-form";

type VineyardStartProps = { vineyardStart: Position; onChange: () => void };

const VineyardStart: FC<VineyardStartProps> = ({ vineyardStart, onChange }) => {
  return (
    <div className="flex items-start gap-3">
      <span className="border-primary mt-1 size-3 shrink-0 rounded-full border-[3px]" aria-hidden />
      <p className="min-w-0 flex-1 text-sm leading-snug">
        Starts and ends at the vineyard's starting point,{" "}
        <span className="tabular-nums whitespace-nowrap">{formatLngLat(vineyardStart)}</span>.
      </p>
      <LinkButton onClick={onChange}>Start elsewhere</LinkButton>
    </div>
  );
};

type RequestedStartProps = {
  vineyardStart: Position;
  request: RouteStartRequest;
  onChange: () => void;
  onClear: () => void;
};

const RequestedStart: FC<RequestedStartProps> = ({ vineyardStart, request, onChange, onClear }) => {
  const distanceM = distanceBetweenM(request.lngLat, vineyardStart);

  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-3">
        <MapPin className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 text-sm leading-snug">
          <span className="block font-medium">Your starting point</span>
          <span className="text-muted-foreground">
            <span className="text-foreground tabular-nums">{formatLngLat(request.lngLat)}</span>,{" "}
            {formatMetres(distanceM)} from the vineyard's starting point.
          </span>
        </p>
      </div>
      <p className="bg-muted text-muted-foreground flex gap-2.5 rounded-md px-3 py-2.5 text-sm leading-snug">
        <Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden />
        The route from your point is being planned. Until it is ready, the stops below begin at the vineyard's
        starting point.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 pl-7">
        <LinkButton onClick={onChange}>Change</LinkButton>
        <LinkButton onClick={onClear}>Use the vineyard's starting point</LinkButton>
      </div>
    </div>
  );
};

type RouteStartControlProps = {
  vineyardStart: Position;
  request: RouteStartRequest | null;
  onRequest: (lngLat: Position) => void;
  onClear: () => void;
};

export const RouteStartControl: FC<RouteStartControlProps> = ({ vineyardStart, request, onRequest, onClear }) => {
  const [isEditing, setIsEditing] = useState(false);

  const plan = (lngLat: Position) => {
    onRequest(lngLat);
    setIsEditing(false);
  };

  const edit = () => setIsEditing(true);

  const renderContent = () => {
    if (isEditing) {
      return <RouteStartForm vineyardStart={vineyardStart} onPlan={plan} onCancel={() => setIsEditing(false)} />;
    }
    if (request) {
      return <RequestedStart vineyardStart={vineyardStart} request={request} onChange={edit} onClear={onClear} />;
    }
    return <VineyardStart vineyardStart={vineyardStart} onChange={edit} />;
  };

  return <div className="border-border mb-6 border-b pb-5">{renderContent()}</div>;
};
