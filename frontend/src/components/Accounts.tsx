import { useState, useMemo, useEffect } from 'react';
import { fetchAccountTransactions } from '../api';
import { T, GROUP_COLORS } from '../theme';
import { AppData } from '../data';
import { ReconcileModal, RulesManager, SplitModal } from './AccountsModals';
import type { Transaction, Account, CategoryGroup, PayeeRule } from '../data';

function SortIcon({ col, sortCol, sortDir }: { col: string; sortCol: string; sortDir: string }) {
  const on = sortCol === col;
  return <span style={{ marginLeft: 4, color: on ? 'var(--accent)' : T.textFaint, fontSize: 9 }}>{on ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
}

interface EditableRowProps {
  t: Transaction;
  categories: string[];
  catColor: (cat: string) => string;
  onSave: (t: Transaction) => void;
  onToggleSelect: (id: string) => void;
  selected: boolean;
  fmt: (n: number) => string;
  rowPad: string;
  onSplit: (t: Transaction) => void;
  onToggleCleared: (id: string) => void;
}

function EditableRow({ t, categories, catColor, onSave, onToggleSelect, selected, fmt, rowPad, onSplit, onToggleCleared }: EditableRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(t);
  const commit = () => { onSave(draft); setEditing(false); };
  const cancel = () => { setDraft(t); setEditing(false); };
  const fmtDate = (d: string) => d.slice(5).replace('-', '/');

  if (editing) {
    return (
      <tr style={{ background: T.accentDim }}>
        <td style={st.td}><input type="checkbox" checked={selected} onChange={() => onToggleSelect(t.id)} style={st.check} /></td>
        <td style={st.td}><input value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} style={st.inlineInput} /></td>
        <td style={st.td}><input value={draft.payee} onChange={e => setDraft(d => ({ ...d, payee: e.target.value }))} style={{ ...st.inlineInput, width: 150 }} /></td>
        <td style={st.td}>
          <select value={draft.category ?? ''} onChange={e => setDraft(d => ({ ...d, category: e.target.value || null }))} style={st.inlineSelect}>
            <option value="">—</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </td>
        <td style={st.td}><input value={draft.memo} onChange={e => setDraft(d => ({ ...d, memo: e.target.value }))} style={{ ...st.inlineInput, width: 130 }} /></td>
        <td style={{ ...st.td, textAlign: 'right' }}><input value={draft.outflow || ''} onChange={e => setDraft(d => ({ ...d, outflow: Number(e.target.value) }))} style={{ ...st.inlineInput, width: 84, textAlign: 'right' }} /></td>
        <td style={{ ...st.td, textAlign: 'right' }}><input value={draft.inflow || ''} onChange={e => setDraft(d => ({ ...d, inflow: Number(e.target.value) }))} style={{ ...st.inlineInput, width: 84, textAlign: 'right' }} /></td>
        <td style={{ ...st.td, textAlign: 'center' }}><input type="checkbox" checked={draft.cleared} onChange={e => setDraft(d => ({ ...d, cleared: e.target.checked }))} style={st.check} /></td>
        <td style={st.td}>
          <div style={{ display: 'flex', gap: 5 }}>
            <button onClick={commit} style={st.saveBtn}>Save</button>
            <button onClick={cancel} style={st.cancelBtn}>✕</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr onClick={() => setEditing(true)} style={{ cursor: 'pointer', background: selected ? T.accentDim : 'transparent', transition: 'background 0.1s' }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}>
      <td style={{ ...st.td, padding: rowPad + ' 12px' }} onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected} onChange={() => onToggleSelect(t.id)} style={st.check} /></td>
      <td style={{ ...st.td, padding: rowPad + ' 12px', fontFamily: T.mono, fontSize: 12, color: T.textDim }}>{fmtDate(t.date)}</td>
      <td style={{ ...st.td, padding: rowPad + ' 12px', fontWeight: 600, color: T.text }}>{t.payee}</td>
      <td style={{ ...st.td, padding: rowPad + ' 12px' }}>
        {t.splits
          ? <span style={st.splitChip} title={t.splits.map(s => s.category + ' ' + fmt(s.amount)).join('  ·  ')}>⑂ Split · {t.splits.length}</span>
          : t.category
            ? <span style={{ ...st.catTag, color: catColor(t.category) }}><span style={{ width: 6, height: 6, borderRadius: 2, background: 'currentColor' }} />{t.category}</span>
            : <span style={{ color: T.textFaint, fontSize: 12 }}>uncategorized</span>}
      </td>
      <td style={{ ...st.td, padding: rowPad + ' 12px', color: T.textDim, fontSize: 12 }}>{t.memo || '—'}</td>
      <td style={{ ...st.td, padding: rowPad + ' 12px', textAlign: 'right', fontFamily: T.mono, fontSize: 12.5, color: T.textMid }}>{t.outflow > 0 ? fmt(t.outflow) : ''}</td>
      <td style={{ ...st.td, padding: rowPad + ' 12px', textAlign: 'right', fontFamily: T.mono, fontSize: 12.5, color: T.pos, fontWeight: 600 }}>{t.inflow > 0 ? '+' + fmt(t.inflow) : ''}</td>
      <td style={{ ...st.td, padding: rowPad + ' 12px', textAlign: 'center' }} onClick={e => { e.stopPropagation(); onToggleCleared(t.id); }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', cursor: 'pointer', background: t.cleared ? T.pos : 'transparent', border: t.cleared ? 'none' : `1.5px solid ${T.textFaint}`, boxShadow: t.cleared ? `0 0 7px ${T.pos}` : 'none' }} />
      </td>
      <td style={{ ...st.td, padding: rowPad + ' 8px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <button onClick={() => onSplit(t)} style={st.splitBtn}>⑂</button>
      </td>
    </tr>
  );
}

interface Props {
  accounts: { budget: Account[]; tracking: Account[] };
  accountId: string;
  categoryGroups: CategoryGroup[];
  fmt: (n: number) => string;
  density: string;
}

export function Accounts({ accounts, accountId, categoryGroups, fmt, density }: Props) {
  const allAccounts = [...accounts.budget, ...accounts.tracking];
  const account = allAccounts.find(a => a.id === accountId) ?? allAccounts[0];
  const categories = categoryGroups.flatMap(g => g.categories);
  const catColor = (cat: string) => GROUP_COLORS[categoryGroups.find(g => g.categories.includes(cat))?.name ?? ''] ?? T.textMid;
  const rowPad = density === 'compact' ? '6px' : '10px';

  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(false);

  useEffect(() => {
    setLoadingTxns(true);
    setTxns([]);
    fetchAccountTransactions(accountId)
      .then(setTxns)
      .catch(err => console.error('fetch transactions:', err))
      .finally(() => setLoadingTxns(false));
  }, [accountId]);

  const [selected, setSelected] = useState(new Set<string>());
  const [sortCol, setSortCol] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter] = useState({ payee: '', category: '', from: '', to: '' });
  const [rules, setRules] = useState<PayeeRule[]>([...AppData.payeeRules]);
  const [modal, setModal] = useState<null | 'reconcile' | 'rules' | { split: Transaction }>(null);
  const [dismissedSched, setDismissedSched] = useState(new Set<string>());

  const upcoming = AppData.scheduled.filter(s => s.account === account.id && !dismissedSched.has(s.id));

  const enterScheduled = (s: typeof AppData.scheduled[0]) => {
    setTxns(ts => [{ id: crypto.randomUUID(), date: s.next, payee: s.payee, category: s.category, memo: 'Scheduled', outflow: s.amount < 0 ? -s.amount : 0, inflow: s.amount > 0 ? s.amount : 0, cleared: false, account: s.account }, ...ts]);
    setDismissedSched(d => new Set(d).add(s.id));
  };
  const skipScheduled = (id: string) => setDismissedSched(d => new Set(d).add(id));
  const toggleCleared = (id: string) => setTxns(ts => ts.map(t => t.id === id ? { ...t, cleared: !t.cleared } : t));
  const saveSplit = (id: string, splits: { category: string; amount: number }[]) =>
    setTxns(ts => ts.map(t => t.id === id ? { ...t, splits: splits.length > 1 ? splits : undefined, category: splits.length === 1 ? splits[0].category : (splits.length > 1 ? null : t.category) } : t));

  const reconcile = (diff: number) => {
    setTxns(ts => {
      let next = ts.map(t => t.account === account.id ? { ...t, cleared: true } : t);
      if (diff !== 0) next = [{ id: crypto.randomUUID(), date: new Date().toISOString().slice(0, 10), payee: 'Reconciliation Adjustment', category: null, memo: 'Balance adjustment', outflow: diff < 0 ? -diff : 0, inflow: diff > 0 ? diff : 0, cleared: true, account: account.id }, ...next];
      return next;
    });
    setModal(null);
  };

  const toggleSelect = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const handleSort = (col: string) => { if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('asc'); } };
  const handleSave = (updated: Transaction) => setTxns(ts => ts.map(t => t.id === updated.id ? updated : t));

  const filtered = useMemo(() => txns
    .filter(t => t.account === account.id)
    .filter(t => !filter.payee || t.payee.toLowerCase().includes(filter.payee.toLowerCase()))
    .filter(t => !filter.category || t.category === filter.category)
    .filter(t => !filter.from || t.date >= filter.from)
    .filter(t => !filter.to || t.date <= filter.to)
    .sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortCol] as string | number ?? '';
      const bv = (b as unknown as Record<string, unknown>)[sortCol] as string | number ?? '';
      const aStr = typeof av === 'string' ? av.toLowerCase() : av;
      const bStr = typeof bv === 'string' ? bv.toLowerCase() : bv;
      return sortDir === 'asc' ? (aStr > bStr ? 1 : -1) : (aStr < bStr ? 1 : -1);
    }),
    [txns, account.id, filter, sortCol, sortDir]);

  const toggleAll = () => setSelected(s => s.size === filtered.length ? new Set() : new Set(filtered.map(t => t.id)));

  const totals = useMemo(() => ({
    out: filtered.reduce((s, t) => s + t.outflow, 0),
    inf: filtered.reduce((s, t) => s + t.inflow, 0),
    count: filtered.length,
  }), [filtered]);

  const cols = [
    { key: 'date', label: 'Date' }, { key: 'payee', label: 'Payee' }, { key: 'category', label: 'Category' },
    { key: 'memo', label: 'Memo' }, { key: 'outflow', label: 'Outflow' }, { key: 'inflow', label: 'Inflow' }, { key: 'cleared', label: 'C' },
  ];
  const hasFilter = filter.payee || filter.category || filter.from || filter.to;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1180, margin: '0 auto' }}>
      <div style={st.head}>
        <div>
          <div style={st.acctType}>{accounts.budget.find(a => a.id === account.id) ? 'Budget Account' : 'Tracking Account'}</div>
          <h2 style={st.pageTitle}>{account.name}</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setModal('rules')} style={st.headerBtn}>Rules</button>
            <button onClick={() => setModal('reconcile')} style={st.headerBtnAccent}>Reconcile</button>
          </div>
          <div style={st.balCard}>
            <span style={st.balLabel}>Working Balance</span>
            <span style={{ ...st.balance, color: account.balance < 0 ? T.neg : T.text }}>{fmt(account.balance)}</span>
          </div>
        </div>
      </div>

      {upcoming.length > 0 && (
        <div style={st.upcoming}>
          <div style={st.upcomingHead}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={st.schedDot} />Upcoming · {upcoming.length} scheduled</span>
          </div>
          {upcoming.map(s => (
            <div key={s.id} style={st.schedRow}>
              <span style={{ fontFamily: T.mono, fontSize: 12, color: T.textDim, width: 64 }}>{s.next.slice(5).replace('-', '/')}</span>
              <span style={{ fontWeight: 600, color: T.text, flex: 1 }}>{s.payee}</span>
              <span style={st.freqChip}>{s.freq}</span>
              <span style={{ fontFamily: T.mono, fontSize: 12.5, fontWeight: 600, color: s.amount > 0 ? T.pos : T.textMid, width: 96, textAlign: 'right' }}>{s.amount > 0 ? '+' : '−'}{fmt(Math.abs(s.amount))}</span>
              <button onClick={() => enterScheduled(s)} style={st.enterBtn}>Enter</button>
              <button onClick={() => skipScheduled(s.id)} style={st.skipBtn}>Skip</button>
            </div>
          ))}
        </div>
      )}

      <div style={st.statRow}>
        <div style={st.stat}><span style={st.statNum}>{totals.count}</span><span style={st.statLbl}>transactions</span></div>
        <div style={st.stat}><span style={{ ...st.statNum, color: T.textMid }}>−{fmt(totals.out)}</span><span style={st.statLbl}>outflow</span></div>
        <div style={st.stat}><span style={{ ...st.statNum, color: T.pos }}>+{fmt(totals.inf)}</span><span style={st.statLbl}>inflow</span></div>
      </div>

      <div style={st.filterBar}>
        <div style={st.searchWrap}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="7" stroke={T.textDim} strokeWidth="1.8"/><path d="m20 20-3.5-3.5" stroke={T.textDim} strokeWidth="1.8" strokeLinecap="round"/></svg>
          <input placeholder="Search payee…" value={filter.payee} onChange={e => setFilter(f => ({ ...f, payee: e.target.value }))} style={{ ...st.filterInput, paddingLeft: 32, width: 200 }} />
        </div>
        <select value={filter.category} onChange={e => setFilter(f => ({ ...f, category: e.target.value }))} style={st.filterSelect}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="date" value={filter.from} onChange={e => setFilter(f => ({ ...f, from: e.target.value }))} style={st.filterInput} />
        <span style={{ color: T.textFaint, fontSize: 12 }}>→</span>
        <input type="date" value={filter.to} onChange={e => setFilter(f => ({ ...f, to: e.target.value }))} style={st.filterInput} />
        {hasFilter && <button onClick={() => setFilter({ payee: '', category: '', from: '', to: '' })} style={st.clearBtn}>Clear</button>}
        {selected.size > 0 && <button style={{ ...st.clearBtn, color: T.neg, borderColor: T.negDim, background: T.negDim, marginLeft: 'auto' }}>Delete {selected.size}</button>}
      </div>

      {loadingTxns && (
        <div style={{ padding: '20px', textAlign: 'center', color: T.textDim, fontSize: 13 }}>
          Loading transactions…
        </div>
      )}

      <div style={st.tableWrap}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={st.th}><input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} style={st.check} /></th>
              {cols.map(({ key, label }) => (
                <th key={key} onClick={() => handleSort(key)} style={{ ...st.th, cursor: 'pointer', textAlign: ['outflow', 'inflow', 'cleared'].includes(key) ? 'right' : 'left' }}>
                  {label}<SortIcon col={key} sortCol={sortCol} sortDir={sortDir} />
                </th>
              ))}
              <th style={st.th} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: T.textDim, fontSize: 13 }}>No transactions match your filters</td></tr>}
            {filtered.map(t => <EditableRow key={t.id} t={t} categories={categories} catColor={catColor} onSave={handleSave} onToggleSelect={toggleSelect} selected={selected.has(t.id)} fmt={fmt} rowPad={rowPad} onSplit={tx => setModal({ split: tx })} onToggleCleared={toggleCleared} />)}
          </tbody>
        </table>
      </div>

      {modal === 'reconcile' && <ReconcileModal account={account} clearedBalance={account.balance} fmt={fmt} onClose={() => setModal(null)} onReconcile={reconcile} />}
      {modal === 'rules' && <RulesManager rules={rules} categories={categories} onClose={() => setModal(null)} onAdd={r => setRules(rs => [...rs, r])} onDelete={id => setRules(rs => rs.filter(x => x.id !== id))} />}
      {modal && typeof modal === 'object' && 'split' in modal && <SplitModal txn={modal.split} categories={categories} fmt={fmt} onClose={() => setModal(null)} onSave={saveSplit} />}
    </div>
  );
}

