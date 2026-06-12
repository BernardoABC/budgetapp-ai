import { T } from '../theme';

export interface SummaryStats {
  carryIn: number;
  assigned: number;
  activity: number;
  available: number;
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
      <div style={sp.labelRow}>
        <span style={sp.label}>SUMMARY</span>
      </div>
      <div style={sp.selLine}>{selectionLabel}</div>

      <StatCard label="Left over from last month" value={fmt(stats.carryIn)} color={stats.carryIn < 0 ? T.neg : stats.carryIn === 0 ? T.textMid : T.pos} />
      <StatCard label="Assigned this month"       value={fmt(stats.assigned)} color={T.text} />
      <StatCard label="Activity this month"       value={fmt(stats.activity)} color={stats.activity < 0 ? T.neg : stats.activity === 0 ? T.textMid : T.pos} />
      <StatCard label="Available"                 value={fmt(stats.available)} color={stats.available < 0 ? T.neg : stats.available === 0 ? T.textMid : T.pos} />

      {hasSelection && (
        <button onClick={onClear} style={sp.clearBtn}>✕ Clear selection</button>
      )}
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
  pane:      { width: 220, flexShrink: 0, padding: '16px 14px', display: 'flex', flexDirection: 'column' as const, gap: 10, borderLeft: `1px solid ${T.border}`, borderRadius: `0 ${T.radius} ${T.radius} 0` },
  labelRow:  { marginBottom: 2 },
  label:     { fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: '.08em', textTransform: 'uppercase' as const },
  selLine:   { fontSize: 11, color: T.textMid, fontWeight: 600, lineHeight: 1.4, marginBottom: 4 },
  card:      { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 12px' },
  cardLabel: { fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: '.06em', textTransform: 'uppercase' as const, marginBottom: 4 },
  cardValue: { fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono, monospace)', letterSpacing: '-.02em' },
  clearBtn:  { background: 'none', border: `1px solid ${T.border}`, borderRadius: 6, color: T.textDim, fontSize: 11, padding: '6px 10px', cursor: 'pointer', width: '100%', marginTop: 4 },
};
