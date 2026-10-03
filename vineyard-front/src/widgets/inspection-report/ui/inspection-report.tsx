import { ArrowLeft, Download } from "lucide-react";
import type { FC } from "react";

import type { Delegation } from "@/entities/delegation";
import { describeCapture, type RoutePurpose, type Survey, type SurveySource } from "@/entities/survey";
import type { RouteProgressState } from "@/features/track-route-progress";
import { formatCount, formatHectares, formatMetres, formatSquareMetres } from "@/shared/lib/format";
import { formatLngLat, formatUtm, projectToSurveyCrs } from "@/shared/lib/geo";
import { Button } from "@/shared/ui";

import { formatClock, formatDate, formatDuration } from "../lib/report-dates";
import { useInspectionReport, type InspectionReportData } from "../model/use-inspection-report";
import { FindingsTable } from "./findings-table";
import { Choice, Field, ReportSection, RuledLines } from "./report-parts";
import { ReportPrintStyles } from "./report-print-styles";
import { RequiredActions } from "./required-actions";
import { RouteFigure } from "./route-figure";

const EXPLANATION_LINES = 4;

const controlPeriod = ({ startedAt, finishedAt }: InspectionReportData) => {
  if (!startedAt || !finishedAt) return null;
  return `${formatClock(startedAt)}–${formatClock(finishedAt)} (${formatDuration(startedAt, finishedAt)})`;
};

type SectionProps = { report: InspectionReportData };

const GeneralDetails: FC<SectionProps> = ({ report }) => {
  return (
    <ReportSection number={1} titleRo="Date generale" titleEn="General details">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label="Organul de control / Control body" value={report.controlBody} />
        <Field label="Nr. proces-verbal / Report number" value={report.number} />
        <Field label="Data / Date" value={formatDate(report.startedAt ?? report.createdAt)} />
        <Field label="Perioada controlului / Control period" value={controlPeriod(report)} />
      </dl>
    </ReportSection>
  );
};

type DelegationSectionProps = { report: InspectionReportData; delegation: Delegation | null };

const otherInspectorsOf = (report: InspectionReportData, delegation: Delegation | null) => {
  const others = (delegation?.inspectors ?? []).filter(
    inspector => inspector.badgeNumber !== report.inspector.badgeNumber,
  );
  return others.length > 0
    ? others.map(inspector => `${inspector.fullName} (${inspector.badgeNumber})`).join(", ")
    : null;
};

const Inspectors: FC<DelegationSectionProps> = ({ report, delegation }) => {
  return (
    <ReportSection number={2} titleRo="Inspectori" titleEn="Inspectors">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label="Nume, prenume / Full name" value={report.inspector.fullName} />
        <Field label="Nr. legitimației / Badge number" value={report.inspector.badgeNumber} />
        <Field
          label="Alți inspectori / Other inspectors"
          value={otherInspectorsOf(report, delegation)}
          className="col-span-2"
        />
      </dl>
    </ReportSection>
  );
};

type LegalBasisProps = { delegation: Delegation | null };

const LegalBasis: FC<LegalBasisProps> = ({ delegation }) => {
  return (
    <ReportSection number={3} titleRo="Temeiul controlului" titleEn="Legal basis and delegation">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label="Nr. delegației de control / Control delegation no." value={delegation?.number ?? null} />
        <Field
          label="Nr. în Registrul de stat al controalelor / State Register of Controls no."
          value={delegation?.rscNumber ?? null}
        />
        {delegation && (
          <Field label="Temei legal / Legal basis" value={delegation.legalBasis} className="col-span-2" />
        )}
      </dl>
      <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="text-xs text-black/55">Tipul controlului / Type of control:</span>
        <Choice label="Planificat / Planned" isChecked={delegation?.controlType === "planned"} />
        <Choice label="Inopinat / Unannounced" isChecked={delegation?.controlType === "unannounced"} />
      </p>
    </ReportSection>
  );
};

const ControlledPerson: FC<DelegationSectionProps> = ({ report, delegation }) => {
  return (
    <ReportSection number={4} titleRo="Persoana supusă controlului" titleEn="Controlled person">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label="Plantația / Vineyard" value={report.source.name} />
        <Field label="Localitatea / Location" value={report.source.location} />
        <Field label="Denumirea sau numele operatorului / Operator" value={delegation?.operator.name ?? null} />
        <Field label="IDNO / IDNP" value={delegation?.operator.idno ?? null} />
      </dl>
    </ReportSection>
  );
};

const PurposeAndMethods: FC<SectionProps> = ({ report }) => {
  const start = report.startPosition;
  return (
    <ReportSection number={5} titleRo="Scopul și metodele controlului" titleEn="Purpose and methods">
      <div className="grid gap-2 text-sm leading-relaxed">
        <p>
          <span className="font-medium">Scop / Purpose:</span> on-site check of vine rows with potentially missing
          planting and of visible waste in and around the vineyard.
        </p>
        <p>
          <span className="font-medium">Metode / Methods:</span> {describeCapture(report.source)} Targets were
          detected from the drone imagery with AI-assisted processing, then visited in person along a walking route
          {report.routeLengthM === null ? "" : ` of ${formatMetres(report.routeLengthM)}`} with{" "}
          {formatCount(report.stops.length)} stops, starting and ending at {formatUtm(projectToSurveyCrs(start))} (
          {formatLngLat(start)}). Findings were recorded at each stop.
        </p>
      </div>
    </ReportSection>
  );
};

const summaryOf = (report: InspectionReportData) => {
  const visited = `${formatCount(report.reachedCount)} of ${formatCount(report.stops.length)} stops visited.`;
  const totals = report.totals.map(total => `${total.label}: ${formatCount(total.count)}`).join("; ");
  return totals ? `${visited} ${totals}.` : visited;
};

