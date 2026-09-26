import type { FC } from "react";

import type { RoutePurpose, Survey, SurveySelection, TargetId } from "@/entities/survey";
import type { RouteProgressState } from "@/features/track-route-progress";

import { useRevealedStop } from "../model/use-revealed-stop";
import { useRoutePlan, type PlannedRoute } from "../model/use-route-plan";
import { useRouteStepper, type RouteStep } from "../model/use-route-stepper";
import { CompactStep } from "./compact-step";
import { CurrentStep } from "./current-step";
import { FinishStep } from "./finish-step";
import { RoutePending } from "./route-pending";
import { RoutePlanNotes } from "./route-plan-notes";
import { RouteProgress } from "./route-progress";
import { RouteSavings, RouteSummary, UnreachableNotice } from "./route-summary";
import { StepGroup } from "./step-group";

type RoutePanelProps = {
  survey: Survey;
  purpose: RoutePurpose;
  selection: SurveySelection;
  progress: RouteProgressState;
  onSelect: (selection: SurveySelection) => void;
};

type PlannedRoutePanelProps = RoutePanelProps & { route: PlannedRoute };

const PlannedRoutePanel: FC<PlannedRoutePanelProps> = ({ survey, purpose, route, selection, progress, onSelect }) => {
  const plan = useRoutePlan(survey, purpose, route);
  const { reached, setStopReached, resetProgress } = progress;
  const stepper = useRouteStepper(plan, reached);

  const selectedTargetId = selection.kind === "target" ? selection.targetId : null;
  const { revealedId, forgetRevealed } = useRevealedStop(selectedTargetId);

  const showStop = (targetId: TargetId) => onSelect({ kind: "target", targetId });
  const changeReached = (targetId: TargetId, isReached: boolean) => {
    forgetRevealed();
    setStopReached(targetId, isReached);
  };
  const containsRevealed = (steps: RouteStep[]) => steps.some(step => step.stop.targetId === revealedId);

  const renderCompact = (step: RouteStep) => {
    return (
      <CompactStep
        key={step.stop.targetId}
        step={step}
        speedKmh={plan.speedKmh}
        isSelected={step.stop.targetId === selectedTargetId}
        isRevealed={step.stop.targetId === revealedId}
        onShow={showStop}
        onReachedChange={changeReached}
      />
    );
  };

  return (
    <div>
      <RouteSummary plan={plan} />

      <RoutePlanNotes>
        <RouteSavings plan={plan} />
        <UnreachableNotice plan={plan} />
      </RoutePlanNotes>

      <div className="mt-6">
        <RouteProgress
          reachedCount={stepper.reachedSummary.count}
          total={plan.stops.length}
          onStartOver={resetProgress}
        />
      </div>

      <ol
        aria-label="Stops in walking order"
        className="before:bg-input relative mt-4 grid gap-2 before:absolute before:top-5 before:bottom-5 before:left-[15px] before:w-px"
      >
        {stepper.reachedSteps.length > 0 && (
          <StepGroup
            title="Reached"
            tone="done"
            summary={stepper.reachedSummary}
            distanceLabel="walked"
            containsRevealed={containsRevealed(stepper.reachedSteps)}
          >
            {stepper.reachedSteps.map(renderCompact)}
          </StepGroup>
        )}

        {stepper.current && (
          <CurrentStep
            step={stepper.current}
            totalStops={plan.stops.length}
            speedKmh={plan.speedKmh}
            isSelected={stepper.current.stop.targetId === selectedTargetId}
            onShow={showStop}
            onReachedChange={changeReached}
          />
        )}

        {stepper.upcomingSteps.length > 0 && (
          <StepGroup
            title="Still to go"
            tone="upcoming"
            summary={stepper.upcomingSummary}
            distanceLabel="left"
            containsRevealed={containsRevealed(stepper.upcomingSteps)}
          >
            {stepper.upcomingSteps.map(renderCompact)}
          </StepGroup>
        )}

        <FinishStep isCurrent={stepper.isComplete} returnLeg={stepper.returnLeg} />
      </ol>
    </div>
  );
};

export const RoutePanel: FC<RoutePanelProps> = props => {
  const route = props.survey.routes[props.purpose];
  if (!route) return <RoutePending start={props.survey.start.geometry.coordinates} />;
  return <PlannedRoutePanel {...props} route={route} />;
};
