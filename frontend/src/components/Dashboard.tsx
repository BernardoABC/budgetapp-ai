import { useState, useEffect, useCallback } from 'react';
import { T, GROUP_COLORS } from '../theme';
import type { Transaction, CategoryGroup } from '../api';
import { fetchRecentTransactions, fetchAccounts, fetchPlan } from '../api';

interface Props {
  categoryGroups: CategoryGroup[];
  fmt: (n: number, txnCurrency?: string) => string;
  onNavigate: (page: string, accountId?: string) => void;
}

function Sparkline({ data, color, w = 96, h = 28 }: { data: number[]; color: string; w?: number; h?: number }) {
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / range) * (h - 4) - 2]);
  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = path + ` L${w} ${h} L0 ${h} Z`;
  const id = 'sg' + color.replace(/[^a-z0-9]/gi, '');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.6" fill={color} />
    </svg>
  );
}

function StatCard({ label, value, sub, subColor, spark, sparkColor, accent }: {
  label: string; value: string; sub?: string; subColor?: string;
  spark?: number[]; sparkColor?: string; accent?: boolean;
}) {
  return (
    <div style={{ ...st.card, ...(accent ? st.cardAccent : {}) }}>
      <div style={st.cardTop}>
        <div style={st.cardLabel}>{label}</div>
        {spark && <Sparkline data={spark} color={sparkColor ?? T.pos} />}
      </div>
      <div style={{ ...st.cardValue, color: accent ? 'var(--accent)' : T.text }}>{value}</div>
      {sub && <div style={{ ...st.cardSub, color: subColor ?? T.textDim }}>{sub}</div>}
    </div>
  );
}

function SpendingBar({ label, color, spent, budget, fmt }: { label: string; color: string; spent: number; budget: number; fmt: (n: number, txnCurrency?: string) => string }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const over = spent > budget;
  const barColor = over ? T.neg : pct > 88 ? T.warn : color;
  return (
    <div style={st.barRow}>
      <div style={st.barHead}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2.5, background: color }} />
          <span style={st.barLabel}>{label}</span>
        </span>
        <span style={{ ...st.barAmt, color: over ? T.neg : T.textMid }}>
          {fmt(spent)} <span style={{ color: T.textFaint }}>/ {fmt(budget)}</span>
        </span>
      </div>
      <div style={st.barTrack}>
        <div style={{ ...st.barFill, width: pct + '%', background: barColor, boxShadow: `0 0 10px ${barColor}66` }} />
      </div>
    </div>
  );
}

