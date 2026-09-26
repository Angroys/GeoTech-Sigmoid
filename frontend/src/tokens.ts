import tokensJson from '@design/design-tokens.json';
import type { Label, AnnotationAttributes } from './types';

// Typed access to the design tokens JSON (loose typing; JSON is source of truth).
export const tokens = tokensJson as any;

export interface OverlayStyle {
  stroke: string;
  fill: string;
  strokeWidth: number;
  dashArray: string | null;
}

/**
 * Overlay style resolver — maps backend label + attributes to a token overlay key.
 * Backend labels: row (polyline), vineyard (polygon), interrow_area (polygon), waste (box).
 * Token keys: rows | rowsDisrupted | canopies | interRowBareSoil | interRowMixed
 */
export function overlayKeyFor(label: Label, attr: AnnotationAttributes = {}): string {
  if (label === 'row') {
    return attr.row_structure === 'disrupted' ? 'rowsDisrupted' : 'rows';
  }
  if (label === 'interrow_area') {
    return attr.interrow_cover === 'mixed' ? 'interRowMixed' : 'interRowBareSoil';
  }
  if (label === 'vineyard') {
    return 'canopies';
  }
  // waste / other -> reuse canopies-style but distinguishable via wasteStyle below
  return 'canopies';
}

export function overlayStyle(label: Label, attr: AnnotationAttributes = {}): OverlayStyle {
  // 'waste' gets a distinct muted style so it reads apart from vineyard canopies.
  if (label === 'waste') {
    return {
      stroke: '#B4BDCA',
      fill: 'rgba(180, 189, 202, 0.14)',
      strokeWidth: 1.5,
      dashArray: '2 3',
    };
  }
  const key = overlayKeyFor(label, attr);
  return tokens.overlay[key] as OverlayStyle;
}

export const haloColor: string = tokens.overlay.halo.color;
export const haloWidthOffset: number = tokens.overlay.halo.widthOffset ?? 2;

/**
 * applyTokens — bind neutral chrome + status/semantic colors to CSS custom
 * properties on :root at startup. Dark theme is primary; light path provided.
 */
export function applyTokens(theme: 'dark' | 'light' = 'dark'): void {
  const root = document.documentElement;
  const c = tokens.color[theme];

  const set = (k: string, v: string) => root.style.setProperty(k, v);

  // Neutral chrome
  set('--color-bg', c.bg);
  set('--color-bg-elevated', c.bgElevated);
  set('--color-panel', c.panel);
  set('--color-panel-hover', c.panelHover);
  set('--color-border', c.border);
  set('--color-border-strong', c.borderStrong);
  set('--color-text-primary', c.textPrimary);
  set('--color-text-secondary', c.textSecondary);
  set('--color-text-muted', c.textMuted);
  set('--color-overlay-scrim', c.overlayScrim);

  // Semantic accents
  const s = tokens.semantic;
  set('--accent', s.accent);
  set('--accent-hover', s.accentHover);
  set('--accent-active', s.accentActive);
  set('--selected-ring', s.selectedRing);
  set('--selected-bg', s.selectedBg);
  set('--hover-bg', s.hoverBg);
  set('--focus-ring', s.focusRing);
  set('--focus-ring-width', `${s.focusRingWidth}px`);
  set('--disabled-fg', s.disabledFg);
  set('--disabled-bg', s.disabledBg);
  set('--danger', s.danger);
  set('--danger-hover', s.dangerHover);
  set('--danger-bg', s.dangerBg);
  set('--success', s.success);
  set('--warning', s.warning);

  // Status colors
  const st = tokens.status;
  set('--status-unchecked', st.unchecked.solid);
  set('--status-unchecked-bg', st.unchecked.bg);
  set('--status-unchecked-text', st.unchecked.text);
  set('--status-in-progress', st.inProgress.solid);
  set('--status-in-progress-bg', st.inProgress.bg);
  set('--status-in-progress-text', st.inProgress.text);
  set('--status-verified', st.verified.solid);
  set('--status-verified-bg', st.verified.bg);
  set('--status-verified-text', st.verified.text);

  // Spacing
  const sp = tokens.spacing;
  set('--space-half', sp.half);
  set('--space-1', sp['1']);
  set('--space-2', sp['2']);
  set('--space-3', sp['3']);
  set('--space-4', sp['4']);
  set('--space-5', sp['5']);
  set('--space-6', sp['6']);
  set('--space-8', sp['8']);

  // Radius
  set('--radius-sm', tokens.radius.sm);
  set('--radius-md', tokens.radius.md);
  set('--radius-lg', tokens.radius.lg);
  set('--radius-pill', tokens.radius.pill);

  // Elevation
  set('--elevation-panel', tokens.elevation.panel);
  set('--elevation-popover', tokens.elevation.popover);
  set('--elevation-modal', tokens.elevation.modal);

  // Typography
  const t = tokens.typography;
  set('--font-sans', t.fontFamily.sans);
  set('--font-mono', t.fontFamily.mono);
  set('--fs-xs', t.size.xs);
  set('--fs-sm', t.size.sm);
  set('--fs-base', t.size.base);
  set('--fs-md', t.size.md);
  set('--fs-lg', t.size.lg);
  set('--fs-xl', t.size.xl);

  root.setAttribute('data-theme', theme);
}

// Status token access helper for components.
export const statusToken = (status: string) => {
  const map: Record<string, string> = {
    unchecked: 'unchecked',
    in_progress: 'inProgress',
    verified: 'verified',
  };
  return tokens.status[map[status] ?? 'unchecked'];
};

export const zoom = tokens.zoom;
export const vertex = tokens.vertex;
