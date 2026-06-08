import React, { useState, useRef, useCallback, useEffect } from 'react';
import { T } from '../theme';
import type { CategoryGroup, Account, Transaction } from '../api';
import {
  fetchImportHistory, fetchAccounts, fetchPayeeRules,
  createPayeeRule, updatePayeeRule, deletePayeeRule,
  importPreview, importConfirm,
  fetchTransferCandidates, linkTransfer,
} from '../api';
import type { ImportRecord, PayeeRule as ApiPayeeRule, ConfirmTxn } from '../api';
import { useToast } from './Toast';

type Accounts = { budget: Account[]; tracking: Account[] };

// Amounts are centimos (minor units); divide by 100 for display via fmt().
interface ParsedRow {
  tempId: string;
  date: string;
  descriptionRaw: string;
  amount: number;
  reference: string;
  categoryId: string | null;
  autoCat: boolean;
  duplicateOf: string | null;
  include: boolean;
  isTransfer: boolean;
}

function StepIndicator({ step }: { step: number }) {
  const steps = ['Upload', 'Review', 'Confirm', 'Link'];
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

function Step1({ accounts, previewing, onNext }: { accounts: Accounts; previewing: boolean; onNext: (info: { file: File; accountId: string }) => void }) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState(accounts.budget[0]?.id ?? accounts.tracking[0]?.id ?? '');
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
        <button
          onClick={() => { if (file && accountId && !previewing) onNext({ file, accountId }); }}
          disabled={!file || !accountId || previewing}
          style={{ ...st.primaryBtn, opacity: (file && accountId && !previewing) ? 1 : 0.45, cursor: (file && accountId && !previewing) ? 'pointer' : 'not-allowed' }}
        >Continue →</button>
      </div>
    </div>
  );
}

