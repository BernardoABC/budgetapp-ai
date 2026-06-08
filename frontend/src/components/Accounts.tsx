import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { updateTransaction, deleteTransaction, createTransaction, createTransfer, fetchTransactionsPage, batchTransactions, reconcileAccount, fetchTransferCandidates, linkTransfer, linkTransferBatch, updateAccount, deleteAccount, type TxnPage, type TxnFilterParams } from '../api';
import { useToast } from './Toast';
import { T, GROUP_COLORS } from '../theme';
import { ReconcileModal, RulesManager, SplitModal } from './AccountsModals';
import type { PayeeRule } from './AccountsModals';
import type { Transaction, Account, CategoryGroup } from '../api';

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
  onDelete: (id: string) => void;
  onLink: (t: Transaction) => void;
}

function EditableRow({ t, categories, catColor, onSave, onToggleSelect, selected, fmt, rowPad, onSplit, onToggleCleared, onDelete, onLink }: EditableRowProps) {
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
          <select
            value={draft.category ?? ''}
            onChange={e => {
              if (e.target.value === '__transfer__') {
                setDraft(d => ({ ...d, category: null }));
                onLink(t);
              } else {
                setDraft(d => ({ ...d, category: e.target.value || null }));
              }
            }}
            style={st.inlineSelect}
          >
            <option value="">—</option>
            <option value="__transfer__" style={{ color: 'var(--text-faint, #666)' }}>↔ Transfer to account…</option>
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
        {t.transfer_peer_id
          ? <span style={{ fontSize: 10, fontWeight: 700, color: '#6C8EBF', background: 'rgba(108,142,191,0.12)', borderRadius: 4, padding: '2px 6px' }}>⇄ Transfer</span>
          : <>
              {t.splits && t.splits.length > 0
                ? <span style={st.splitChip} title={t.splits.map(s => s.category + ' ' + fmt(s.amount)).join('  ·  ')}>⑂ Split · {t.splits.length}</span>
                : t.category
                  ? <span style={{ ...st.catTag, color: catColor(t.category) }}><span style={{ width: 6, height: 6, borderRadius: 2, background: 'currentColor' }} />{t.category}</span>
                  : null
              }
              <button
                onClick={e => { e.stopPropagation(); onLink(t); }}
                style={{ fontSize: 10, color: T.textFaint, background: 'none', border: `1px solid ${T.border}`, borderRadius: 4, padding: '1px 6px', cursor: 'pointer', marginLeft: 4 }}
                title="Link as transfer"
              >Link</button>
            </>
        }
      </td>
      <td style={{ ...st.td, padding: rowPad + ' 12px', color: T.textDim, fontSize: 12 }}>{t.memo || '—'}</td>
      <td style={{ ...st.td, padding: rowPad + ' 12px', textAlign: 'right', fontFamily: T.mono, fontSize: 12.5, color: T.textMid }}>{t.outflow > 0 ? fmt(t.outflow) : ''}</td>
      <td style={{ ...st.td, padding: rowPad + ' 12px', textAlign: 'right', fontFamily: T.mono, fontSize: 12.5, color: T.pos, fontWeight: 600 }}>{t.inflow > 0 ? '+' + fmt(t.inflow) : ''}</td>
      <td style={{ ...st.td, padding: rowPad + ' 12px', textAlign: 'center' }} onClick={e => { e.stopPropagation(); onToggleCleared(t); }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', cursor: 'pointer', background: t.cleared ? T.pos : 'transparent', border: t.cleared ? 'none' : `1.5px solid ${T.textFaint}`, boxShadow: t.cleared ? `0 0 7px ${T.pos}` : 'none' }} />
      </td>
      <td style={{ ...st.td, padding: rowPad + ' 8px', textAlign: 'center', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
        <button onClick={() => onSplit(t)} style={st.splitBtn} title="Split">⑂</button>
        <button onClick={() => onDelete(t.id)} style={{ ...st.splitBtn, marginLeft: 5, color: T.neg }} title="Delete">✕</button>
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
  onDeleted: (deletedId: string) => void;
}

export function Accounts({ accounts, accountId, categoryGroups, fmt, density, categoryIdByName, onAccountsChanged, onDeleted }: Props) {
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
    isTransfer: false, transferToAccountId: '',
  });
  const [addSaving, _setAddSaving] = useState(false);

  const [selected, setSelected] = useState(new Set<string>());
  const [sort, setSort] = useState('date_desc');
  const [filter, setFilter] = useState({ payee: '', category: '', from: '', to: '' });
  const [pageNum, setPageNum] = useState(1);
  const [rules, setRules] = useState<PayeeRule[]>([]);
  const [modal, setModal] = useState<null | 'reconcile' | 'rules' | { split: Transaction }>(null);

  const [linkModal, setLinkModal] = useState<{
    txn: Transaction;
    step: 1 | 2;
    targetAccountId: string;
    candidates: Transaction[];
    loading: boolean;
  } | null>(null);

  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [batchReview, setBatchReview] = useState<{
    payee: string;
    targetAccountId: string;
    pairs: Array<{ source: Transaction; candidate: Transaction | null; include: boolean }>;
  } | null>(null);

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
  const lastAccountId = useRef<string>(accountId);

  useEffect(() => {
    // If account changed, reset filter state immediately before scheduling reload
    if (lastAccountId.current !== accountId) {
      lastAccountId.current = accountId;
      setFilter({ payee: '', category: '', from: '', to: '' });
      setPageNum(1);
      setSelected(new Set());
      setRenamingName(null);
      // Don't schedule a debounced reload here — the state changes above will
      // trigger this effect again with the reset values
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { reload(); }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [reload, accountId]);

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

  const saveSplit = (id: string, splits: { category: string; amount: number }[]) => {
    const txn = page?.transactions.find(t => t.id === id);
    if (!txn) return;
    const category_id = txn.category ? (categoryIdByName[txn.category] ?? undefined) : undefined;
    const amount = txn.inflow > 0 ? txn.inflow : -txn.outflow;
    updateTransaction(id, {
      date: txn.date, payee: txn.payee, category_id, amount, memo: txn.memo, cleared: txn.cleared,
      splits: splits.map(s => ({ category_id: categoryIdByName[s.category] ?? '', amount: Math.round(s.amount * 100) })),
    })
      .then(() => { setModal(null); toast.success('Split saved'); onAccountsChanged(); reload(); })
      .catch(err => { console.error('save split failed:', err); toast.error('Save failed: ' + (err as Error).message); reload(); });
  };
  const reconcile = (diff: number) => {
    reconcileAccount(accountId, diff)
      .then(() => { setModal(null); toast.success('Reconciled'); onAccountsChanged(); reload(); })
      .catch(err => { console.error('reconcile failed:', err); toast.error('Reconcile failed: ' + (err as Error).message); reload(); });
  };

  const handleDeleteAccount = async () => {
    if (!account) return;
    setDeleting(true);
    try {
      await deleteAccount(account.id);
      setDeleteConfirm(false);
      onDeleted(account.id);
    } catch (err: unknown) {
      toast.error('Delete failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setDeleting(false);
    }
  };

  const handleAddTxn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addForm.isTransfer) {
      if (!addForm.transferToAccountId) return;
      const amount = parseFloat(addForm.outflow) || parseFloat(addForm.inflow) || 0;
      if (amount <= 0) return;
      await createTransfer({
        from_account_id: accountId,
        to_account_id: addForm.transferToAccountId,
        date: addForm.date,
        amount,
        memo: addForm.memo,
        cleared: addForm.cleared,
      });
    } else {
      const amount = parseFloat(addForm.inflow) > 0 ? parseFloat(addForm.inflow) : -(parseFloat(addForm.outflow) || 0);
      const category_id = addForm.category ? (categoryIdByName[addForm.category] ?? undefined) : undefined;
      await createTransaction(accountId, {
        date: addForm.date, payee: addForm.payee, category_id, amount,
        memo: addForm.memo, cleared: addForm.cleared,
      });
    }
    reload();
    setAddForm({ date: new Date().toISOString().slice(0, 10), payee: '', category: '', outflow: '', inflow: '', memo: '', cleared: false, isTransfer: false, transferToAccountId: '' });
  };

  const openLinkModal = (txn: Transaction) => {
    setLinkModal({ txn, step: 1, targetAccountId: '', candidates: [], loading: false });
  };

  const handleLinkSelectAccount = async (targetAccountId: string) => {
    if (!linkModal) return;
    setLinkModal(m => m ? { ...m, targetAccountId, loading: true } : null);
    const amount = linkModal.txn.outflow > 0 ? -linkModal.txn.outflow : linkModal.txn.inflow;
    const cands = await fetchTransferCandidates(targetAccountId, amount).catch(() => []);
    setLinkModal(m => m ? { ...m, step: 2, candidates: cands, loading: false } : null);
  };

  const handleLinkConfirm = async (candidateId: string) => {
    if (!linkModal) return;
    try {
      await linkTransfer(linkModal.txn.id, candidateId);
      reload();
      const savedModal = linkModal;
      setLinkModal(null);

      // Check for other unlinked rows with the same payee.
      const samePay = page?.transactions.filter(
        t => t.payee === savedModal.txn.payee && !t.transfer_peer_id && t.id !== savedModal.txn.id
      ) ?? [];
      if (samePay.length > 0) {
        const tgtAccId = savedModal.targetAccountId;
        const amount = savedModal.txn.outflow > 0 ? -savedModal.txn.outflow : savedModal.txn.inflow;
        const allCands = await fetchTransferCandidates(tgtAccId, amount).catch(() => []);
        const pairs = samePay.map(src => {
          const best = allCands
            .filter(c => !c.transfer_peer_id)
            .sort((a, b) =>
              Math.abs(new Date(a.date).getTime() - new Date(src.date).getTime()) -
              Math.abs(new Date(b.date).getTime() - new Date(src.date).getTime())
            )[0] ?? null;
          return { source: src, candidate: best, include: best !== null };
        });
        setBatchReview({ payee: savedModal.txn.payee, targetAccountId: tgtAccId, pairs });
      }
    } catch (e: any) {
      alert('Link failed: ' + e.message);
    }
  };

  const handleBatchLink = async () => {
    if (!batchReview) return;
    const pairs: [string, string][] = batchReview.pairs
      .filter(p => p.include && p.candidate)
      .map(p => [p.source.id, p.candidate!.id]);
    if (pairs.length === 0) { setBatchReview(null); return; }
    try {
      await linkTransferBatch(pairs);
      reload();
      setBatchReview(null);
    } catch (e: any) {
      alert('Batch link failed: ' + e.message);
    }
  };

  const [bulkCat, setBulkCat] = useState('');

  const runBatch = (action: 'categorize' | 'clear' | 'unclear' | 'delete', categoryName?: string) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const categoryId = action === 'categorize'
      ? (categoryName === '__uncategorized__' ? '' : (categoryName ? (categoryIdByName[categoryName] ?? '') : ''))
      : undefined;
    batchTransactions(ids, action, categoryId)
      .then(r => {
        setSelected(new Set());
        toast.success(`${r.affected} transaction${r.affected === 1 ? '' : 's'} updated`);
        onAccountsChanged();
        reload();
      })
      .catch(err => { console.error('batch failed:', err); toast.error('Bulk action failed: ' + err.message); });
  };

  const confirmBulkDelete = () => {
    if (window.confirm(`Delete ${selected.size} transaction(s)? This cannot be undone.`)) runBatch('delete');
  };

  const handleSingleDelete = (id: string) => {
    if (!window.confirm('Delete this transaction? This cannot be undone.')) return;
    deleteTransaction(id)
      .then(() => { toast.success('Transaction deleted'); onAccountsChanged(); reload(); })
      .catch(err => { console.error('delete failed:', err); toast.error('Delete failed: ' + err.message); });
  };

  const toggleAll = () => setSelected(s => s.size === txns.length ? new Set() : new Set(txns.map(t => t.id)));

  const cols = [
    { key: 'date', label: 'Date' }, { key: 'payee', label: 'Payee' }, { key: 'category', label: 'Category' },
    { key: 'memo', label: 'Memo' }, { key: 'outflow', label: 'Outflow' }, { key: 'inflow', label: 'Inflow' }, { key: 'cleared', label: 'C' },
  ];
  const hasFilter = filter.payee || filter.category || filter.from || filter.to;

  if (!account) return <div style={{ padding: 40, color: T.textDim, fontSize: 14 }}>Loading…</div>;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1180, margin: '0 auto' }}>
      <div style={st.head}>
        <div>
          <div style={st.acctType}>{accounts.budget.find(a => a.id === account.id) ? 'Budget Account' : 'Tracking Account'}</div>
          {renamingName !== null ? (
            <input
              autoFocus
              value={renamingName}
              onChange={e => setRenamingName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const trimmed = renamingName.trim();
                  if (!trimmed) { setRenamingName(null); return; }
                  updateAccount(account.id, { name: trimmed })
                    .then(() => { setRenamingName(null); onAccountsChanged(); })
                    .catch(() => { toast.error('Failed to rename account'); setRenamingName(null); });
                } else if (e.key === 'Escape') {
                  setRenamingName(null);
                }
              }}
              onBlur={() => {
                const trimmed = renamingName.trim();
                if (!trimmed) { setRenamingName(null); return; }
                updateAccount(account.id, { name: trimmed })
                  .then(() => { setRenamingName(null); onAccountsChanged(); })
                  .catch(() => { toast.error('Failed to rename account'); setRenamingName(null); });
              }}
              style={st.renameInput}
            />
          ) : (
            <h2 style={{ ...st.pageTitle, cursor: 'text' }} onClick={() => setRenamingName(account.name)} title="Click to rename">{account.name}</h2>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setDeleteConfirm(true)} style={st.headerBtnNeg}>Delete</button>
            <button onClick={() => setModal('rules')} style={st.headerBtn}>Rules</button>
            <button onClick={() => setModal('reconcile')} style={st.headerBtnAccent}>Reconcile</button>
          </div>
          <div style={st.balCard}>
            <span style={st.balLabel}>Working Balance</span>
            <span style={{ ...st.balance, color: account.balance < 0 ? T.neg : T.text }}>{fmt(account.balance)}</span>
          </div>
        </div>
      </div>

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

      {selected.size > 0 && (
        <div style={st.bulkBar}>
          <span style={{ fontWeight: 700, color: T.text }}>{selected.size} selected</span>
          <select value={bulkCat} onChange={e => setBulkCat(e.target.value)} style={st.filterSelect}>
            <option value="">Set category…</option>
            <option value="__uncategorized__">— Uncategorized —</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={() => { runBatch('categorize', bulkCat); setBulkCat(''); }}
            disabled={bulkCat === ''}
            style={{ ...st.headerBtn, opacity: bulkCat === '' ? 0.4 : 1 }}
          >Apply</button>
          <button onClick={() => runBatch('clear')} style={st.headerBtn}>Clear</button>
          <button onClick={() => runBatch('unclear')} style={st.headerBtn}>Unclear</button>
          <button onClick={confirmBulkDelete} style={{ ...st.clearBtn, color: T.neg, borderColor: T.negDim, background: T.negDim, marginLeft: 'auto' }}>Delete {selected.size}</button>
        </div>
      )}

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
            {txns.map(t => <EditableRow key={t.id} t={t} categories={categories} catColor={catColor} onSave={handleSave} onToggleSelect={toggleSelect} selected={selected.has(t.id)} fmt={fmt} rowPad={rowPad} onSplit={tx => setModal({ split: tx })} onToggleCleared={toggleCleared} onDelete={handleSingleDelete} onLink={openLinkModal} />)}
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

      {modal === 'reconcile' && <ReconcileModal account={account} clearedBalance={page?.summary.cleared_balance ?? 0} fmt={fmt} onClose={() => setModal(null)} onReconcile={reconcile} />}
      {modal === 'rules' && <RulesManager rules={rules} categories={categories} onClose={() => setModal(null)} onAdd={r => setRules(rs => [...rs, r])} onDelete={id => setRules(rs => rs.filter(x => x.id !== id))} />}
      {modal && typeof modal === 'object' && 'split' in modal && <SplitModal txn={modal.split} categories={categories} fmt={fmt} onClose={() => setModal(null)} onSave={(id, splits) => saveSplit(id, splits)} />}
      {deleteConfirm && (
        <div style={stModal.overlay} onClick={e => { if (e.target === e.currentTarget) setDeleteConfirm(false); }}>
          <div style={{ ...stModal.panel, width: 400 }}>
            <div style={stModal.header}>
              <span style={stModal.title}>Delete Account</span>
              <button onClick={() => setDeleteConfirm(false)} style={stModal.closeBtn}>✕</button>
            </div>
            <p style={{ fontSize: 13.5, color: T.textMid, margin: '0 0 8px' }}>
              Delete <strong style={{ color: T.text }}>{account.name}</strong>?
            </p>
            <p style={{ fontSize: 12.5, color: T.textFaint, margin: '0 0 22px' }}>
              This will permanently delete all transactions for this account and cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteConfirm(false)} style={stModal.cancelBtn} disabled={deleting}>Cancel</button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                style={{ ...stModal.submitBtn, background: T.neg, color: '#fff', opacity: deleting ? 0.6 : 1 }}
              >
                {deleting ? 'Deleting…' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Link modal */}
      {linkModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setLinkModal(null)}>
          <div style={{ background: T.surface, borderRadius: 12, padding: 28, width: 480, maxHeight: '80vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 16, color: T.text, marginBottom: 16 }}>Link as Transfer</div>
            {linkModal.step === 1 && (
              <>
                <div style={{ fontSize: 13, color: T.textDim, marginBottom: 12 }}>
                  Linking: <b style={{ color: T.text }}>{linkModal.txn.payee}</b> · {linkModal.txn.outflow > 0 ? '-' : '+'}{fmt(linkModal.txn.outflow || linkModal.txn.inflow)}
                </div>
                <label style={stModal.label}>Target account</label>
                <select
                  style={{ ...st.inlineSelect, width: '100%', marginTop: 6 }}
                  value={linkModal.targetAccountId}
                  onChange={e => handleLinkSelectAccount(e.target.value)}
                >
                  <option value="">Select account…</option>
                  {[...(accounts.budget ?? []), ...(accounts.tracking ?? [])].filter(a => a.id !== accountId).map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                {linkModal.loading && <div style={{ marginTop: 12, color: T.textDim, fontSize: 13 }}>Loading candidates…</div>}
              </>
            )}
            {linkModal.step === 2 && (
              <>
                <div style={{ fontSize: 13, color: T.textDim, marginBottom: 12 }}>Select the matching transaction:</div>
                {linkModal.candidates.length === 0
                  ? <div style={{ color: T.textFaint, fontSize: 13 }}>No unlinked transactions with matching amount found.</div>
                  : linkModal.candidates.map(c => (
                    <div key={c.id}
                      onClick={() => handleLinkConfirm(c.id)}
                      style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${T.border}`, marginBottom: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, color: T.text, fontSize: 13 }}>{c.payee}</div>
                        <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>{c.date}</div>
                      </div>
                      <div style={{ fontFamily: T.mono, fontSize: 13, color: c.inflow > 0 ? T.pos : T.textMid }}>
                        {c.inflow > 0 ? '+' : '-'}{fmt(c.inflow || c.outflow)}
                      </div>
                    </div>
                  ))
                }
              </>
            )}
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setLinkModal(null)} style={st.cancelBtn}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {/* Batch review table */}
      {batchReview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setBatchReview(null)}>
          <div style={{ background: T.surface, borderRadius: 12, padding: 28, width: 640, maxHeight: '80vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 16, color: T.text, marginBottom: 4 }}>Match All "{batchReview.payee}" Transfers</div>
            <div style={{ fontSize: 13, color: T.textDim, marginBottom: 18 }}>Review auto-proposed matches. Uncheck any you want to skip.</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['', 'This account', '', 'Target account'].map((h, i) => (
                    <th key={i} style={{ fontSize: 10.5, fontWeight: 700, color: T.textDim, textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${T.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {batchReview.pairs.map((pair, i) => (
                  <tr key={pair.source.id} style={{ borderBottom: `1px solid ${T.border}`, opacity: pair.include ? 1 : 0.45 }}>
                    <td style={{ padding: '8px 8px' }}>
                      <input
                        type="checkbox"
                        checked={pair.include}
                        disabled={!pair.candidate}
                        onChange={() => setBatchReview(br => br ? {
                          ...br,
                          pairs: br.pairs.map((p, j) => j === i ? { ...p, include: !p.include } : p)
                        } : null)}
                      />
                    </td>
                    <td style={{ padding: '8px 8px', fontSize: 12 }}>
                      <div style={{ fontWeight: 600, color: T.text }}>{pair.source.date}</div>
                      <div style={{ color: T.textDim }}>{fmt(pair.source.outflow || pair.source.inflow)}</div>
                    </td>
                    <td style={{ padding: '8px 4px', color: T.textDim }}>→</td>
                    <td style={{ padding: '8px 8px', fontSize: 12 }}>
                      {pair.candidate
                        ? <><div style={{ fontWeight: 600, color: T.text }}>{pair.candidate.date}</div><div style={{ color: T.textDim }}>{fmt(pair.candidate.inflow || pair.candidate.outflow)}</div></>
                        : <span style={{ color: T.textDim, fontStyle: 'italic' }}>No candidate found</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: T.textDim }}>{batchReview.pairs.filter(p => p.include).length} pairs selected</span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setBatchReview(null)} style={st.cancelBtn}>Cancel</button>
                <button
                  onClick={handleBatchLink}
                  disabled={batchReview.pairs.filter(p => p.include).length === 0}
                  style={{ padding: '7px 18px', borderRadius: 7, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: batchReview.pairs.filter(p => p.include).length === 0 ? 0.45 : 1 }}
                >
                  Link {batchReview.pairs.filter(p => p.include).length} pairs
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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
                {!addForm.isTransfer && (
                <div style={stModal.field}>
                  <label style={stModal.label}>Category</label>
                  <select value={addForm.category}
                    onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))}
                    style={stModal.select}>
                    <option value="">— Uncategorized —</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                )}
              </div>
              {/* Transfer toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  id="addIsTransfer"
                  checked={addForm.isTransfer}
                  onChange={e => setAddForm(f => ({ ...f, isTransfer: e.target.checked, category: '', transferToAccountId: '' }))}
                />
                <label htmlFor="addIsTransfer" style={{ fontSize: 12, color: T.textMid, fontWeight: 600 }}>Transfer to another account</label>
              </div>
              {addForm.isTransfer && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={stModal.label}>To Account</label>
                  <select
                    value={addForm.transferToAccountId}
                    onChange={e => setAddForm(f => ({ ...f, transferToAccountId: e.target.value }))}
                    style={st.inlineSelect}
                    required
                  >
                    <option value="">Select account…</option>
                    {[...(accounts.budget ?? []), ...(accounts.tracking ?? [])].filter(a => a.id !== accountId).map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              )}
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
  renameInput:     { fontSize: 24, fontWeight: 800, color: T.text, margin: 0, letterSpacing: '-0.03em', background: 'transparent', border: 'none', borderBottom: `2px solid var(--accent)`, outline: 'none', padding: '0 2px', width: 280 },
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
  headerBtnNeg:    { padding: '8px 14px', fontSize: 12.5, fontWeight: 600, background: T.negDim, border: `1px solid ${T.neg}`, borderRadius: 8, color: T.neg, cursor: 'pointer' },
  check:           { accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' },
  inlineInput:     { padding: '5px 8px', fontSize: 12.5, border: `1px solid var(--accent)`, borderRadius: 6, fontFamily: T.mono, background: T.surface2, color: T.text, width: 96 },
  inlineSelect:    { padding: '5px 8px', fontSize: 12, border: `1px solid var(--accent)`, borderRadius: 6, background: T.surface2, color: T.text },
  saveBtn:         { padding: '5px 11px', fontSize: 12, fontWeight: 700, background: 'var(--accent)', color: '#06140d', border: 'none', borderRadius: 6, cursor: 'pointer' },
  cancelBtn:       { padding: '5px 9px', fontSize: 12, background: 'none', color: T.textDim, border: `1px solid ${T.border}`, borderRadius: 6, cursor: 'pointer' },
  bulkBar:         { display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px', marginBottom: 12, background: T.accentDim, border: `1px solid var(--accent)`, borderRadius: T.radius },
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
