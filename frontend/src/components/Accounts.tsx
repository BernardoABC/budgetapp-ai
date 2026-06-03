import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { updateTransaction, deleteTransaction, createTransaction, fetchTransactionsPage, batchTransactions, type TxnPage, type TxnFilterParams } from '../api';
import { useToast } from './Toast';
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
  onToggleCleared: (t: Transaction) => void;
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
      <td style={{ ...st.td, padding: rowPad + ' 12px', textAlign: 'center' }} onClick={e => { e.stopPropagation(); onToggleCleared(t); }}>
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
  categoryIdByName: Record<string, string>;
  onAccountsChanged: () => void;
}

export function Accounts({ accounts, accountId, categoryGroups, fmt, density, categoryIdByName, onAccountsChanged }: Props) {
  const allAccounts = [...accounts.budget, ...accounts.tracking];
  const account = allAccounts.find(a => a.id === accountId) ?? allAccounts[0];
  const categories = categoryGroups.flatMap(g => g.categories);
  const catColor = (cat: string) => GROUP_COLORS[categoryGroups.find(g => g.categories.includes(cat))?.name ?? ''] ?? T.textMid;
  const rowPad = density === 'compact' ? '6px' : '10px';

  const toast = useToast();

  // reverse map: categoryId -> name, for display purposes
  const catNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [name, id] of Object.entries(categoryIdByName)) m[id] = name;
    return m;
  }, [categoryIdByName]);
  void catNameById; // scaffolding for Task 8

  const [page, setPage] = useState<TxnPage | null>(null);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAddTxn, setShowAddTxn] = useState(false);
  const [addForm, setAddForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    payee: '', category: '', outflow: '', inflow: '', memo: '', cleared: false,
  });
  const [addSaving, setAddSaving] = useState(false);

  const [selected, setSelected] = useState(new Set<string>());
  const [sort, setSort] = useState('date_desc');
  const [filter, setFilter] = useState({ payee: '', category: '', from: '', to: '' });
  const [pageNum, setPageNum] = useState(1);
  const [rules, setRules] = useState<PayeeRule[]>([...AppData.payeeRules]);
  const [modal, setModal] = useState<null | 'reconcile' | 'rules' | { split: Transaction }>(null);
  const [dismissedSched, setDismissedSched] = useState(new Set<string>());

  const txns = page?.transactions ?? [];

  const buildParams = useCallback((): TxnFilterParams => {
    const categoryId =
      filter.category === '' ? undefined :
      filter.category === '__uncategorized__' ? 'none' :
      (categoryIdByName[filter.category] ?? undefined);
    return {
      search: filter.payee || undefined,
      from_date: filter.from || undefined,
      to_date: filter.to || undefined,
      category_id: categoryId,
      sort,
      page: pageNum,
      per_page: 50,
    };
  }, [filter, sort, pageNum, categoryIdByName]);

  const reload = useCallback(() => {
    setLoadingTxns(true);
    setLoadError(null);
    return fetchTransactionsPage(accountId, buildParams())
      .then(setPage)
      .catch(err => { console.error('fetch transactions:', err); setLoadError(err.message ?? 'Failed to load'); })
      .finally(() => setLoadingTxns(false));
  }, [accountId, buildParams]);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { reload(); }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [reload]);

  useEffect(() => {
    setPageNum(1);
    setSelected(new Set());
    setFilter({ payee: '', category: '', from: '', to: '' });
  }, [accountId]);

  const upcoming = AppData.scheduled.filter(s => s.account === account.id && !dismissedSched.has(s.id));

  const enterScheduled = (s: typeof AppData.scheduled[0]) => {
    setDismissedSched(d => new Set(d).add(s.id));
    toast.info('Scheduled entry handling is not yet wired to the API');
  };
  const skipScheduled = (id: string) => setDismissedSched(d => new Set(d).add(id));

  const toggleSelect = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleSort = (col: string) => {
    const key = col === 'outflow' || col === 'inflow' ? 'amount' : col;
    setSort(prev => {
      const asc = key + '_asc', desc = key + '_desc';
      return prev === desc ? asc : desc;
    });
    setPageNum(1);
  };

  const sortCol = (() => { const k = sort.replace(/_(asc|desc)$/, ''); return k === 'amount' ? 'outflow' : k; })();
  const sortDir = sort.endsWith('_asc') ? 'asc' : 'desc';

  const handleSave = (updated: Transaction) => {
    const amount = updated.inflow > 0 ? updated.inflow : -updated.outflow;
    const category_id = updated.category ? (categoryIdByName[updated.category] ?? undefined) : undefined;
    updateTransaction(updated.id, {
      date: updated.date, payee: updated.payee, category_id, amount,
      memo: updated.memo, cleared: updated.cleared,
    })
      .then(() => { toast.success('Transaction updated'); onAccountsChanged(); reload(); })
      .catch(err => { console.error('save transaction failed:', err); toast.error('Save failed: ' + err.message); reload(); });
  };

  const toggleCleared = (t: Transaction) => {
    const amount = t.inflow > 0 ? t.inflow : -t.outflow;
    const category_id = t.category ? (categoryIdByName[t.category] ?? undefined) : undefined;
    setPage(p => p ? { ...p, transactions: p.transactions.map(x => x.id === t.id ? { ...x, cleared: !x.cleared } : x) } : p);
    updateTransaction(t.id, { date: t.date, payee: t.payee, category_id, amount, memo: t.memo, cleared: !t.cleared })
      .then(() => { onAccountsChanged(); reload(); })
      .catch(err => { console.error('toggle cleared failed:', err); toast.error('Could not update cleared status'); reload(); });
  };

  const saveSplit = () => { setModal(null); toast.info('Split persistence is not yet wired to the API'); };
  const reconcile = (_diff: number) => { setModal(null); toast.info('Reconcile persistence is not yet wired to the API'); };

  const handleAddTxn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddSaving(true);
    const amount = parseFloat(addForm.inflow) > 0 ? parseFloat(addForm.inflow) : -(parseFloat(addForm.outflow) || 0);
    const category_id = addForm.category ? (categoryIdByName[addForm.category] ?? undefined) : undefined;
    try {
      await createTransaction(accountId, {
        date: addForm.date, payee: addForm.payee, category_id, amount,
        memo: addForm.memo, cleared: addForm.cleared,
      });
      setShowAddTxn(false);
      setAddForm({ date: new Date().toISOString().slice(0, 10), payee: '', category: '', outflow: '', inflow: '', memo: '', cleared: false });
      toast.success('Transaction added');
      onAccountsChanged();
      reload();
    } catch (err) {
      console.error('create transaction failed:', err);
      toast.error('Add failed: ' + (err as Error).message);
    } finally {
      setAddSaving(false);
    }
  };

  const toggleAll = () => setSelected(s => s.size === txns.length ? new Set() : new Set(txns.map(t => t.id)));

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
        <div style={st.stat}><span style={st.statNum}>{page?.pagination.total ?? 0}</span><span style={st.statLbl}>transactions</span></div>
        <div style={st.stat}><span style={{ ...st.statNum, color: T.textMid }}>−{fmt(page?.summary.total_outflow ?? 0)}</span><span style={st.statLbl}>outflow</span></div>
        <div style={st.stat}><span style={{ ...st.statNum, color: T.pos }}>+{fmt(page?.summary.total_inflow ?? 0)}</span><span style={st.statLbl}>inflow</span></div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button onClick={() => setShowAddTxn(true)} style={st.headerBtnAccent}>+ New Transaction</button>
      </div>

      <div style={st.filterBar}>
        <div style={st.searchWrap}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="7" stroke={T.textDim} strokeWidth="1.8"/><path d="m20 20-3.5-3.5" stroke={T.textDim} strokeWidth="1.8" strokeLinecap="round"/></svg>
          <input placeholder="Search payee…" value={filter.payee} onChange={e => { setFilter(f => ({ ...f, payee: e.target.value })); setPageNum(1); }} style={{ ...st.filterInput, paddingLeft: 32, width: 200 }} />
        </div>
        <select value={filter.category} onChange={e => { setFilter(f => ({ ...f, category: e.target.value })); setPageNum(1); }} style={st.filterSelect}>
          <option value="">All categories</option>
          <option value="__uncategorized__">Uncategorized</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="date" value={filter.from} onChange={e => { setFilter(f => ({ ...f, from: e.target.value })); setPageNum(1); }} style={st.filterInput} />
        <span style={{ color: T.textFaint, fontSize: 12 }}>→</span>
        <input type="date" value={filter.to} onChange={e => { setFilter(f => ({ ...f, to: e.target.value })); setPageNum(1); }} style={st.filterInput} />
        {hasFilter && <button onClick={() => { setFilter({ payee: '', category: '', from: '', to: '' }); setPageNum(1); }} style={st.clearBtn}>Clear</button>}
      </div>

      {loadingTxns && (
        <div style={{ padding: '20px', textAlign: 'center', color: T.textDim, fontSize: 13 }}>Loading transactions…</div>
      )}
      {loadError && !loadingTxns && (
        <div style={{ padding: '16px 20px', textAlign: 'center', color: T.neg, fontSize: 13, background: T.negDim, border: `1px solid ${T.negDim}`, borderRadius: T.radius, marginBottom: 12 }}>
          {loadError} · <button onClick={() => reload()} style={{ ...st.clearBtn, color: T.neg, marginLeft: 6 }}>Retry</button>
        </div>
      )}

      <div style={st.tableWrap}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={st.th}><input type="checkbox" checked={selected.size === txns.length && txns.length > 0} onChange={toggleAll} style={st.check} /></th>
              {cols.map(({ key, label }) => (
                <th key={key} onClick={() => handleSort(key)} style={{ ...st.th, cursor: 'pointer', textAlign: ['outflow', 'inflow', 'cleared'].includes(key) ? 'right' : 'left' }}>
                  {label}<SortIcon col={key} sortCol={sortCol} sortDir={sortDir} />
                </th>
              ))}
              <th style={st.th} />
            </tr>
          </thead>
          <tbody>
            {!loadingTxns && txns.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: T.textDim, fontSize: 13 }}>
                {hasFilter ? 'No transactions match your filters' : 'No transactions yet'}
              </td></tr>
            )}
            {txns.map(t => <EditableRow key={t.id} t={t} categories={categories} catColor={catColor} onSave={handleSave} onToggleSelect={toggleSelect} selected={selected.has(t.id)} fmt={fmt} rowPad={rowPad} onSplit={tx => setModal({ split: tx })} onToggleCleared={toggleCleared} />)}
          </tbody>
        </table>
      </div>

      {page && page.pagination.total_pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, fontSize: 12.5, color: T.textDim }}>
          <span>Showing page {page.pagination.page} of {page.pagination.total_pages} · {page.pagination.total} total</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={pageNum <= 1} onClick={() => setPageNum(n => Math.max(1, n - 1))} style={{ ...st.clearBtn, opacity: pageNum <= 1 ? 0.4 : 1 }}>◀ Prev</button>
            <button disabled={pageNum >= page.pagination.total_pages} onClick={() => setPageNum(n => n + 1)} style={{ ...st.clearBtn, opacity: pageNum >= page.pagination.total_pages ? 0.4 : 1 }}>Next ▶</button>
          </div>
        </div>
      )}

      {modal === 'reconcile' && <ReconcileModal account={account} clearedBalance={account.balance} fmt={fmt} onClose={() => setModal(null)} onReconcile={reconcile} />}
      {modal === 'rules' && <RulesManager rules={rules} categories={categories} onClose={() => setModal(null)} onAdd={r => setRules(rs => [...rs, r])} onDelete={id => setRules(rs => rs.filter(x => x.id !== id))} />}
      {modal && typeof modal === 'object' && 'split' in modal && <SplitModal txn={modal.split} categories={categories} fmt={fmt} onClose={() => setModal(null)} onSave={(_id, _splits) => saveSplit()} />}
      {showAddTxn && (
        <div style={stModal.overlay} onClick={e => e.target === e.currentTarget && setShowAddTxn(false)}>
          <div style={stModal.panel}>
            <div style={stModal.header}>
              <span style={stModal.title}>New Transaction</span>
              <button onClick={() => setShowAddTxn(false)} style={stModal.closeBtn}>✕</button>
            </div>
            <form onSubmit={handleAddTxn} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={stModal.field}>
                  <label style={stModal.label}>Date</label>
                  <input type="date" value={addForm.date}
                    onChange={e => setAddForm(f => ({ ...f, date: e.target.value }))}
                    style={stModal.input} />
                </div>
                <div style={stModal.field}>
                  <label style={stModal.label}>Category</label>
                  <select value={addForm.category}
                    onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))}
                    style={stModal.select}>
                    <option value="">— Uncategorized —</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div style={stModal.field}>
                <label style={stModal.label}>Payee</label>
                <input autoFocus value={addForm.payee}
                  onChange={e => setAddForm(f => ({ ...f, payee: e.target.value }))}
                  placeholder="Payee name" style={stModal.input} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={stModal.field}>
                  <label style={stModal.label}>Outflow</label>
                  <input type="number" value={addForm.outflow}
                    onChange={e => setAddForm(f => ({ ...f, outflow: e.target.value, inflow: '' }))}
                    placeholder="0" style={stModal.input} />
                </div>
                <div style={stModal.field}>
                  <label style={stModal.label}>Inflow</label>
                  <input type="number" value={addForm.inflow}
                    onChange={e => setAddForm(f => ({ ...f, inflow: e.target.value, outflow: '' }))}
                    placeholder="0" style={stModal.input} />
                </div>
              </div>
              <div style={stModal.field}>
                <label style={stModal.label}>Memo</label>
                <input value={addForm.memo}
                  onChange={e => setAddForm(f => ({ ...f, memo: e.target.value }))}
                  placeholder="Optional note" style={stModal.input} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" id="addCleared" checked={addForm.cleared}
                  onChange={e => setAddForm(f => ({ ...f, cleared: e.target.checked }))}
                  style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }} />
                <label htmlFor="addCleared" style={{ fontSize: 13, color: T.textMid, cursor: 'pointer' }}>Cleared</label>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
                <button type="button" onClick={() => setShowAddTxn(false)} style={stModal.cancelBtn}>Cancel</button>
                <button type="submit" disabled={addSaving} style={stModal.submitBtn}>
                  {addSaving ? 'Saving…' : 'Add Transaction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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

const stModal = {
  overlay:   { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, backdropFilter: 'blur(4px)' },
  panel:     { background: T.surface2, border: `1px solid ${T.borderHi}`, borderRadius: T.radius, padding: 28, width: 460, boxShadow: '0 24px 60px rgba(0,0,0,0.85)' },
  header:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  title:     { fontSize: 15, fontWeight: 700, color: T.text, letterSpacing: '-0.02em' },
  closeBtn:  { background: 'none', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: 14, padding: 4 },
  field:     { display: 'flex', flexDirection: 'column' as const, gap: 5 },
  label:     { fontSize: 10.5, fontWeight: 700, color: T.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const },
  input:     { padding: '8px 11px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 7, background: T.surface, color: T.text, outline: 'none' },
  select:    { padding: '8px 11px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 7, background: T.surface, color: T.text, cursor: 'pointer' },
  cancelBtn: { padding: '8px 15px', fontSize: 12.5, fontWeight: 600, background: 'none', border: `1px solid ${T.border}`, borderRadius: 7, color: T.textMid, cursor: 'pointer' },
  submitBtn: { padding: '8px 20px', fontSize: 12.5, fontWeight: 700, background: 'var(--accent)', border: 'none', borderRadius: 7, color: '#06140d', cursor: 'pointer' },
};
