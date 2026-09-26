import { statusToken } from '../tokens';
import type { VerificationStatus } from '../types';

export function StatusBadge({ status }: { status: VerificationStatus }) {
  const t = statusToken(status);
  return (
    <span
      className="badge"
      style={{ borderColor: t.solid, background: t.bg, color: t.text }}
    >
      <span className="dot" style={{ background: t.solid }} />
      {t.label}
    </span>
  );
}
