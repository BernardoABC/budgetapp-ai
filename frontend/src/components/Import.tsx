import React, { useState, useRef, useCallback, useEffect } from 'react';
import { T } from '../theme';
import { categorize } from '../engine';
import { AppData } from '../data';
import type { CategoryGroup } from '../data';
import type { Account } from '../data';
import { fetchImportHistory, fetchAccounts, fetchPayeeRules, createPayeeRule, updatePayeeRule, deletePayeeRule } from '../api';
import type { ImportRecord, PayeeRule as ApiPayeeRule } from '../api';
import { useToast } from './Toast';

interface ParsedRow {
  id: number;
  date: string;
  payee: string;
  amount: number;
  category: string | null;
  autoCat: boolean;
}

const SAMPLE_RAW = [
  { id: 1, date: '2026-04-19', payee: 'Walmart Escazú',      amount: -32500 },
  { id: 2, date: '2026-04-19', payee: 'Spotify',             amount: -6990  },
  { id: 3, date: '2026-04-18', payee: 'Gasolinera El Prado', amount: -35000 },
  { id: 4, date: '2026-04-18', payee: 'Señor Ceviche',       amount: -14500 },
  { id: 5, date: '2026-04-17', payee: 'Amazon.com',          amount: -18900 },
  { id: 6, date: '2026-04-17', payee: 'Farmacia Fischel',    amount: -8200  },
  { id: 7, date: '2026-04-16', payee: 'SINPE transfer in',   amount: 50000  },
];

const SAMPLE_PARSED: ParsedRow[] = SAMPLE_RAW.map(r => {
  const cat = categorize(r.payee, AppData.payeeRules);
  return { ...r, category: cat, autoCat: !!cat };
});

