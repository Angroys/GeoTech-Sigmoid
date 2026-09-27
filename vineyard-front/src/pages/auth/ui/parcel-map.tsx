import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useRef } from "react";

import type { Role } from "@/entities/role";

import { MAP_HEIGHT, MAP_WIDTH, PARCEL_FOCUS, PARCELS } from "../model/parcels";

gsap.registerPlugin(useGSAP);

const OUTLINE_DRAW_SECONDS = 1.1;
const ROWS_DRAW_SECONDS = 1.6;
const HIGHLIGHT_FADE_SECONDS = 0.45;
const DRAW_EASE = "power2.inOut";

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type ParcelMapProps = { role: Role };

export const ParcelMap = ({ role }: ParcelMapProps) => {
  const container = useRef<HTMLDivElement>(null);
  const intro = useRef<gsap.core.Timeline | null>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;

      intro.current = gsap
        .timeline({ defaults: { ease: DRAW_EASE } })
        .from(".parcel-outline", { strokeDashoffset: 1, duration: OUTLINE_DRAW_SECONDS, stagger: 0.08 })
        .from(
          ".parcel-row",
          { strokeDashoffset: 1, duration: 0.5, stagger: { amount: ROWS_DRAW_SECONDS, from: "start" } },
          "-=0.5",
        )
        .from(".map-legend", { autoAlpha: 0, y: 6, duration: 0.4, ease: "power2.out" }, "-=0.2");
    },
    { scope: container },
  );

  useGSAP(
    () => {
      const activeId = PARCEL_FOCUS[role].parcelId;
      const introTimeLeft = intro.current ? intro.current.duration() - intro.current.time() : 0;
      const duration = prefersReducedMotion() ? 0 : HIGHLIGHT_FADE_SECONDS;

      gsap.to(".parcel-highlight", {
        autoAlpha: (_index: number, target: Element) => (target.getAttribute("data-parcel-id") === activeId ? 1 : 0),
        duration,
        delay: introTimeLeft,
        ease: "power1.out",
        overwrite: "auto",
      });
    },
    { scope: container, dependencies: [role], revertOnUpdate: false },
  );

  const focus = PARCEL_FOCUS[role];

  return (
    <div ref={container} className="relative flex min-h-0 flex-1 flex-col">
      <svg
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
        className="text-primary min-h-0 w-full flex-1"
        role="img"
        aria-label="Plan of six registered vineyard parcels with their vine rows"
      >
        <defs>
          {PARCELS.map(parcel => (
            <clipPath key={parcel.id} id={`clip-${parcel.id}`}>
              <polygon points={parcel.points} />
            </clipPath>
          ))}
        </defs>

        {PARCELS.map(parcel => (
          <g key={parcel.id}>
            <g clipPath={`url(#clip-${parcel.id})`} stroke="#b4bdb6" strokeWidth={1.1} strokeLinecap="round">
              {parcel.rows.map(row => (
                <line key={`${row.x1}-${row.y1}`} className="parcel-row" {...row} pathLength={1} strokeDasharray={1} />
              ))}
            </g>

            <polygon
              className="parcel-highlight invisible opacity-0"
              data-parcel-id={parcel.id}
              points={parcel.points}
              fill="currentColor"
              fillOpacity={0.14}
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />

            <polygon
              className="parcel-outline"
              points={parcel.points}
              fill="none"
              stroke="#8f9a92"
              strokeWidth={1.25}
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray={1}
            />
          </g>
        ))}
      </svg>

      <p className="map-legend text-muted-foreground flex items-baseline gap-2.5 px-8 pt-4 pb-8 text-sm max-lg:hidden">
        <span className="bg-primary size-2.5 shrink-0 rounded-full" aria-hidden />
        <span>
          <span className="text-foreground font-medium">{focus.title}</span>
          <span className="block tabular-nums">{focus.detail}</span>
        </span>
      </p>
    </div>
  );
};
