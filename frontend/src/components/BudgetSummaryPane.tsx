import { T } from '../theme';

export interface SummaryStats {
  planned: number;
  actual: number;      // positive spending
  remaining: number;
  rolloverBalance: number | null; // null when selection has no rollover category
}

interface Props {
  stats: SummaryStats;
  selectionLabel: string;
  hasSelection: boolean;
  onClear: () => void;
  fmt: (n: number) => string;
}

export function BudgetSummaryPane({ stats, selectionLabel, hasSelection, onClear, fmt }: Props) {
  return (
    <div style={sp.pane}>
      <div style={sp.labelRow}><span style={sp.label}>SUMMARY</span></div>
      <div style={sp.selLine}>{selectionLabel}</div>

      <StatCard label="Budgeted" value={fmt(stats.planned)} color={T.text} />
      <StatCard label="Actual" value={fmt(stats.actual)} color={stats.actual > 0 ? T.neg : T.textMid} />
      <StatCard label="Remaining" value={fmt(stats.remaining)} color={stats.remaining < 0 ? T.neg : stats.remaining === 0 ? T.textMid : T.pos} />
      {stats.rolloverBalance !== null && (
        <StatCard label="Rollover balance" value={fmt(stats.rolloverBalance)} color={stats.rolloverBalance < 0 ? T.neg : T.pos} />
      )}

      {hasSelection && <button onClick={onClear} style={sp.clearBtn}>✕ Clear selection</button>}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={sp.card}>
      <div style={sp.cardLabel}>{label}</div>
      <div style={{ ...sp.cardValue, color }}>{value}</div>
    </div>
  );
}

const sp = {
  pane:      { width: 220, flexShrink: 0, padding: '16px 14px', display: 'flex', flexDirection: 'column' as const, gap: 10, borderRadius: `0 ${T.radius} ${T.radius} 0` },
  labelRow:  { marginBottom: 2 },
  label:     { fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: '.08em', textTransform: 'uppercase' as const },
  selLine:   { fontSize: 11, color: T.textMid, fontWeight: 600, lineHeight: 1.4, marginBottom: 4 },
  card:      { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 12px' },
  cardLabel: { fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: '.06em', textTransform: 'uppercase' as const, marginBottom: 4 },
  cardValue: { fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono, monospace)', letterSpacing: '-.02em' },
  clearBtn:  { background: 'none', border: `1px solid ${T.border}`, borderRadius: 6, color: T.textDim, fontSize: 11, padding: '6px 10px', cursor: 'pointer', width: '100%', marginTop: 4 },
};