export function Dashboard({ categoryGroups, fmt, onNavigate }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(true);
  const [txnError, setTxnError] = useState<string | null>(null);

  const [netWorth, setNetWorth] = useState(0);
  const [thisMonthSpending, setThisMonthSpending] = useState(0);
  const [expectedIncomeView, setExpectedIncomeView] = useState(0);
  const [leftToBudget, setLeftToBudget] = useState(0);
  const [savingsRate, setSavingsRate] = useState(0);
  const [groupSpend, setGroupSpend] = useState<Array<{ name: string; spent: number; planned: number; color?: string }>>([]);

  const currentYM = new Date().toISOString().slice(0, 7);
  const currentMonthLabel = new Date().toLocaleString('default', { month: 'long' });

  const loadTxns = useCallback(() => {
    setLoadingTxns(true);
    setTxnError(null);
    Promise.all([
      fetchRecentTransactions(20),
      fetchAccounts().catch(err => { console.warn('fetchAccounts failed', err); return null; }),
      fetchPlan(currentYM).catch(err => { console.warn('fetchPlan failed', err); return null; }),
    ])
      .then(([txns, accts, plan]) => {
        setTransactions(txns);
        setLoadingTxns(false);

        if (accts) {
          const nw = [...accts.budget, ...accts.tracking].reduce((s, a) => s + a.balance, 0);
          setNetWorth(nw);
        }

        if (plan) {
          setThisMonthSpending(plan.actual_spending);
          setExpectedIncomeView(plan.expected_income);
          setLeftToBudget(plan.left_to_budget);
          setSavingsRate(plan.actual_income > 0 ? plan.actual_savings / plan.actual_income : 0);
          const bars = plan.category_groups.map(g => ({
            name: g.name,
            spent: g.activity < 0 ? -g.activity : 0,
            planned: g.planned,
            color: GROUP_COLORS[g.name],
          }));
          setGroupSpend(bars);
        }
      })
      .catch(err => {
        setTxnError(err.message);
        setLoadingTxns(false);
      });
  }, [currentYM]);

  useEffect(() => { loadTxns(); }, [loadTxns]);

  const recent = transactions.slice(0, 7);

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1180, margin: '0 auto' }}>
      <div style={st.cardRow}>
        <StatCard label="Net Worth" value={fmt(netWorth)} accent />
        <StatCard label={`Spent · ${currentMonthLabel}`} value={fmt(thisMonthSpending)} />
        <StatCard label="Savings rate" value={`${Math.round(savingsRate * 100)}%`} sub={`Left to budget ${fmt(leftToBudget)}`} subColor={leftToBudget < 0 ? T.neg : T.textDim} />
      </div>

      <div style={st.twoCol}>
        <div style={st.panel}>
          <div style={st.panelHeader}>
            <span>Spending by Category</span>
            <span style={st.panelMeta}>{currentMonthLabel} {new Date().getFullYear()}</span>
          </div>
          <div style={{ padding: '14px 18px 6px' }}>
            {groupSpend.map(g => <SpendingBar key={g.name} label={g.name} color={g.color ?? T.textMid} spent={g.spent} budget={g.planned} fmt={fmt} />)}
          </div>
        </div>

        <div style={st.panel}>
          <div style={st.panelHeader}>
            <span>This Month</span>
          </div>
          <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={st.monthRow}>
              <span style={st.monthLabel}>Expected income</span>
              <span style={st.monthVal}>{fmt(expectedIncomeView)}</span>
            </div>
            <div style={st.monthRow}>
              <span style={st.monthLabel}>Left to budget</span>
              <span style={{ ...st.monthVal, color: leftToBudget < 0 ? T.neg : undefined }}>{fmt(leftToBudget)}</span>
            </div>
            <div style={st.monthRow}>
              <span style={st.monthLabel}>Savings rate</span>
              <span style={st.monthVal}>{Math.round(savingsRate * 100)}%</span>
            </div>
          </div>
          <button onClick={() => onNavigate('budget')} style={st.panelCta}>Review plan →</button>
        </div>
      </div>

      <div style={st.panel}>
        <div style={st.panelHeader}>
          <span>Recent Transactions</span>
          <button onClick={() => onNavigate('accounts', 'bac')} style={st.linkBtn}>View all →</button>
        </div>
        {txnError ? (
          <div style={{ padding: '20px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: T.neg, flex: 1 }}>{txnError}</span>
            <button onClick={loadTxns} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 7, padding: '5px 12px', fontSize: 12, color: T.textMid, cursor: 'pointer' }}>Retry</button>
          </div>
        ) : loadingTxns ? (
          <div style={{ padding: '24px 18px', color: T.textDim, fontSize: 13 }}>Loading…</div>
        ) : (
          <table style={st.table}>
            <thead>
              <tr>
                {['Date', 'Payee', 'Category', 'Amount'].map(h => (
                  <th key={h} style={{ ...st.th, textAlign: h === 'Amount' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.map(t => {
                const grp = categoryGroups.find(g => g.categories.includes(t.category ?? ''));
                const catColor = grp ? GROUP_COLORS[grp.name] : T.textMid;
                return (
                  <tr key={t.id} style={st.tr}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ ...st.td, fontFamily: T.mono, fontSize: 12, color: T.textDim }}>{t.date.slice(5).replace('-', '/')}</td>
                    <td style={{ ...st.td, fontWeight: 600 }}>{t.payee}</td>
                    <td style={st.td}>
                      {t.category
                        ? <span style={{ ...st.catTag, color: catColor }}><span style={{ width: 6, height: 6, borderRadius: 2, background: 'currentColor', opacity: 0.9 }} />{t.category}</span>
                        : <span style={{ color: T.textFaint, fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ ...st.td, textAlign: 'right', fontFamily: T.mono, fontSize: 13, fontWeight: 500 }}>
                      {t.inflow > 0 ? <span style={{ color: T.pos }}>+{fmt(t.inflow, t.currency)}</span> : <span style={{ color: T.textMid }}>−{fmt(t.outflow, t.currency)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const st = {
  cardRow:     { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 18 },
  card:        { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: '18px 20px', boxShadow: T.shadow + ', ' + T.insetTop },
  cardAccent:  { background: `linear-gradient(135deg, ${T.accentDim}, ${T.surface} 60%)`, borderColor: T.borderHi },
  cardTop:     { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 },
  cardLabel:   { fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const },
  cardValue:   { fontSize: 28, fontWeight: 700, fontFamily: T.mono, letterSpacing: '-0.02em', lineHeight: 1 },
  cardSub:     { fontSize: 12, marginTop: 8, fontWeight: 500 },
  twoCol:      { display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, marginBottom: 16 },
  panel:       { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: 'hidden', boxShadow: T.shadow, display: 'flex', flexDirection: 'column' as const },
  panelHeader: { padding: '14px 18px', fontSize: 13, fontWeight: 700, color: T.text, borderBottom: `1px solid ${T.border}`, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  panelMeta:   { fontSize: 11.5, fontWeight: 500, color: T.textDim, fontFamily: T.mono },
  panelCta:    { marginTop: 'auto', padding: '11px 18px', background: 'rgba(255,255,255,0.02)', border: 'none', borderTop: `1px solid ${T.border}`, color: T.textMid, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', textAlign: 'left' as const },
  linkBtn:     { background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  barRow:      { padding: '8px 0' },
  barHead:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  barLabel:    { fontSize: 13, color: T.textMid, fontWeight: 600 },
  barTrack:    { height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' },
  barFill:     { height: '100%', borderRadius: 4, transition: 'width 0.5s cubic-bezier(0.22,1,0.36,1)' },
  barAmt:      { fontSize: 12, fontFamily: T.mono, fontWeight: 500 },
  monthRow:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  monthLabel:  { fontSize: 13, color: T.textMid, fontWeight: 500 },
  monthVal:    { fontSize: 13, fontFamily: T.mono, fontWeight: 600, color: T.text },
  table:       { width: '100%', borderCollapse: 'collapse' as const },
  th:          { padding: '9px 18px', fontSize: 10.5, fontWeight: 700, color: T.textDim, textAlign: 'left' as const, letterSpacing: '0.08em', textTransform: 'uppercase' as const, borderBottom: `1px solid ${T.border}` },
  tr:          { transition: 'background 0.1s' },
  td:          { padding: '10px 18px', fontSize: 13, color: T.textMid, borderBottom: `1px solid ${T.borderSoft}` },
  catTag:      { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '3px 9px', fontSize: 11.5, fontWeight: 600 },
};