const Findings: FC<SectionProps> = ({ report }) => {
  if (report.stops.length === 0) {
    return (
      <ReportSection number={6} titleRo="Lista de verificare și constatări" titleEn="Checklist and findings">
        <p className="text-sm">
          No route has been calculated for this vineyard yet. Go back to the route, calculate it and record the
          findings at each stop; they appear here.
        </p>
      </ReportSection>
    );
  }
  return (
    <ReportSection number={6} titleRo="Lista de verificare și constatări" titleEn="Checklist and findings">
      <p className="mb-3 text-sm">{summaryOf(report)}</p>
      <FindingsTable stops={report.stops} />
      {report.unreachable.length > 0 && (
        <p className="mt-3 text-sm">
          <span className="font-medium">Neaccesibile / Not reachable on foot:</span>{" "}
          {report.unreachable.map(target => target.targetId).join(", ")}.
        </p>
      )}
      <div className="mt-4">
        <RouteFigure drawing={report.drawing} />
      </div>
    </ReportSection>
  );
};

const Measurements: FC<SectionProps> = ({ report }) => {
  const { measurements } = report;
  return (
    <ReportSection number={7} titleRo="Măsurători" titleEn="Vineyard measurements">
      <dl className="grid grid-cols-3 gap-x-6 gap-y-3">
        <Field label="Parcele / Blocks" value={formatCount(measurements.blockCount)} />
        <Field label="Rânduri / Rows" value={formatCount(measurements.rowCount)} />
        <Field label="Lungimea rândurilor / Row length" value={formatMetres(measurements.rowLengthM)} />
        <Field label="Butuci / Vine canopies" value={formatCount(measurements.canopyCount)} />
        <Field
          label="Suprafața coronamentului / Canopy area"
          value={`${formatHectares(measurements.canopyAreaM2)} (${formatSquareMetres(measurements.canopyAreaM2)})`}
        />
        <Field
          label="Suprafața intervalelor / Inter-row area"
          value={`${formatHectares(measurements.interrowAreaM2)} (${formatSquareMetres(measurements.interrowAreaM2)})`}
        />
      </dl>
      <p className="mt-2 text-xs text-black/55">Horizontal measurements in EPSG:32635, from the drone survey.</p>
    </ReportSection>
  );
};

const Signatures: FC = () => {
  return (
    <ReportSection number={10} titleRo="Semnături" titleEn="Signatures">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-6">
        <Field label="Inspector (nume, semnătura) / Inspector (name, signature)" />
        <Field label="Persoana supusă controlului / Controlled person" />
        <Field label="Data / Date" />
        <Field label="Ștampila / Stamp (if applicable)" />
      </dl>
      <p className="mt-4 text-xs text-black/55">
        Întocmit în două exemplare / Drawn up in two copies: one for the controlled person, one for the control body.
        Each page is numbered and signed.
      </p>
    </ReportSection>
  );
};

type InspectionReportProps = {
  source: SurveySource;
  survey: Survey;
  purpose: RoutePurpose;
  progress: RouteProgressState;
  delegation: Delegation | null;
  onClose: () => void;
};

export const InspectionReport: FC<InspectionReportProps> = ({
  source,
  survey,
  purpose,
  progress,
  delegation,
  onClose,
}) => {
  const report = useInspectionReport({ source, survey, purpose, progress });

  return (
    <div className="bg-muted min-h-dvh print:bg-white">
      <ReportPrintStyles />
      <div className="bg-background/95 border-border sticky top-0 z-10 flex items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur-sm print:hidden">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft aria-hidden />
          Back to the route
        </Button>
        <div className="flex items-center gap-3">
          <p className="text-muted-foreground hidden text-xs sm:block">Stays on this device. Save as PDF in the print dialog.</p>
          <Button type="button" size="sm" onClick={() => window.print()}>
            <Download aria-hidden />
            Download PDF
          </Button>
        </div>
      </div>

      <article className="mx-auto my-6 max-w-[210mm] bg-white px-[14mm] py-[12mm] text-black shadow-[0_1px_3px_rgb(29_36_32/0.18)] print:m-0 print:max-w-none print:p-0 print:shadow-none">
        <header className="pb-4">
          <p className="text-xs tracking-wide text-black/55">Republica Moldova</p>
          <h1 className="mt-1 text-xl font-semibold">Proces-verbal de control / Inspection report</h1>
          <p className="mt-1 text-sm">
            {source.name}, {source.location}. Report {report.number}.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-black/55">
            Structured after Law No. 131/2012 on state control (art. 28) and Regulation (EU) 2017/625 (art. 13).
            Prepared by the vineyard app from the inspector&apos;s walk; it becomes an official record only when an
            authorised inspector completes and signs it.
          </p>
        </header>

        <GeneralDetails report={report} />
        <Inspectors report={report} delegation={delegation} />
        <LegalBasis delegation={delegation} />
        <ControlledPerson report={report} delegation={delegation} />
        <PurposeAndMethods report={report} />
        <Findings report={report} />
        <Measurements report={report} />
        <ReportSection number={8} titleRo="Măsuri prescrise și termene" titleEn="Required actions and deadlines">
          <RequiredActions />
        </ReportSection>
        <ReportSection
          number={9}
          titleRo="Explicațiile persoanei supuse controlului"
          titleEn="Explanations of the controlled person"
        >
          <RuledLines count={EXPLANATION_LINES} />
        </ReportSection>
        <Signatures />
      </article>
    </div>
  );
};