function Step2({ parsed, allCategoryNames, categoryIdByName, onSetCategory, onToggleInclude, fmt, onNext, onBack }: {
  parsed: ParsedRow[];
  allCategoryNames: string[];
  categoryIdByName: Record<string, string>;
  onSetCategory: (tempId: string, categoryId: string | null) => void;
  onToggleInclude: (tempId: string) => void;
  fmt: (n: number) => string;
  onNext: () => void;
  onBack: () => void;
}) {
  const included = parsed.filter(p => p.include);
  const autoCount = parsed.filter(p => p.autoCat).length;
  const dupCount = parsed.filter(p => p.duplicateOf != null).length;
  return (
    <div style={st.stepCard}>
      <h3 style={st.stepTitle}>Review transactions</h3>
      <p style={st.stepSub}>
        <b style={{ color: T.text }}>{parsed.length}</b> parsed · <span style={{ color: 'var(--accent)' }}>{autoCount} auto-categorized</span>
        {dupCount > 0 && <> · <span style={{ color: T.warn }}>{dupCount} duplicate{dupCount > 1 ? 's' : ''} skipped</span></>}.
        <b style={{ color: T.text }}> {included.length}</b> will import.
      </p>
      <div style={st.reviewTable}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['', 'Date', 'Payee', 'Category', 'Amount'].map((h, i) => <th key={i} style={{ ...st.th, textAlign: h === 'Amount' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {parsed.map(row => (
              <tr key={row.tempId} style={{ borderBottom: `1px solid ${T.borderSoft}`, opacity: row.include ? 1 : 0.45 }}>
                <td style={{ ...st.td, width: 30 }}>
                  <input type="checkbox" checked={row.include} onChange={() => onToggleInclude(row.tempId)} style={{ cursor: 'pointer' }} />
                </td>
                <td style={{ ...st.td, fontFamily: T.mono, fontSize: 12, color: T.textDim }}>{row.date.slice(5).replace('-', '/')}</td>
                <td style={st.td}>
                  <span style={{ fontWeight: 600, color: T.text }}>{row.descriptionRaw}</span>
                  {row.autoCat && <span style={st.autoTag}>auto</span>}
                  {row.duplicateOf != null && <span style={st.dupTag}>duplicate</span>}
                  {row.isTransfer && <span style={{ fontSize: 9, fontWeight: 700, color: '#6C8EBF', background: 'rgba(108,142,191,0.12)', borderRadius: 4, padding: '1px 5px', marginLeft: 4 }}>⇄</span>}
                </td>
                <td style={st.td}>
                  <select
                    value={row.categoryId ?? ''}
                    onChange={e => onSetCategory(row.tempId, e.target.value || null)}
                    style={{ ...st.inlineSelect, borderColor: row.categoryId ? T.border : T.warn, color: row.categoryId ? T.text : T.warn }}
                  >
                    <option value="">— assign —</option>
                    {allCategoryNames.map(name => (
                      <option key={name} value={categoryIdByName[name] ?? ''}>{name}</option>
                    ))}
                  </select>
                </td>
                <td style={{ ...st.td, textAlign: 'right', fontFamily: T.mono, fontSize: 12.5, fontWeight: 600 }}>
                  <span style={{ color: row.amount > 0 ? T.pos : T.textMid }}>{row.amount > 0 ? '+' : '−'}{fmt(Math.abs(row.amount) / 100)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 22, display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={onBack} style={st.ghostBtn}>← Back</button>
        <button onClick={onNext} disabled={included.length === 0}
          style={{ ...st.primaryBtn, opacity: included.length === 0 ? 0.45 : 1, cursor: included.length === 0 ? 'not-allowed' : 'pointer' }}>
          Continue →
        </button>
      </div>
    </div>
  );
}

function Step3({ parsed, filename, fmt, confirming, onBack, onConfirm }: {
  parsed: ParsedRow[];
  filename: string;
  fmt: (n: number) => string;
  confirming: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const included = parsed.filter(r => r.include);
  const outflows = included.filter(r => r.amount < 0);
  const inflows = included.filter(r => r.amount > 0);
  const net = included.reduce((s, r) => s + r.amount, 0);
  const dates = included.map(r => r.date).sort();
  const uncategorized = included.filter(r => !r.categoryId).length;
  const Stat = ({ num, lbl, color }: { num: string | number; lbl: string; color?: string }) => (
    <div style={st.summaryItem}><div style={{ ...st.summaryNum, color: color ?? T.text }}>{num}</div><div style={st.summaryLbl}>{lbl}</div></div>
  );
  return (
    <div style={st.stepCard}>
      <h3 style={st.stepTitle}>Confirm import</h3>
      <p style={st.stepSub}>Review the summary before importing.</p>
      <div style={st.summaryGrid}>
        <Stat num={included.length} lbl="Transactions" />
        <Stat num={outflows.length} lbl="Outflows" color={T.textMid} />
        <Stat num={inflows.length} lbl="Inflows" color={T.pos} />
        <Stat num={(net > 0 ? '+' : '−') + fmt(Math.abs(net) / 100)} lbl="Net" color={net < 0 ? T.neg : T.pos} />
      </div>
      <div style={st.confirmMeta}>
        <div style={st.metaRow}><span style={st.metaKey}>Date range</span><span style={st.metaVal}>{dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : '—'}</span></div>
        <div style={st.metaRow}><span style={st.metaKey}>Source file</span><span style={st.metaVal}>{filename}</span></div>
        {uncategorized > 0 && <div style={st.warnBox}>⚠ {uncategorized} transaction{uncategorized > 1 ? 's' : ''} without a category — you can assign later.</div>}
      </div>
      <div style={{ marginTop: 26, display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={onBack} style={st.ghostBtn} disabled={confirming}>← Back</button>
        <button onClick={onConfirm} disabled={confirming || included.length === 0}
          style={{ ...st.confirmBtn, opacity: confirming || included.length === 0 ? 0.55 : 1, cursor: confirming ? 'wait' : 'pointer' }}>
          {confirming ? 'Importing…' : `Import ${included.length} transactions ✓`}
        </button>
      </div>
    </div>
  );
}

interface Props {
  accounts: Accounts;
  categoryGroups: CategoryGroup[];
  categoryIdByName: Record<string, string>;
  fmt: (n: number) => string;
  onNavigate: (page: string) => void;
}

export function ImportWizard({ accounts, categoryGroups, categoryIdByName, fmt, onNavigate }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<'import' | 'rules'>('import');
  const [step, setStep] = useState(0);
  const [uploadInfo, setUploadInfo] = useState<{ file: File; accountId: string } | null>(null);
  const [csvCurrency, setCsvCurrency] = useState<string>('');
  const [currencyMismatch, setCurrencyMismatch] = useState(false);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [done, setDone] = useState(false);
  const [pendingTransferIds, setPendingTransferIds] = useState<string[]>([]);
  const [linkState, setLinkState] = useState<{
    id: string;
    date: string;
    amount: number;
    description: string;
    step: 1 | 2;
    targetAccountId: string;
    candidates: Transaction[];
    loading: boolean;
  } | null>(null);

  const idToName = Object.fromEntries(Object.entries(categoryIdByName).map(([name, id]) => [id, name]));
  const allCategoryNames = categoryGroups.flatMap(g => g.categories);

  // Formats amounts in the CSV's native currency — never converts via exchange rate.
  const fmtCsv = useCallback((amount: number) => {
    if (csvCurrency === 'USD') {
      const sign = amount < 0 ? '-' : '';
      return sign + '$' + Math.abs(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    const abs = Math.abs(Math.round(amount));
    return (amount < 0 ? '-' : '') + '₡' + abs.toLocaleString('en-US');
  }, [csvCurrency]);

  const handleSetCategory = (tempId: string, categoryId: string | null) =>
    setParsed(rows => rows.map(r => r.tempId === tempId ? { ...r, categoryId } : r));
  const handleToggleInclude = (tempId: string) =>
    setParsed(rows => rows.map(r => r.tempId === tempId ? { ...r, include: !r.include } : r));

  const runPreview = (info: { file: File; accountId: string }) => {
    setUploadInfo(info);
    setPreviewing(true);
    importPreview(info.file, info.accountId)
      .then(resp => {
        const rows: ParsedRow[] = resp.transactions.map(t => ({
          tempId: t.temp_id,
          date: t.date,
          descriptionRaw: t.description_raw,
          amount: t.amount,
          reference: t.reference,
          categoryId: t.suggested_category_id,
          autoCat: t.suggested_category_id != null,
          duplicateOf: t.duplicate_of,
          include: t.duplicate_of == null, // duplicates default to excluded
          isTransfer: t.is_transfer ?? false,
        }));
        setCsvCurrency(resp.file_info.currency);
        setCurrencyMismatch(resp.file_info.currency_mismatch);
        setParsed(rows);
        setStep(1);
      })
      .catch(err => toast.error('Preview failed: ' + err.message))
      .finally(() => setPreviewing(false));
  };

  const runConfirm = () => {
    if (!uploadInfo) return;
    setConfirming(true);
    const payload: ConfirmTxn[] = parsed.map(r => ({
      include: r.include,
      date: r.date,
      amount: r.amount,
      description_raw: r.descriptionRaw,
      reference: r.reference,
      category_id: r.categoryId,
      payee_override: null,
      memo: null,
      is_transfer: r.isTransfer,
    }));
    importConfirm(uploadInfo.accountId, uploadInfo.file.name, payload, csvCurrency)
      .then(resp => {
        setResult({ imported: resp.imported_count, skipped: resp.skipped_count });
        if (resp.transfer_transaction_ids && resp.transfer_transaction_ids.length > 0) {
          setPendingTransferIds(resp.transfer_transaction_ids);
          setStep(3);
        } else {
          setDone(true);
        }
      })
      .catch(err => toast.error('Import failed: ' + err.message))
      .finally(() => setConfirming(false));
  };

  if (done) {
    return (
      <div style={st.doneWrap}>
        <div style={st.doneCircle}><svg width="34" height="34" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: T.text, margin: 0, letterSpacing: '-0.03em' }}>Import complete</h2>
        <p style={{ color: T.textDim, margin: 0, fontSize: 14 }}>
          {result?.imported ?? 0} transaction{(result?.imported ?? 0) === 1 ? '' : 's'} added
          {result && result.skipped > 0 ? ` · ${result.skipped} skipped` : ''}.
        </p>
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
            {step === 0 && (
              <>
                <Step1 accounts={accounts} previewing={previewing} onNext={runPreview} />
                {previewing && <div style={{ marginTop: 14, textAlign: 'center', color: T.textDim, fontSize: 13 }}>Parsing statement…</div>}
              </>
            )}
            {step === 1 && <>
              {currencyMismatch && (
                <div style={{ marginBottom: 16, padding: '11px 16px', background: 'rgba(246,196,90,0.1)', border: `1px solid ${T.warn}44`, borderRadius: T.radius, color: T.warn, fontSize: 13, fontWeight: 600 }}>
                  ⚠ Currency mismatch: the CSV is <b>{csvCurrency}</b> but the account is a different currency. Importing will tag these transactions with the wrong currency.
                </div>
              )}
              <Step2
                parsed={parsed}
                allCategoryNames={allCategoryNames}
                categoryIdByName={categoryIdByName}
                onSetCategory={handleSetCategory}
                onToggleInclude={handleToggleInclude}
                fmt={fmtCsv}
                onNext={() => setStep(2)}
                onBack={() => setStep(0)}
              />
            </>}
            {step === 2 && <>
              {currencyMismatch && (
                <div style={{ marginBottom: 16, padding: '11px 16px', background: 'rgba(246,196,90,0.1)', border: `1px solid ${T.warn}44`, borderRadius: T.radius, color: T.warn, fontSize: 13, fontWeight: 600 }}>
                  ⚠ Currency mismatch: the CSV is <b>{csvCurrency}</b> but the account uses a different currency. Go back and change the account or create a new one with the correct currency.
                </div>
              )}
              <Step3
                parsed={parsed}
                filename={uploadInfo?.file.name ?? ''}
                fmt={fmtCsv}
                confirming={confirming}
                onBack={() => setStep(1)}
                onConfirm={runConfirm}
              />
            </>}
            {step === 3 && (
              <div style={st.stepCard}>
                <h3 style={st.stepTitle}>Link Transfer Transactions</h3>
                <p style={st.stepSub}>
                  {pendingTransferIds.length} imported transaction{pendingTransferIds.length > 1 ? 's were' : ' was'} flagged as a bank transfer.
                  Link each one to its counterpart in another account, or skip.
                </p>
                {pendingTransferIds.map((txnId, i) => {
                  const row = parsed.filter(r => r.include && r.isTransfer)[i];
                  return (
                    <div key={txnId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${T.border}` }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: T.text }}>{row?.descriptionRaw ?? txnId}</div>
                        <div style={{ fontSize: 11, color: T.textDim }}>{row?.date} · {row ? (row.amount > 0 ? '+' : '−') + fmtCsv(Math.abs(row.amount) / 100) : ''}</div>
                      </div>
                      <button
                        onClick={() => setLinkState({
                          id: txnId,
                          date: row?.date ?? '',
                          amount: row?.amount ?? 0,
                          description: row?.descriptionRaw ?? '',
                          step: 1,
                          targetAccountId: '',
                          candidates: [],
                          loading: false,
                        })}
                        style={{ padding: '6px 14px', borderRadius: 7, background: 'var(--accent)', color: '#06140d', border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                      >
                        Link…
                      </button>
                    </div>
                  );
                })}
                <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => setDone(true)} style={st.ghostBtn}>Done</button>
                </div>
              </div>
            )}
            {linkState && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => setLinkState(null)}>
                <div style={{ background: T.surface, borderRadius: 12, padding: 28, width: 460, maxHeight: '80vh', overflowY: 'auto' }}
                  onClick={e => e.stopPropagation()}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: T.text, marginBottom: 16 }}>Link Transfer</div>
                  {linkState.step === 1 && (
                    <>
                      <div style={{ fontSize: 13, color: T.textDim, marginBottom: 12 }}>
                        <b style={{ color: T.text }}>{linkState.description}</b><br />
                        {linkState.date} · {linkState.amount > 0 ? '+' : '−'}{fmt(Math.abs(linkState.amount) / 100)}
                      </div>
                      <label style={st.label}>Target account</label>
                      <select
                        style={st.select}
                        value={linkState.targetAccountId}
                        onChange={async e => {
                          const tgtId = e.target.value;
                          setLinkState(s => s ? { ...s, targetAccountId: tgtId, loading: true } : null);
                          const cands = await fetchTransferCandidates(tgtId, linkState.amount / 100).catch(() => [] as Transaction[]);
                          setLinkState(s => s ? { ...s, step: 2, candidates: cands, loading: false } : null);
                        }}
                      >
                        <option value="">Select account…</option>
                        {[...accounts.budget, ...accounts.tracking].map(a => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                      {linkState.loading && <div style={{ marginTop: 10, color: T.textDim, fontSize: 13 }}>Loading…</div>}
                    </>
                  )}
                  {linkState.step === 2 && (
                    <>
                      <div style={{ fontSize: 13, color: T.textDim, marginBottom: 12 }}>Select the matching transaction:</div>
                      {linkState.candidates.length === 0
                        ? <div style={{ color: T.textDim, fontSize: 13 }}>No unlinked matching transactions found.</div>
                        : linkState.candidates.map(c => (
                          <div key={c.id}
                            onClick={async () => {
                              try {
                                await linkTransfer(linkState.id, c.id);
                                setPendingTransferIds(ids => ids.filter(id => id !== linkState.id));
                                setLinkState(null);
                              } catch (e: any) { alert('Link failed: ' + e.message); }
                            }}
                            style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${T.border}`, marginBottom: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13, color: T.text }}>{c.payee}</div>
                              <div style={{ fontSize: 11, color: T.textDim }}>{c.date}</div>
                            </div>
                            <div style={{ fontFamily: T.mono, fontSize: 13, color: T.textMid }}>{c.inflow > 0 ? '+' : '−'}{fmt(c.inflow || c.outflow)}</div>
                          </div>
                        ))
                      }
                    </>
                  )}
                  <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={() => setLinkState(null)} style={st.ghostBtn}>Cancel</button>
                  </div>
                </div>
              </div>
            )}
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
  const toast = useToast();
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchImportHistory(),
      fetchAccounts().then(accs => [...accs.budget, ...accs.tracking]).catch(() => [] as Account[]),
    ])
      .then(([recs, accs]) => { setRecords(recs); setAccounts(accs); })
      .catch(err => toast.error('Failed to load import history: ' + err.message))
      .finally(() => setLoading(false));
  }, []);

  const accountName = (id: string) => accounts.find(a => a.id === id)?.name ?? id;
  const fmtDate = (s: string) => {
    try { return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return s; }
  };

  if (loading) return (
    <div style={{ maxWidth: 760, margin: '0 auto 28px', padding: '0 24px' }}>
      <div style={{ ...stHistory.panel }}>
        <div style={stHistory.header}>Import History</div>
        <div style={{ padding: '24px 18px', color: T.textDim, fontSize: 13 }}>Loading…</div>
      </div>
    </div>
  );

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
  dupTag:      { marginLeft: 8, background: T.warnDim, color: T.warn, fontSize: 10, fontWeight: 700, borderRadius: 5, padding: '2px 6px', letterSpacing: '0.05em', textTransform: 'uppercase' as const },
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