function StepIndicator({ step }: { step: number }) {
  const steps = ['Upload', 'Review', 'Confirm'];
  return (
    <div style={st.stepRow}>
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ ...st.stepDot, ...(i < step ? st.stepDone : i === step ? st.stepActive : st.stepFuture) }}>
              {i < step ? '✓' : i + 1}
            </div>
            <span style={{ ...st.stepLabel, color: i === step ? T.text : i < step ? T.textMid : T.textFaint, fontWeight: i === step ? 700 : 500 }}>{s}</span>
          </div>
          {i < steps.length - 1 && <div style={{ ...st.stepLine, background: i < step ? 'var(--accent)' : T.border }} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function Step1({ accounts, onNext }: { accounts: typeof AppData.accounts; onNext: (info: { file: { name: string }; accountId: string }) => void }) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState(accounts.budget[0].id);
  const inputRef = useRef<HTMLInputElement>(null);
  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }, []);
  const allAccounts = [...accounts.budget, ...accounts.tracking];

  return (
    <div style={st.stepCard}>
      <h3 style={st.stepTitle}>Upload bank export</h3>
      <p style={st.stepSub}>Drag a CSV or XLS file exported from your bank, or click to browse.</p>
      <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        style={{ ...st.dropzone, ...(dragging ? st.dropzoneActive : {}), ...(file ? st.dropzoneFilled : {}) }}>
        <input ref={inputRef} type="file" accept=".csv,.xls,.xlsx" style={{ display: 'none' }} onChange={e => setFile(e.target.files?.[0] ?? null)} />
        {file ? (
          <>
            <div style={st.fileIcon}><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M14 3v4a1 1 0 0 0 1 1h4M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" stroke="var(--accent)" strokeWidth="1.8" strokeLinejoin="round"/></svg></div>
            <div style={{ fontWeight: 700, color: T.text, fontSize: 14 }}>{file.name}</div>
            <div style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>{(file.size / 1024).toFixed(1)} KB · click to replace</div>
          </>
        ) : (
          <>
            <div style={st.uploadIcon}><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 16V4M12 4 7 9M12 4l5 5M5 20h14" stroke={T.textDim} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
            <div style={{ fontWeight: 600, color: T.textMid, fontSize: 14 }}>Drop CSV / XLS here, or <span style={{ color: 'var(--accent)' }}>browse</span></div>
            <div style={{ fontSize: 12, color: T.textFaint, marginTop: 5 }}>Supports BAC, Davivienda &amp; BCR formats</div>
          </>
        )}
      </div>
      <div style={{ marginTop: 22 }}>
        <label style={st.label}>Import into account</label>
        <select value={accountId} onChange={e => setAccountId(e.target.value)} style={st.select}>
          {allAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div style={{ marginTop: 26, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => onNext({ file: file ?? { name: 'estado_cuenta_abril.csv' }, accountId })} style={st.primaryBtn}>Continue →</button>
      </div>
    </div>
  );
}

function Step2({ parsed, onChangeParsed, categoryGroups, onNext, onBack }: {
  parsed: ParsedRow[];
  onChangeParsed: (id: number, key: string, val: string | null) => void;
  categoryGroups: CategoryGroup[];
  onNext: () => void;
  onBack: () => void;
}) {
  const categories = categoryGroups.flatMap(g => g.categories);
  const autoCount = parsed.filter(p => p.autoCat).length;
  return (
    <div style={st.stepCard}>
      <h3 style={st.stepTitle}>Review transactions</h3>
      <p style={st.stepSub}><b style={{ color: T.text }}>{parsed.length}</b> parsed · <span style={{ color: 'var(--accent)' }}>{autoCount} auto-categorized</span>. Assign the rest as needed.</p>
      <div style={st.reviewTable}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Date', 'Payee', 'Category', 'Amount'].map(h => <th key={h} style={{ ...st.th, textAlign: h === 'Amount' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {parsed.map(row => (
              <tr key={row.id} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                <td style={{ ...st.td, fontFamily: T.mono, fontSize: 12, color: T.textDim }}>{row.date.slice(5).replace('-', '/')}</td>
                <td style={st.td}><span style={{ fontWeight: 600, color: T.text }}>{row.payee}</span>{row.autoCat && <span style={st.autoTag}>auto</span>}</td>
                <td style={st.td}>
                  <select value={row.category ?? ''} onChange={e => onChangeParsed(row.id, 'category', e.target.value || null)}
                    style={{ ...st.inlineSelect, borderColor: row.category ? T.border : T.warn, color: row.category ? T.text : T.warn }}>
                    <option value="">— assign —</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td style={{ ...st.td, textAlign: 'right', fontFamily: T.mono, fontSize: 12.5, fontWeight: 600 }}>
                  <span style={{ color: row.amount > 0 ? T.pos : T.textMid }}>{row.amount > 0 ? '+' : '−'}₡{Math.abs(row.amount).toLocaleString('en-US')}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 22, display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={onBack} style={st.ghostBtn}>← Back</button>
        <button onClick={onNext} style={st.primaryBtn}>Continue →</button>
      </div>
    </div>
  );
}

function Step3({ parsed, uploadInfo, onBack, onConfirm }: {
  parsed: ParsedRow[];
  uploadInfo: { file: { name: string } };
  onBack: () => void;
  onConfirm: () => void;
}) {
  const outflows = parsed.filter(r => r.amount < 0);
  const inflows = parsed.filter(r => r.amount > 0);
  const net = parsed.reduce((s, r) => s + r.amount, 0);
  const dates = parsed.map(r => r.date).sort();
  const uncategorized = parsed.filter(r => !r.category).length;
  const Stat = ({ num, lbl, color }: { num: string | number; lbl: string; color?: string }) => (
    <div style={st.summaryItem}><div style={{ ...st.summaryNum, color: color ?? T.text }}>{num}</div><div style={st.summaryLbl}>{lbl}</div></div>
  );
  return (
    <div style={st.stepCard}>
      <h3 style={st.stepTitle}>Confirm import</h3>
      <p style={st.stepSub}>Review the summary before importing.</p>
      <div style={st.summaryGrid}>
        <Stat num={parsed.length} lbl="Transactions" />
        <Stat num={outflows.length} lbl="Outflows" color={T.textMid} />
        <Stat num={inflows.length} lbl="Inflows" color={T.pos} />
        <Stat num={(net > 0 ? '+' : '−') + '₡' + Math.abs(net).toLocaleString('en-US')} lbl="Net" color={net < 0 ? T.neg : T.pos} />
      </div>
      <div style={st.confirmMeta}>
        <div style={st.metaRow}><span style={st.metaKey}>Date range</span><span style={st.metaVal}>{dates[0]} → {dates[dates.length - 1]}</span></div>
        <div style={st.metaRow}><span style={st.metaKey}>Source file</span><span style={st.metaVal}>{uploadInfo.file.name}</span></div>
        {uncategorized > 0 && <div style={st.warnBox}>⚠ {uncategorized} transaction{uncategorized > 1 ? 's' : ''} without a category — you can assign later.</div>}
      </div>
      <div style={{ marginTop: 26, display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={onBack} style={st.ghostBtn}>← Back</button>
        <button onClick={onConfirm} style={st.confirmBtn}>Import {parsed.length} transactions ✓</button>
      </div>
    </div>
  );
}

interface Props {
  accounts: typeof AppData.accounts;
  categoryGroups: CategoryGroup[];
  categoryIdByName: Record<string, string>;
  onNavigate: (page: string) => void;
}

export function ImportWizard({ accounts, categoryGroups, categoryIdByName, onNavigate }: Props) {
  const [tab, setTab] = useState<'import' | 'rules'>('import');
  const [step, setStep] = useState(0);
  const [uploadInfo, setUploadInfo] = useState<{ file: { name: string }; accountId: string } | null>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>(SAMPLE_PARSED);
  const [done, setDone] = useState(false);
  const handleChangeParsed = (id: number, key: string, val: string | null) =>
    setParsed(rows => rows.map(r => r.id === id ? { ...r, [key]: val } : r));

  const idToName = Object.fromEntries(Object.entries(categoryIdByName).map(([name, id]) => [id, name]));
  const allCategoryNames = categoryGroups.flatMap(g => g.categories);

  if (done) {
    return (
      <div style={st.doneWrap}>
        <div style={st.doneCircle}><svg width="34" height="34" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: T.text, margin: 0, letterSpacing: '-0.03em' }}>Import complete</h2>
        <p style={{ color: T.textDim, margin: 0, fontSize: 14 }}>{parsed.length} transactions added to your account.</p>
        <button onClick={() => onNavigate('dashboard')} style={{ ...st.primaryBtn, marginTop: 14 }}>Back to Dashboard</button>
      </div>
    );
  }

  return (
    <>
      {/* Tab bar */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '16px 24px 0' }}>
        <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, gap: 0 }}>
          {(['import', 'rules'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '10px 20px', fontSize: 13, fontWeight: 600,
              background: 'none', border: 'none', cursor: 'pointer',
              color: tab === t ? 'var(--accent)' : T.textDim,
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, textTransform: 'capitalize' as const,
            }}>{t === 'import' ? 'Import' : 'Rules'}</button>
          ))}
        </div>
      </div>

      <div style={{ display: tab === 'import' ? undefined : 'none' }}>
        <div style={{ padding: '28px 24px 0', maxWidth: 760, margin: '0 auto' }}>
          <StepIndicator step={step} />
          <div style={{ marginTop: 28 }}>
            {step === 0 && <Step1 accounts={accounts} onNext={info => { setUploadInfo(info); setStep(1); }} />}
            {step === 1 && <Step2 parsed={parsed} onChangeParsed={handleChangeParsed} categoryGroups={categoryGroups} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
            {step === 2 && <Step3 parsed={parsed} uploadInfo={uploadInfo ?? { file: { name: 'estado_cuenta_abril.csv' } }} onBack={() => setStep(1)} onConfirm={() => setDone(true)} />}
          </div>
        </div>
        <ImportHistory />
      </div>

      <div style={{ display: tab === 'rules' ? undefined : 'none' }}>
        <RulesManager
          categoryIdByName={categoryIdByName}
          idToName={idToName}
          allCategoryNames={allCategoryNames}
        />
      </div>
    </>
  );
}

