import type { FC } from "react";

import { FEATURE_COLORS } from "@/entities/survey";
import { formatMetres } from "@/shared/lib/format";

import type { RouteDrawing } from "../lib/route-drawing";

type RouteFigureProps = { drawing: RouteDrawing };

export const RouteFigure: FC<RouteFigureProps> = ({ drawing }) => {
  const { unit, scaleBar } = drawing;

  return (
    <figure className="break-inside-avoid">
      <svg
        viewBox={drawing.viewBox}
        role="img"
        aria-label="Walking route with numbered stops and vineyard block outlines"
        className="max-h-[120mm] w-full border border-black/20 bg-white"
      >
        {drawing.blocks.map((path, index) => (
          <path key={index} d={path} fill="#eef3ea" stroke="#5c665f" strokeWidth={unit * 0.25} strokeDasharray={`${unit} ${unit * 0.6}`} />
        ))}
        {drawing.route && (
          <path
            d={drawing.route}
            fill="none"
            stroke={FEATURE_COLORS.route}
            strokeWidth={unit * 0.45}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        <circle cx={drawing.start.x} cy={drawing.start.y} r={unit * 1.4} fill="#ffffff" stroke={FEATURE_COLORS.route} strokeWidth={unit * 0.5} />
        {drawing.stops.map(stop => (
          <g key={stop.order}>
            <circle cx={stop.x} cy={stop.y} r={unit * 1.7} fill="#1d2420" />
            <text
              x={stop.x}
              y={stop.y}
              fill="#ffffff"
              fontSize={unit * 1.9}
              fontWeight={600}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {stop.order}
            </text>
          </g>
        ))}
        <g>
          <line
            x1={scaleBar.x}
            y1={scaleBar.y}
            x2={scaleBar.x + scaleBar.lengthM}
            y2={scaleBar.y}
            stroke="#1d2420"
            strokeWidth={unit * 0.4}
          />
          <text x={scaleBar.x} y={scaleBar.y - unit * 1.2} fontSize={unit * 2} fill="#1d2420">
            {formatMetres(scaleBar.lengthM)}
          </text>
        </g>
      </svg>
      <figcaption className="mt-1.5 text-xs text-black/55">
        Traseul de inspecție / Inspection route, EPSG:32635. Open circle: start and finish. Numbers: stop order.
      </figcaption>
    </figure>
  );
};
