import { useState, useRef, useCallback } from 'react';
import { T } from '../theme';
import { categorize } from '../engine';
import { AppData } from '../data';
import type { CategoryGroup } from '../data';

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
  onNavigate: (page: string) => void;
}

export function ImportWizard({ accounts, categoryGroups, onNavigate }: Props) {
  const [step, setStep] = useState(0);
  const [uploadInfo, setUploadInfo] = useState<{ file: { name: string }; accountId: string } | null>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>(SAMPLE_PARSED);
  const [done, setDone] = useState(false);
  const handleChangeParsed = (id: number, key: string, val: string | null) =>
    setParsed(rows => rows.map(r => r.id === id ? { ...r, [key]: val } : r));

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
    <div style={{ padding: '28px 24px', maxWidth: 760, margin: '0 auto' }}>
      <StepIndicator step={step} />
      <div style={{ marginTop: 28 }}>
        {step === 0 && <Step1 accounts={accounts} onNext={info => { setUploadInfo(info); setStep(1); }} />}
        {step === 1 && <Step2 parsed={parsed} onChangeParsed={handleChangeParsed} categoryGroups={categoryGroups} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && <Step3 parsed={parsed} uploadInfo={uploadInfo ?? { file: { name: 'estado_cuenta_abril.csv' } }} onBack={() => setStep(1)} onConfirm={() => setDone(true)} />}
      </div>
    </div>
  );
}

import React from 'react';

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
