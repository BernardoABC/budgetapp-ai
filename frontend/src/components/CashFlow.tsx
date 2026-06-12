import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { T } from '../theme';
import { fetchSavings, fetchPlan } from '../api';
import type { PlanMonthAPI } from '../api';

interface Props { fmt: (n: number) => string; }

function lastNMonths(n: number): { from: string; to: string } {
  const now = new Date();
  const months: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return { from: months[0], to: months[months.length - 1] };
}

export function CashFlow({ fmt }: Props) {
  const [currentYM] = useState(() => new Date().toISOString().slice(0, 7));
  const [series, setSeries] = useState<{ month: string; income: number; expense: number; savings: number; rate: number }[]>([]);
  const [plan, setPlan] = useState<PlanMonthAPI | null>(null);

  useEffect(() => {
    const { from, to } = lastNMonths(12);
    fetchSavings(from, to).then(rows => setSeries(rows.map(r => ({
      ...r, income: r.income / 100, expense: r.expense / 100, savings: r.savings / 100,
    })))).catch(() => { /* ignore fetch errors */ });
    fetchPlan(currentYM).then(setPlan).catch(() => { /* ignore fetch errors */ });
  }, [currentYM]);

  const cur = series[series.length - 1];

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1180, margin: '0 auto' }}>
      <div style={st.cardRow}>
        <Stat label="Income · this month" value={fmt(cur?.income ?? 0)} color={T.pos} />
        <Stat label="Spending · this month" value={fmt(cur?.expense ?? 0)} color={T.neg} />
        <Stat label="Savings" value={fmt(cur?.savings ?? 0)} color={(cur?.savings ?? 0) < 0 ? T.neg : T.pos} />
        <Stat label="Savings rate" value={`${Math.round((cur?.rate ?? 0) * 100)}%`} color={T.text} />
      </div>

      <Panel title="Income vs Spending">
        <IncomeSpendingChart data={series} />
      </Panel>

      {plan && (
        <Panel title="By flexibility — this month">
          <BucketBar label="Fixed" planned={plan.fixed_planned} actual={plan.fixed_actual} fmt={fmt} color={T.pos} />
          <BucketBar label="Flexible" planned={plan.flex_budget} actual={plan.flexible_actual} fmt={fmt} color="#f6c45a" />
          <BucketBar label="Non-monthly" planned={plan.non_monthly_planned} actual={plan.non_monthly_actual} fmt={fmt} color="#c084fc" />
        </Panel>
      )}
    </div>
  );
}

function IncomeSpendingChart({ data }: { data: { month: string; income: number; expense: number; savings: number }[] }) {
  const W = 660, H = 240, PL = 64, PR = 16, PT = 16, PB = 34;
  const iW = W - PL - PR, iH = H - PT - PB;
  if (data.length < 2) return <div style={{ padding: 24, color: T.textDim, fontSize: 13 }}>Not enough data</div>;
  const maxVal = Math.max(...data.flatMap(d => [d.income, d.expense])) * 1.12 || 1;
  const toX = (i: number) => PL + (i / (data.length - 1)) * iW;
  const toY = (v: number) => PT + iH - (v / maxVal) * iH;
  const line = (key: 'income' | 'expense' | 'savings') => data.map((d, i) => `${toX(i)},${toY(d[key])}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {data.map((d, i) => <text key={d.month} x={toX(i)} y={H - 8} textAnchor="middle" fontSize="10.5" fill={T.textDim} fontFamily={T.sans}>{d.month.slice(2)}</text>)}
      <polyline points={line('income')} fill="none" stroke={T.pos} strokeWidth="2" />
      <polyline points={line('expense')} fill="none" stroke={T.neg} strokeWidth="2" />
      <polyline points={line('savings')} fill="none" stroke="#5b9dff" strokeWidth="2" strokeDasharray="4 3" />
    </svg>
  );
}

function BucketBar({ label, planned, actual, fmt, color }: { label: string; planned: number; actual: number; fmt: (n: number) => string; color: string }) {
  const pct = planned > 0 ? Math.min((actual / planned) * 100, 100) : 0;
  const over = actual > planned && planned > 0;
  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
        <span style={{ fontSize: 13, color: T.textMid, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: T.mono, color: over ? T.neg : T.textMid }}>{fmt(actual)} <span style={{ color: T.textFaint }}>/ {fmt(planned)}</span></span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: over ? T.neg : color, borderRadius: 4 }} />
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={st.card}>
      <div style={st.cardLabel}>{label}</div>
      <div style={{ ...st.cardValue, color }}>{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={st.panel}>
      <div style={st.panelHeader}>{title}</div>
      <div style={{ padding: '14px 18px' }}>{children}</div>
    </div>
  );
}

const st = {
  cardRow:     { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 18 },
  card:        { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: '18px 20px', boxShadow: T.shadow },
  cardLabel:   { fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: 10 },
  cardValue:   { fontSize: 26, fontWeight: 700, fontFamily: T.mono, letterSpacing: '-0.02em', lineHeight: 1 },
  panel:       { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: 'hidden', boxShadow: T.shadow, marginBottom: 16 },
  panelHeader: { padding: '14px 18px', fontSize: 13, fontWeight: 700, color: T.text, borderBottom: `1px solid ${T.border}` },
};