function ImportHistory() {
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    fetchImportHistory()
      .then(setRecords)
      .catch(err => console.warn('Failed to load import history:', err.message));
    fetchAccounts()
      .then(accs => setAccounts([...accs.budget, ...accs.tracking]))
      .catch(() => {});
  }, []);

  const accountName = (id: string) => accounts.find(a => a.id === id)?.name ?? id;
  const fmtDate = (s: string) => {
    try { return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return s; }
  };

  if (records.length === 0) return null;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto 28px', padding: '0 24px' }}>
      <div style={stHistory.panel}>
        <div style={stHistory.header}>Import History</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['File', 'Account', 'Transactions', 'Date', 'Status'].map(h => (
                  <th key={h} style={{ ...stHistory.th, textAlign: h === 'Transactions' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td style={stHistory.td}>{r.filename}</td>
                  <td style={stHistory.td}>{accountName(r.account_id)}</td>
                  <td style={{ ...stHistory.td, textAlign: 'right', fontFamily: T.mono }}>{r.transaction_count}</td>
                  <td style={{ ...stHistory.td, fontFamily: T.mono, fontSize: 12, color: T.textDim }}>{fmtDate(r.imported_at)}</td>
                  <td style={stHistory.td}>
                    <span style={{ ...stHistory.badge, background: r.status === 'completed' ? 'rgba(61,220,151,0.12)' : 'rgba(246,196,90,0.12)', color: r.status === 'completed' ? T.pos : T.warn }}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RulesManager({ categoryIdByName, idToName, allCategoryNames }: {
  categoryIdByName: Record<string, string>;
  idToName: Record<string, string>;
  allCategoryNames: string[];
}) {
  const toast = useToast();
  const [rules, setRules] = useState<ApiPayeeRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ pattern: '', categoryId: '' });

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    fetchPayeeRules()
      .then(r => { setRules(r); setLoading(false); })
      .catch(err => { setLoadError(err.message); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const startAdd = () => { setAdding(true); setForm({ pattern: '', categoryId: categoryIdByName[allCategoryNames[0]] ?? '' }); };
  const startEdit = (r: ApiPayeeRule) => { setEditingId(r.id); setForm({ pattern: r.pattern, categoryId: r.category_id }); };
  const cancelForm = () => { setAdding(false); setEditingId(null); };

  const saveAdd = async () => {
    if (!form.pattern || !form.categoryId) return;
    try {
      await createPayeeRule(form.pattern, form.categoryId);
      toast.success('Rule saved');
      setAdding(false);
      load();
    } catch (err: any) { toast.error(err.message); }
  };

  const saveEdit = async () => {
    if (!editingId || !form.pattern || !form.categoryId) return;
    try {
      await updatePayeeRule(editingId, form.pattern, form.categoryId);
      toast.success('Rule updated');
      setEditingId(null);
      load();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this rule?')) return;
    try {
      await deletePayeeRule(id);
      toast.success('Rule deleted');
      load();
    } catch (err: any) { toast.error(err.message); }
  };

  const CategorySelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ ...st.select, padding: '7px 10px', fontSize: 13 }}>
      {allCategoryNames.map(name => (
        <option key={name} value={categoryIdByName[name] ?? ''}>{name}</option>
      ))}
    </select>
  );

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Payee Rules</div>
          <div style={{ fontSize: 12, color: T.textDim, marginTop: 3 }}>
            Patterns are matched as case-insensitive substrings against payee names during import.
          </div>
        </div>
        {!adding && <button onClick={startAdd} style={st.primaryBtn}>+ Add Rule</button>}
      </div>

      {loadError && (
        <div style={{ padding: '12px 14px', background: 'rgba(255,80,80,0.08)', border: `1px solid rgba(255,80,80,0.2)`, borderRadius: 8, color: T.neg, fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1 }}>{loadError}</span>
          <button onClick={load} style={{ background: 'none', border: 'none', color: T.neg, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Retry</button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: T.textDim, fontSize: 13 }}>Loading…</div>
      ) : (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 72px 72px', padding: '8px 14px', background: 'rgba(255,255,255,0.03)', fontSize: 10.5, fontWeight: 700, color: T.textDim, letterSpacing: '0.07em', textTransform: 'uppercase' as const, borderBottom: `1px solid ${T.border}` }}>
            <span>Pattern</span><span>Category</span><span>Used</span><span></span>
          </div>

          {rules.length === 0 && !adding && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: T.textDim, fontSize: 13 }}>
              No rules yet — add one to auto-categorize imports.
            </div>
          )}

          {rules.map(rule => (
            editingId === rule.id ? (
              <div key={rule.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 72px 72px', padding: '8px 14px', alignItems: 'center', borderBottom: `1px solid ${T.border}`, background: 'rgba(61,220,151,0.04)' }}>
                <input
                  value={form.pattern}
                  onChange={e => setForm(f => ({ ...f, pattern: e.target.value }))}
                  style={{ ...st.select, padding: '6px 9px', fontSize: 13, fontFamily: T.mono }}
                  placeholder="payee pattern"
                  autoFocus
                />
                <CategorySelect value={form.categoryId} onChange={v => setForm(f => ({ ...f, categoryId: v }))} />
                <span style={{ fontSize: 12, color: T.textFaint }}>{rule.match_count}×</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button onClick={saveEdit} style={{ ...st.primaryBtn, padding: '5px 10px', fontSize: 12 }}>Save</button>
                  <button onClick={cancelForm} style={{ ...st.ghostBtn, padding: '5px 8px', fontSize: 12 }}>✕</button>
                </span>
              </div>
            ) : (
              <div key={rule.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 72px 72px', padding: '10px 14px', alignItems: 'center', borderBottom: `1px solid ${T.borderSoft}`, fontSize: 13 }}>
                <span style={{ color: T.text, fontFamily: T.mono, fontSize: 12.5 }}>{rule.pattern}</span>
                <span style={{ color: T.textMid }}>{idToName[rule.category_id] ?? rule.category_id}</span>
                <span style={{ color: T.textFaint, fontSize: 12 }}>{rule.match_count}×</span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => startEdit(rule)} style={{ background: 'none', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}>✎</button>
                  <button onClick={() => handleDelete(rule.id)} style={{ background: 'none', border: 'none', color: T.textFaint, cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}>✕</button>
                </span>
              </div>
            )
          ))}

          {adding && (
            <div style={{ padding: '10px 14px', borderTop: rules.length > 0 ? `1px solid ${T.border}` : undefined, background: 'rgba(61,220,151,0.04)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 72px 72px', alignItems: 'center', gap: 0 }}>
                <input
                  value={form.pattern}
                  onChange={e => setForm(f => ({ ...f, pattern: e.target.value }))}
                  style={{ ...st.select, padding: '7px 10px', fontSize: 13, fontFamily: T.mono }}
                  placeholder="e.g. walmart"
                  autoFocus
                />
                <CategorySelect value={form.categoryId} onChange={v => setForm(f => ({ ...f, categoryId: v }))} />
                <span />
                <span style={{ display: 'flex', gap: 6 }}>
                  <button onClick={saveAdd} style={{ ...st.primaryBtn, padding: '6px 10px', fontSize: 12 }}>Save</button>
                  <button onClick={cancelForm} style={{ ...st.ghostBtn, padding: '6px 8px', fontSize: 12 }}>Cancel</button>
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const stHistory = {
  panel:  { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: 'hidden', boxShadow: T.shadow },
  header: { padding: '14px 18px', fontSize: 13, fontWeight: 700, color: T.text, borderBottom: `1px solid ${T.border}`, letterSpacing: '-0.01em' },
  th:     { padding: '10px 18px', fontSize: 10, fontWeight: 700, color: T.textDim, letterSpacing: '0.06em', textTransform: 'uppercase' as const, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' as const, background: 'rgba(255,255,255,0.015)' },
  td:     { padding: '10px 18px', fontSize: 13, color: T.textMid, borderBottom: `1px solid ${T.borderSoft}`, transition: 'background 0.1s' },
  badge:  { display: 'inline-block', padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: 'capitalize' as const },
};

const st = {
  stepRow:     { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0 },
  stepDot:     { width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 },
  stepDone:    { background: 'var(--accent)', color: '#06140d' },
  stepActive:  { background: 'var(--accent)', color: '#06140d', boxShadow: '0 0 0 4px var(--accent-dim), 0 0 16px var(--accent-glow)' },
  stepFuture:  { background: T.surface2, color: T.textDim, border: `1px solid ${T.border}` },
  stepLine:    { flex: 1, height: 2, maxWidth: 70, margin: '0 14px', borderRadius: 2 },
  stepLabel:   { fontSize: 13 },
  stepCard:    { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: '30px 34px', boxShadow: T.shadow },
  stepTitle:   { fontSize: 19, fontWeight: 800, color: T.text, margin: '0 0 6px', letterSpacing: '-0.03em' },
  stepSub:     { fontSize: 13.5, color: T.textDim, margin: '0 0 22px', lineHeight: 1.5 },
  dropzone:    { border: `2px dashed ${T.borderHi}`, borderRadius: T.radius, padding: '44px 24px', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', cursor: 'pointer', transition: 'all 0.16s', background: 'rgba(255,255,255,0.015)', textAlign: 'center' as const },
  dropzoneActive: { borderColor: 'var(--accent)', background: T.accentDim },
  dropzoneFilled: { borderColor: 'var(--accent)', borderStyle: 'solid', background: T.accentDim },
  uploadIcon:  { width: 52, height: 52, borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  fileIcon:    { width: 52, height: 52, borderRadius: 14, background: T.accentDim, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  label:       { display: 'block', fontSize: 11.5, fontWeight: 700, color: T.textDim, marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' as const },
  select:      { padding: '10px 12px', fontSize: 14, border: `1px solid ${T.border}`, borderRadius: 9, background: T.surface2, width: '100%', color: T.text, cursor: 'pointer' },
  primaryBtn:  { padding: '10px 22px', fontSize: 13.5, fontWeight: 700, background: 'var(--accent)', color: '#06140d', border: 'none', borderRadius: 9, cursor: 'pointer', boxShadow: '0 0 20px var(--accent-glow)' },
  confirmBtn:  { padding: '10px 22px', fontSize: 13.5, fontWeight: 700, background: T.pos, color: '#06140d', border: 'none', borderRadius: 9, cursor: 'pointer', boxShadow: `0 0 20px ${T.pos}55` },
  ghostBtn:    { padding: '10px 18px', fontSize: 13, fontWeight: 600, background: T.surface2, color: T.textMid, border: `1px solid ${T.border}`, borderRadius: 9, cursor: 'pointer' },
  reviewTable: { border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: 'hidden' },
  th:          { padding: '10px 14px', fontSize: 10.5, fontWeight: 700, color: T.textDim, letterSpacing: '0.07em', textTransform: 'uppercase' as const, borderBottom: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.015)' },
  td:          { padding: '10px 14px', fontSize: 13, color: T.textMid },
  autoTag:     { marginLeft: 8, background: T.accentDim, color: 'var(--accent)', fontSize: 10, fontWeight: 700, borderRadius: 5, padding: '2px 6px', letterSpacing: '0.05em', textTransform: 'uppercase' as const },
  inlineSelect:{ padding: '5px 9px', fontSize: 12.5, border: '1px solid', borderRadius: 7, background: T.surface2, fontWeight: 600, cursor: 'pointer' },
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 8 },
  summaryItem: { background: 'rgba(255,255,255,0.02)', border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: '16px 14px', textAlign: 'center' as const },
  summaryNum:  { fontSize: 21, fontWeight: 700, fontFamily: T.mono, letterSpacing: '-0.02em' },
  summaryLbl:  { fontSize: 11, color: T.textDim, marginTop: 4, fontWeight: 600, letterSpacing: '0.04em' },
  confirmMeta: { marginTop: 18, padding: '4px 0' },
  metaRow:     { display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${T.borderSoft}` },
  metaKey:     { fontSize: 13, color: T.textDim, fontWeight: 600 },
  metaVal:     { fontSize: 13, color: T.text, fontFamily: T.mono, fontWeight: 500 },
  warnBox:     { marginTop: 14, padding: '11px 14px', background: T.warnDim, border: `1px solid ${T.warn}33`, borderRadius: 9, color: T.warn, fontSize: 12.5, fontWeight: 600 },
  doneWrap:    { padding: '70px 24px', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 14 },
  doneCircle:  { width: 76, height: 76, borderRadius: '50%', background: T.accentDim, border: `1px solid ${T.borderHi}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 36px var(--accent-glow)' },
};
