import { useState, useEffect } from 'react';
import { T, GROUP_COLORS } from '../theme';
import type { MonthlySpendingRow } from '../api';
import { fetchSpendingReport, groupKey, fetchIncomeExpense, fetchNetWorth, fetchAgeOfMoney } from '../api';

function LineChart({ data }: { data: MonthlySpendingRow[] }) {
  const W = 660, H = 240, PL = 64, PR = 16, PT = 16, PB = 34;
  const iW = W - PL - PR, iH = H - PT - PB;
  const groups = Object.keys(GROUP_COLORS);
  const months = data.map(d => d.month);
  const maxVal = Math.max(...data.flatMap(d => groups.map(g => (d as Record<string, number>)[groupKey(g)] || 0))) * 1.12;
  const toX = (i: number) => PL + (i / (months.length - 1)) * iW;
  const toY = (v: number) => PT + iH - (v / maxVal) * iH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(maxVal * t / 50000) * 50000);
  const [hover, setHover] = useState<string | null>(null);

  if (data.length < 2) return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}><text x={W/2} y={H/2} textAnchor="middle" fontSize="13" fill={T.textDim} fontFamily={T.sans}>No data</text></svg>;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        {groups.map(g => (
          <linearGradient key={g} id={'lg' + groupKey(g)} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GROUP_COLORS[g]} stopOpacity="0.18" />
            <stop offset="100%" stopColor={GROUP_COLORS[g]} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      {ticks.map(t => (
        <g key={t}>
          <line x1={PL} x2={W - PR} y1={toY(t)} y2={toY(t)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <text x={PL - 8} y={toY(t) + 4} textAnchor="end" fontSize="10" fill={T.textFaint} fontFamily={T.mono}>
            {t >= 1000000 ? (t / 1000000).toFixed(1) + 'M' : t >= 1000 ? (t / 1000) + 'k' : t}
          </text>
        </g>
      ))}
      {months.map((m, i) => <text key={m} x={toX(i)} y={H - 8} textAnchor="middle" fontSize="10.5" fill={T.textDim} fontFamily={T.sans}>{m}</text>)}
      {groups.map(g => {
        const key = groupKey(g);
        const dim = hover && hover !== g;
        const linePts = data.map((d, i) => `${toX(i)},${toY((d as Record<string, number>)[key] || 0)}`).join(' ');
        const areaPts = `${PL},${toY(0)} ` + linePts + ` ${toX(months.length - 1)},${toY(0)}`;
        return (
          <g key={g} opacity={dim ? 0.18 : 1} style={{ transition: 'opacity 0.15s' }} onMouseEnter={() => setHover(g)} onMouseLeave={() => setHover(null)}>
            {hover === g && <polygon points={areaPts} fill={`url(#lg${key})`} />}
            <polyline points={linePts} fill="none" stroke={GROUP_COLORS[g]} strokeWidth={hover === g ? 2.6 : 2} strokeLinejoin="round" strokeLinecap="round" />
            {data.map((d, i) => <circle key={i} cx={toX(i)} cy={toY((d as Record<string, number>)[key] || 0)} r={hover === g ? 3.4 : 2.4} fill={GROUP_COLORS[g]} />)}
          </g>
        );
      })}
    </svg>
  );
}

function DonutChart({ data, fmt }: { data: MonthlySpendingRow[]; fmt: (n: number) => string }) {
  const SIZE = 200, CX = 100, CY = 100, R = 78, INNER = 50;
  const groups = Object.keys(GROUP_COLORS);
  const totals = groups.map(g => ({ g, total: data.reduce((s, d) => s + ((d as Record<string, number>)[groupKey(g)] || 0), 0) }));
  const grand = totals.reduce((s, t) => s + t.total, 0);
  const [hovered, setHovered] = useState<string | null>(null);

  let angle = -Math.PI / 2;
  const slices = totals.map(({ g, total }) => {
    const pct = total / grand; const start = angle; angle += pct * 2 * Math.PI;
    return { g, total, pct, start, end: angle };
  });
  const arc = (r: number, start: number, end: number) => {
    const x1 = CX + r * Math.cos(start), y1 = CY + r * Math.sin(start);
    const x2 = CX + r * Math.cos(end), y2 = CY + r * Math.sin(end);
    const large = end - start > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };
  const hovSlice = slices.find(s => s.g === hovered);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 32, flexWrap: 'wrap' }}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ width: 200, height: 200, flexShrink: 0 }}>
        {slices.map(s => (
          <path key={s.g} d={arc((R + INNER) / 2, s.start, s.end)} fill="none" stroke={GROUP_COLORS[s.g]} strokeWidth={hovered === s.g ? R - INNER + 6 : R - INNER}
            opacity={hovered && hovered !== s.g ? 0.3 : 1} onMouseEnter={() => setHovered(s.g)} onMouseLeave={() => setHovered(null)}
            style={{ cursor: 'pointer', transition: 'opacity 0.15s, stroke-width 0.15s', filter: hovered === s.g ? `drop-shadow(0 0 8px ${GROUP_COLORS[s.g]}88)` : 'none' }} />
        ))}
        {hovSlice ? (
          <>
            <text x={CX} y={CY - 4} textAnchor="middle" fontSize="20" fontFamily={T.mono} fill={T.text} fontWeight="700">{(hovSlice.pct * 100).toFixed(0)}%</text>
            <text x={CX} y={CY + 14} textAnchor="middle" fontSize="10" fontFamily={T.sans} fill={T.textDim}>{hovSlice.g}</text>
          </>
        ) : (
          <>
            <text x={CX} y={CY - 3} textAnchor="middle" fontSize="11" fontFamily={T.sans} fill={T.textDim}>Total</text>
            <text x={CX} y={CY + 15} textAnchor="middle" fontSize="13" fontFamily={T.mono} fill={T.text} fontWeight="600">{fmt(grand)}</text>
          </>
        )}
      </svg>
      <div style={{ flex: 1, minWidth: 240 }}>
        {slices.map(s => (
          <div key={s.g} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', opacity: hovered && hovered !== s.g ? 0.4 : 1, transition: 'opacity 0.15s', cursor: 'pointer' }}
            onMouseEnter={() => setHovered(s.g)} onMouseLeave={() => setHovered(null)}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: GROUP_COLORS[s.g], flexShrink: 0, boxShadow: `0 0 8px ${GROUP_COLORS[s.g]}66` }} />
            <span style={{ fontSize: 13, color: T.textMid, flex: 1, fontWeight: 500 }}>{s.g}</span>
            <span style={{ fontSize: 12, fontFamily: T.mono, color: T.textDim, width: 44, textAlign: 'right' }}>{(s.pct * 100).toFixed(1)}%</span>
            <span style={{ fontSize: 12.5, fontFamily: T.mono, color: T.text, width: 96, textAlign: 'right', fontWeight: 600 }}>{fmt(s.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function IncomeExpenseChart({ data, fmt }: { data: { month: string; income: number; expense: number }[]; fmt: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 660, H = 240, PL = 64, PR = 16, PT = 16, PB = 34;
  const iW = W - PL - PR, iH = H - PT - PB;
  if (data.length === 0) return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}><text x={W / 2} y={H / 2} textAnchor="middle" fontSize="13" fill={T.textDim} fontFamily={T.sans}>No data</text></svg>;
  const max = Math.max(...data.flatMap(d => [d.income, d.expense])) * 1.12;
  const toY = (v: number) => PT + iH - (v / max) * iH;
  const band = iW / data.length;
  const bw = Math.min(26, band / 3);
  const ticks = [0, 0.5, 1].map(t => Math.round(max * t / 100000) * 100000);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {ticks.map(t => (
        <g key={t}>
          <line x1={PL} x2={W - PR} y1={toY(t)} y2={toY(t)} stroke="rgba(255,255,255,0.06)" />
          <text x={PL - 8} y={toY(t) + 4} textAnchor="end" fontSize="10" fill={T.textFaint} fontFamily={T.mono}>{t >= 1000000 ? (t / 1000000).toFixed(1) + 'M' : (t / 1000) + 'k'}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = PL + band * i + band / 2;
        const net = d.income - d.expense;
        return (
          <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={cx - bw - 2} y={toY(d.income)} width={bw} height={toY(0) - toY(d.income)} rx="3" fill={T.pos} opacity={hover === null || hover === i ? 1 : 0.4} />
            <rect x={cx + 2} y={toY(d.expense)} width={bw} height={toY(0) - toY(d.expense)} rx="3" fill={T.neg} opacity={hover === null || hover === i ? 1 : 0.4} />
            <text x={cx} y={H - 8} textAnchor="middle" fontSize="10.5" fill={T.textDim} fontFamily={T.sans}>{d.month}</text>
            {hover === i && <text x={cx} y={toY(Math.max(d.income, d.expense)) - 8} textAnchor="middle" fontSize="11" fontFamily={T.mono} fontWeight="700" fill={net >= 0 ? T.pos : T.neg}>{net >= 0 ? '+' : ''}{fmt(net)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function AreaLineChart({ data, valueOf, color, fmt, suffix }: {
  data: { month: string }[];
  valueOf: (d: { month: string }) => number;
  color: string;
  fmt: (n: number) => string;
  suffix?: string;
}) {
  const W = 660, H = 240, PL = 64, PR = 16, PT = 16, PB = 34;
  const iW = W - PL - PR, iH = H - PT - PB;
  const vals = data.map(valueOf);
  const max = Math.max(...vals) * 1.12, min = Math.min(0, ...vals);
  const toX = (i: number) => PL + (i / (data.length - 1)) * iW;
  const toY = (v: number) => PT + iH - ((v - min) / (max - min)) * iH;
  const [hover, setHover] = useState<number | null>(null);

  if (data.length < 2) return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}><text x={W/2} y={H/2} textAnchor="middle" fontSize="13" fill={T.textDim} fontFamily={T.sans}>No data</text></svg>;

  const line = vals.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
  const area = `${PL},${toY(min)} ` + line + ` ${toX(data.length - 1)},${toY(min)}`;
  const ticks = [0, 0.5, 1].map(t => min + (max - min) * t);
  const gradId = 'ar' + color.replace(/[^a-z0-9]/gi, '');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs><linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.25" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PL} x2={W - PR} y1={toY(t)} y2={toY(t)} stroke="rgba(255,255,255,0.06)" />
          <text x={PL - 8} y={toY(t) + 4} textAnchor="end" fontSize="10" fill={T.textFaint} fontFamily={T.mono}>{suffix ? Math.round(t) + suffix : (Math.abs(t) >= 1000000 ? (t / 1000000).toFixed(1) + 'M' : Math.round(t / 1000) + 'k')}</text>
        </g>
      ))}
      <polygon points={area} fill={`url(#${gradId})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <circle cx={toX(i)} cy={toY(vals[i])} r={hover === i ? 4.5 : 3} fill={color} />
          <text x={toX(i)} y={H - 8} textAnchor="middle" fontSize="10.5" fill={T.textDim} fontFamily={T.sans}>{d.month}</text>
          {hover === i && <text x={toX(i)} y={toY(vals[i]) - 10} textAnchor="middle" fontSize="11" fontFamily={T.mono} fontWeight="700" fill={T.text}>{suffix ? vals[i] + suffix : fmt(vals[i])}</text>}
        </g>
      ))}
    </svg>
  );
}

interface Props {
  fmt: (n: number) => string;
}

export function Reports({ fmt }: Props) {
  const [activeReport, setActiveReport] = useState('trend');
  const [monthlySpending, setMonthlySpending] = useState<MonthlySpendingRow[]>([]);
  const [incomeExpense, setIncomeExpense] = useState<{ month: string; income: number; expense: number }[]>([]);
  const [netWorthData, setNetWorthData] = useState<{ month: string; net_worth: number }[]>([]);
  const [ageOfMoney, setAgeOfMoney] = useState<{ month: string; days: number }[]>([]);
  const [loadingReport, setLoadingReport] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);

  const loadReport = () => {
    setLoadingReport(true);
    setReportError(null);
    const now = new Date();
    const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const d = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    Promise.all([
      fetchSpendingReport(from, to),
      fetchIncomeExpense(from, to),
      fetchNetWorth(from, to),
      fetchAgeOfMoney(6),
    ])
      .then(([spending, ie, nw, aom]) => {
        setMonthlySpending(spending);
        setIncomeExpense(ie);
        setNetWorthData(nw);
        setAgeOfMoney(aom);
        setLoadingReport(false);
      })
      .catch(err => { setReportError(err.message); setLoadingReport(false); });
  };

  useEffect(() => { loadReport(); }, []);

  const latestAge = ageOfMoney[ageOfMoney.length - 1];
  // Convert centimos to major units for chart display (api.ts returns raw centimos)
  const incomeExpenseMajor = incomeExpense.map(d => ({
    month: d.month,
    income: d.income / 100,
    expense: d.expense / 100,
  }));
  const netWorthMajor = netWorthData.map(d => ({
    month: d.month,
    net_worth: d.net_worth / 100,
  }));
  const latestNW = netWorthMajor[netWorthMajor.length - 1];
  const keys = Object.keys(GROUP_COLORS).map(groupKey);

  const reportCards = [
    { id: 'trend',    label: 'Spending Over Time',   desc: 'Monthly totals by group',  icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 19V5M4 19h16M8 14l3.5-4 3 2.5L20 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> },
    { id: 'donut',    label: 'Spending Breakdown',   desc: 'Share of total spend',     icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3a9 9 0 1 0 9 9h-9V3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M14 3.5a9 9 0 0 1 6.5 6.5H14V3.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg> },
    { id: 'income',   label: 'Income vs Expense',    desc: 'Cash flow per month',      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M7 14V9M12 14V5M17 14v-3M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg> },
    { id: 'networth', label: 'Net Worth',             desc: 'Assets minus debt',        icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 15l5-5 4 3 7-7M4 19h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> },
    { id: 'age',      label: 'Age of Money',          desc: 'Days before spending',     icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8"/><path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  ];

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: T.text, margin: 0, letterSpacing: '-0.03em' }}>Reports</h2>
        <div style={st.rangeBox}>
          <span style={{ fontSize: 12, color: T.textDim, fontWeight: 600 }}>From</span>
          <input type="month" defaultValue="2025-11" style={st.dateInput} />
          <span style={{ fontSize: 12, color: T.textDim }}>→</span>
          <input type="month" defaultValue="2026-04" style={st.dateInput} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {reportCards.map(r => {
          const on = activeReport === r.id;
          return (
            <button key={r.id} onClick={() => setActiveReport(r.id)} style={{ ...st.reportCard, ...(on ? st.reportCardOn : {}) }}>
              <span style={{ ...st.reportIcon, color: on ? 'var(--accent)' : T.textDim, background: on ? T.accentDim : 'rgba(255,255,255,0.04)' }}>{r.icon}</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: on ? T.text : T.textMid }}>{r.label}</div>
                <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{r.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div style={st.panel}>
        {reportError ? (
          <div style={{ padding: '32px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: T.neg, flex: 1 }}>{reportError}</span>
            <button onClick={loadReport} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 7, padding: '5px 12px', fontSize: 12, color: T.textMid, cursor: 'pointer' }}>Retry</button>
          </div>
        ) : loadingReport ? (
          <div style={{ padding: '60px 18px', textAlign: 'center', color: T.textDim, fontSize: 13 }}>Loading report…</div>
        ) : <>
          {activeReport === 'trend' && (
            <>
              <div style={st.panelHeader}><span>Spending by Category Group</span><span style={st.panelMeta}>Nov 2025 – Apr 2026</span></div>
              <div style={{ display: 'flex', gap: 16, padding: '12px 18px', flexWrap: 'wrap' }}>
                {Object.entries(GROUP_COLORS).map(([g, color]) => (
                  <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 9, height: 9, borderRadius: 2.5, background: color, boxShadow: `0 0 7px ${color}66` }} />
                    <span style={{ fontSize: 12, color: T.textMid, fontWeight: 500 }}>{g}</span>
                  </div>
                ))}
              </div>
              <div style={{ padding: '0 14px 16px' }}><LineChart data={monthlySpending} /></div>
            </>
          )}
          {activeReport === 'donut' && (
            <>
              <div style={st.panelHeader}><span>Spending Breakdown</span><span style={st.panelMeta}>Last 6 months</span></div>
              <div style={{ padding: '24px 28px' }}><DonutChart data={monthlySpending} fmt={fmt} /></div>
            </>
          )}
          {activeReport === 'income' && (
            <>
              <div style={st.panelHeader}><span>Income vs Expense</span><span style={st.panelMeta}>Nov 2025 – Apr 2026</span></div>
              <div style={{ display: 'flex', gap: 16, padding: '12px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 2.5, background: T.pos }} /><span style={{ fontSize: 12, color: T.textMid }}>Income</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 2.5, background: T.neg }} /><span style={{ fontSize: 12, color: T.textMid }}>Expense</span></div>
              </div>
              <div style={{ padding: '0 14px 16px' }}><IncomeExpenseChart data={incomeExpenseMajor} fmt={fmt} /></div>
            </>
          )}
          {activeReport === 'networth' && (
            <>
              <div style={st.panelHeader}><span>Net Worth</span><span style={st.panelMeta}>{latestNW ? fmt(latestNW.net_worth) : '—'} today</span></div>
              <div style={{ padding: '12px 14px 16px' }}><AreaLineChart data={netWorthMajor} valueOf={d => (d as { month: string; net_worth: number }).net_worth} color="#5b9dff" fmt={fmt} /></div>
            </>
          )}
          {activeReport === 'age' && (
            <>
              <div style={st.panelHeader}><span>Age of Money</span><span style={st.panelMeta}>{latestAge ? latestAge.days + ' days' : '—'}</span></div>
              <div style={{ padding: '12px 14px 16px' }}><AreaLineChart data={ageOfMoney} valueOf={d => (d as { month: string; days: number }).days} color="#3ddc97" fmt={fmt} suffix="d" /></div>
            </>
          )}
        </>}
      </div>

      {(activeReport === 'trend' || activeReport === 'donut') && (
        <div style={{ ...st.panel, marginTop: 16 }}>
          <div style={st.panelHeader}><span>Monthly Summary</span></div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...st.th, textAlign: 'left' }}>Month</th>
                  {Object.entries(GROUP_COLORS).map(([g, c]) => <th key={g} style={{ ...st.th, textAlign: 'right' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: c }} />{g}</span></th>)}
                  <th style={{ ...st.th, textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {monthlySpending.map(row => {
                  const total = keys.reduce((s, k) => s + ((row as Record<string, number>)[k] || 0), 0);
                  return (
                    <tr key={row.month} style={{ transition: 'background 0.1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ ...st.td, fontWeight: 600, color: T.text }}>{row.month}</td>
                      {keys.map(k => <td key={k} style={{ ...st.td, textAlign: 'right', fontFamily: T.mono, fontSize: 12, color: (row as Record<string, number>)[k] ? T.textMid : T.textFaint }}>{(row as Record<string, number>)[k] ? fmt((row as Record<string, number>)[k]) : '—'}</td>)}
                      <td style={{ ...st.td, textAlign: 'right', fontFamily: T.mono, fontSize: 12.5, fontWeight: 700, color: T.text }}>{fmt(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const st = {
  rangeBox:     { display: 'flex', alignItems: 'center', gap: 8, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 9, padding: '5px 12px' },
  dateInput:    { padding: '4px 6px', fontSize: 12.5, border: 'none', background: 'transparent', color: T.text, fontFamily: T.mono },
  reportCard:   { display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, cursor: 'pointer', transition: 'all 0.14s', flex: '0 0 auto' as const, boxShadow: T.shadowSm },
  reportCardOn: { borderColor: T.borderHi, background: `linear-gradient(135deg, ${T.accentDim}, ${T.surface} 70%)` },
  reportIcon:   { width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.14s' },
  panel:        { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: 'hidden', boxShadow: T.shadow },
  panelHeader:  { padding: '14px 18px', fontSize: 13, fontWeight: 700, color: T.text, borderBottom: `1px solid ${T.border}`, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  panelMeta:    { fontSize: 11.5, fontWeight: 500, color: T.textDim, fontFamily: T.mono },
  th:           { padding: '11px 14px', fontSize: 10, fontWeight: 700, color: T.textDim, letterSpacing: '0.05em', textTransform: 'uppercase' as const, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' as const, background: 'rgba(255,255,255,0.015)' },
  td:           { padding: '10px 14px', fontSize: 13, color: T.textMid, borderBottom: `1px solid ${T.borderSoft}` },
};
