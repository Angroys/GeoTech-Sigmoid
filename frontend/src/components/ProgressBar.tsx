import { tokens } from '../tokens';

interface Segment {
  value: number;
  color: string;
}

/**
 * Three-segment progress bar (verified / in-progress / unchecked remainder).
 */
export function ProgressBar({
  verified,
  inProgress,
  total,
}: {
  verified: number;
  inProgress: number;
  total: number;
}) {
  const safeTotal = Math.max(total, 1);
  const segs: Segment[] = [
    { value: verified, color: tokens.status.verified.solid },
    { value: inProgress, color: tokens.status.inProgress.solid },
  ];
  const pct = (n: number) => `${(n / safeTotal) * 100}%`;
  return (
    <div
      className="progressbar"
      role="progressbar"
      aria-valuenow={verified}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={`${verified} of ${total} verified`}
    >
      {segs.map((s, i) => (
        <div key={i} className="seg" style={{ width: pct(s.value), background: s.color }} />
      ))}
    </div>
  );
}

/** Single-fill progress bar for export jobs. */
export function SimpleProgress({ percent, color }: { percent: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="progressbar"
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="seg" style={{ width: `${clamped}%`, background: color }} />
    </div>
  );
}