const st = {
  head:            { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 },
  acctType:        { fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: 4 },
  pageTitle:       { fontSize: 24, fontWeight: 800, color: T.text, margin: 0, letterSpacing: '-0.03em' },
  balCard:         { display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end' },
  balLabel:        { fontSize: 11, fontWeight: 600, color: T.textDim, letterSpacing: '0.04em' },
  balance:         { fontSize: 24, fontFamily: T.mono, fontWeight: 700, letterSpacing: '-0.02em' },
  statRow:         { display: 'flex', gap: 28, padding: '14px 20px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, marginBottom: 16, boxShadow: T.shadowSm },
  stat:            { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  statNum:         { fontSize: 18, fontWeight: 700, fontFamily: T.mono, color: T.text },
  statLbl:         { fontSize: 11, color: T.textDim, fontWeight: 500, letterSpacing: '0.03em' },
  filterBar:       { display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' as const },
  searchWrap:      { position: 'relative' as const, display: 'flex', alignItems: 'center' },
  filterInput:     { padding: '8px 11px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface, color: T.text, transition: 'border-color 0.12s' },
  filterSelect:    { padding: '8px 11px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface, color: T.text, cursor: 'pointer' },
  clearBtn:        { padding: '8px 13px', fontSize: 12.5, fontWeight: 600, border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface, cursor: 'pointer', color: T.textMid },
  tableWrap:       { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: 'hidden', boxShadow: T.shadow },
  th:              { padding: '11px 12px', fontSize: 10.5, fontWeight: 700, color: T.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const, borderBottom: `1px solid ${T.border}`, userSelect: 'none' as const, whiteSpace: 'nowrap' as const, background: 'rgba(255,255,255,0.015)' },
  td:              { padding: '10px 12px', fontSize: 13, color: T.textMid, borderBottom: `1px solid ${T.borderSoft}` },
  catTag:          { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '3px 9px', fontSize: 11.5, fontWeight: 600 },
  splitChip:       { display: 'inline-flex', alignItems: 'center', gap: 5, background: T.accentDim, color: 'var(--accent)', borderRadius: 6, padding: '3px 9px', fontSize: 11.5, fontWeight: 600, cursor: 'help' as const },
  splitBtn:        { width: 24, height: 24, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}`, color: T.textDim, cursor: 'pointer', fontSize: 13, lineHeight: 1 },
  headerBtn:       { padding: '8px 14px', fontSize: 12.5, fontWeight: 600, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textMid, cursor: 'pointer' },
  headerBtnAccent: { padding: '8px 14px', fontSize: 12.5, fontWeight: 700, background: T.accentDim, border: `1px solid var(--accent)`, borderRadius: 8, color: 'var(--accent)', cursor: 'pointer' },
  upcoming:        { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, marginBottom: 16, overflow: 'hidden', boxShadow: T.shadowSm },
  upcomingHead:    { padding: '10px 16px', fontSize: 11.5, fontWeight: 700, color: T.textMid, letterSpacing: '0.04em', textTransform: 'uppercase' as const, borderBottom: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.015)' },
  schedDot:        { width: 7, height: 7, borderRadius: '50%', background: T.warn, boxShadow: `0 0 7px ${T.warn}`, display: 'inline-block' },
  schedRow:        { display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px', borderBottom: `1px solid ${T.borderSoft}` },
  freqChip:        { fontSize: 10.5, fontWeight: 600, color: T.textDim, background: 'rgba(255,255,255,0.04)', borderRadius: 5, padding: '2px 8px' },
  enterBtn:        { padding: '5px 12px', fontSize: 12, fontWeight: 700, background: 'var(--accent)', color: '#06140d', border: 'none', borderRadius: 7, cursor: 'pointer' },
  skipBtn:         { padding: '5px 10px', fontSize: 12, fontWeight: 600, background: 'none', color: T.textDim, border: `1px solid ${T.border}`, borderRadius: 7, cursor: 'pointer' },
  check:           { accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' },
  inlineInput:     { padding: '5px 8px', fontSize: 12.5, border: `1px solid var(--accent)`, borderRadius: 6, fontFamily: T.mono, background: T.surface2, color: T.text, width: 96 },
  inlineSelect:    { padding: '5px 8px', fontSize: 12, border: `1px solid var(--accent)`, borderRadius: 6, background: T.surface2, color: T.text },
  saveBtn:         { padding: '5px 11px', fontSize: 12, fontWeight: 700, background: 'var(--accent)', color: '#06140d', border: 'none', borderRadius: 6, cursor: 'pointer' },
  cancelBtn:       { padding: '5px 9px', fontSize: 12, background: 'none', color: T.textDim, border: `1px solid ${T.border}`, borderRadius: 6, cursor: 'pointer' },
};
