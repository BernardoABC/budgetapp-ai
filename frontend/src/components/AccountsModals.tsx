import { useState } from 'react';
import { T } from '../theme';
import type { Account, Transaction } from '../api';

export interface PayeeRule { id: string; match: string; category: string; }

// ── Reconcile ──────────────────────────────────────────────

interface ReconcileProps {
  account: Account;
  clearedBalance: number;
  fmt: (n: number, txnCurrency?: string) => string;
  onClose: () => void;
  onReconcile: (diff: number) => void;
}

export function ReconcileModal({ account, clearedBalance, fmt, onClose, onReconcile }: ReconcileProps) {
  const [stage, setStage] = useState<'ask' | 'balance'>('ask');
  const [actual, setActual] = useState(String(clearedBalance));
  const diff = (Number(actual) || 0) - clearedBalance;

  return (
    <div style={am.overlay} onClick={onClose}>
      <div style={am.card} onClick={e => e.stopPropagation()}>
        <div style={am.header}><span style={am.title}>Reconcile · {account.name}</span><button onClick={onClose} style={am.close}>✕</button></div>
        <div style={am.body}>
          {stage === 'ask' && (
            <>
              <p style={am.lead}>Your cleared balance in budgetapp is</p>
              <div style={am.bigNum}>{fmt(clearedBalance, account.currency)}</div>
              <p style={am.help}>Does this match what your bank shows right now?</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button onClick={() => onReconcile(0)} style={am.primaryBtn}>Yes, it matches</button>
                <button onClick={() => setStage('balance')} style={am.ghostBtn}>No, enter balance</button>
              </div>
            </>
          )}
          {stage === 'balance' && (
            <>
              <div style={am.label}>Actual cleared balance</div>
              <input type="number" value={actual} onChange={e => setActual(e.target.value)} style={am.input} autoFocus />
              <div style={am.diffBox}>
                <span style={{ color: T.textDim }}>Adjustment needed</span>
                <span style={{ fontFamily: T.mono, fontWeight: 700, color: diff === 0 ? T.textMid : diff > 0 ? T.pos : T.neg }}>{diff > 0 ? '+' : ''}{fmt(diff, account.currency)}</span>
              </div>
              {diff !== 0 && <p style={am.help}>We'll create a reconciliation adjustment of {fmt(diff, account.currency)} and mark everything cleared.</p>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button onClick={() => setStage('ask')} style={am.ghostBtn}>Back</button>
                <button onClick={() => onReconcile(diff)} style={am.primaryBtn}>{diff === 0 ? 'Mark cleared' : 'Create adjustment'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Payee Rules ────────────────────────────────────────────

interface RulesProps {
  rules: PayeeRule[];
  categories: string[];
  onClose: () => void;
  onAdd: (r: PayeeRule) => void;
  onDelete: (id: string) => void;
}

export function RulesManager({ rules, categories, onClose, onAdd, onDelete }: RulesProps) {
  const [match, setMatch] = useState('');
  const [category, setCategory] = useState(categories[0] ?? '');
  const add = () => { if (match.trim()) { onAdd({ id: 'r' + Date.now(), match: match.trim(), category }); setMatch(''); } };
  return (
    <div style={am.overlay} onClick={onClose}>
      <div style={{ ...am.card, width: 460 }} onClick={e => e.stopPropagation()}>
        <div style={am.header}><span style={am.title}>Payee Rules</span><button onClick={onClose} style={am.close}>✕</button></div>
        <div style={am.body}>
          <p style={am.help}>When an imported payee contains the text, it's auto-assigned to the category.</p>
          <div style={am.rulesList}>
            {rules.map(r => (
              <div key={r.id} style={am.ruleRow}>
                <span style={am.ruleMatch}>"{r.match}"</span>
                <span style={{ color: T.textFaint }}>→</span>
                <span style={am.ruleCat}>{r.category}</span>
                <button onClick={() => onDelete(r.id)} style={{ ...am.close, marginLeft: 'auto' }}>✕</button>
              </div>
            ))}
            {rules.length === 0 && <div style={{ color: T.textDim, fontSize: 13, padding: 12, textAlign: 'center' }}>No rules yet</div>}
          </div>
          <div style={am.addRule}>
            <input value={match} onChange={e => setMatch(e.target.value)} placeholder="Payee contains…" style={{ ...am.input, flex: 1, marginBottom: 0 }} onKeyDown={e => e.key === 'Enter' && add()} />
            <span style={{ color: T.textFaint }}>→</span>
            <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...am.select, marginBottom: 0 }}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={add} style={am.primaryBtn}>Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Split editor ───────────────────────────────────────────

interface SplitProps {
  txn: Transaction;
  categories: string[];
  fmt: (n: number, txnCurrency?: string) => string;
  onClose: () => void;
  onSave: (id: string, splits: { category: string; amount: number }[]) => void;
}

export function SplitModal({ txn, categories, fmt, onClose, onSave }: SplitProps) {
  const init = txn.splits?.length ? txn.splits : [{ category: txn.category ?? (categories[0] ?? ''), amount: txn.outflow }];
  const [rows, setRows] = useState(init.map(s => ({ ...s })));
  const total = txn.outflow;
  const allocated = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const remaining = total - allocated;

  const update = (i: number, key: string, val: string | number) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [key]: val } : r));
  const addRow = () => setRows(rs => [...rs, { category: categories[0] ?? '', amount: Math.max(0, remaining) }]);
  const removeRow = (i: number) => setRows(rs => rs.filter((_, j) => j !== i));
  const save = () => onSave(txn.id, rows.filter(r => Number(r.amount) > 0).map(r => ({ category: r.category, amount: Number(r.amount) })));

  return (
    <div style={am.overlay} onClick={onClose}>
      <div style={{ ...am.card, width: 480 }} onClick={e => e.stopPropagation()}>
        <div style={am.header}><span style={am.title}>Split · {txn.payee}</span><button onClick={onClose} style={am.close}>✕</button></div>
        <div style={am.body}>
          <p style={am.help}>Divide {fmt(total, txn.currency)} across categories.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select value={r.category} onChange={e => update(i, 'category', e.target.value)} style={{ ...am.select, flex: 1, marginBottom: 0 }}>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input type="number" value={r.amount} onChange={e => update(i, 'amount', e.target.value)} style={{ ...am.input, width: 110, marginBottom: 0, fontFamily: T.mono }} />
                {rows.length > 1 && <button onClick={() => removeRow(i)} style={am.close}>✕</button>}
              </div>
            ))}
          </div>
          <button onClick={addRow} style={am.addSplitBtn}>+ Add split</button>
          <div style={am.diffBox}>
            <span style={{ color: T.textDim }}>Remaining to allocate</span>
            <span style={{ fontFamily: T.mono, fontWeight: 700, color: remaining === 0 ? T.pos : T.warn }}>{fmt(remaining, txn.currency)}</span>
          </div>
        </div>
        <div style={am.footer}>
          <button onClick={onClose} style={am.ghostBtn}>Cancel</button>
          <button onClick={save} disabled={remaining !== 0} style={{ ...am.primaryBtn, opacity: remaining === 0 ? 1 : 0.4, cursor: remaining === 0 ? 'pointer' : 'default' }}>Save split</button>
        </div>
      </div>
    </div>
  );
}

// ── Payee Category Suggestion ──────────────────────────────

export interface PayeeSuggestionState {
  step: 1 | 2;
  payee: string;
  transactions: Transaction[];
  categoryId: string;
  categoryName: string;
  hadPreviousCategory: boolean;
}

interface PayeeSuggestionProps {
  state: PayeeSuggestionState;
  onQ1Yes: () => void;
  onQ1No: () => void;
  onQ2Yes: () => void;
  onQ2No: () => void;
}

export function PayeeSuggestionModal({ state, onQ1Yes, onQ1No, onQ2Yes, onQ2No }: PayeeSuggestionProps) {
  return (
    <div style={am.overlay}>
      <div style={{ ...am.card, width: 440 }} onClick={e => e.stopPropagation()}>
        <div style={am.header}>
          <span style={am.title}>
            {state.step === 1 ? 'Apply to existing transactions?' : 'Create payee rule?'}
          </span>
        </div>
        <div style={am.body}>
          {state.step === 1 && (
            <>
              <p style={{ ...am.lead, fontSize: 13.5, color: 'var(--text, #e8e8e8)', marginBottom: 8 }}>
                <strong>{state.transactions.length}</strong> other transaction{state.transactions.length !== 1 ? 's' : ''} {state.transactions.length !== 1 ? 'have' : 'has'} <strong>"{state.payee}"</strong> as payee.
              </p>
              <p style={am.help}>Apply <strong style={{ color: 'var(--accent)' }}>{state.categoryName}</strong> to all of them?</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                <button onClick={onQ1Yes} style={am.primaryBtn}>Yes, apply to all</button>
                <button onClick={onQ1No} style={am.ghostBtn}>No, just this one</button>
              </div>
            </>
          )}
          {state.step === 2 && (
            <>
              <p style={{ ...am.lead, fontSize: 13.5, color: 'var(--text, #e8e8e8)', marginBottom: 8 }}>
                Create a rule so future <strong>"{state.payee}"</strong> imports are automatically categorized?
              </p>
              <p style={am.help}>Category: <strong style={{ color: 'var(--accent)' }}>{state.categoryName}</strong></p>
              <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                <button onClick={onQ2Yes} style={am.primaryBtn}>Yes, create rule</button>
                <button onClick={onQ2No} style={am.ghostBtn}>No thanks</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const am = {
  overlay:     { position: 'fixed' as const, inset: 0, background: 'rgba(4,6,10,0.66)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  card:        { width: 400, maxWidth: 'calc(100vw - 40px)', background: T.surface2, border: `1px solid ${T.borderHi}`, borderRadius: T.radius, boxShadow: '0 32px 80px -20px rgba(0,0,0,0.85)', overflow: 'hidden' },
  header:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${T.border}` },
  title:       { fontSize: 15, fontWeight: 800, color: T.text, letterSpacing: '-0.02em' },
  close:       { background: 'none', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: 14, padding: 4 },
  body:        { padding: 20 },
  footer:      { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.015)' },
  lead:        { fontSize: 13, color: T.textDim, margin: '0 0 4px' },
  bigNum:      { fontSize: 30, fontWeight: 700, fontFamily: T.mono, color: T.text, letterSpacing: '-0.03em' },
  help:        { fontSize: 12.5, color: T.textDim, margin: '8px 0 0', lineHeight: 1.5 },
  label:       { fontSize: 10.5, fontWeight: 700, color: T.textDim, marginBottom: 7, letterSpacing: '0.08em', textTransform: 'uppercase' as const },
  input:       { width: '100%', padding: '9px 12px', fontSize: 15, border: `1px solid ${T.borderHi}`, borderRadius: 8, background: T.surface, color: T.text, marginBottom: 4 },
  select:      { padding: '8px 10px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface, color: T.text, cursor: 'pointer', marginBottom: 4 },
  diffBox:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, padding: '11px 14px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13 },
  primaryBtn:  { padding: '9px 16px', fontSize: 13, fontWeight: 700, background: 'var(--accent)', color: '#06140d', border: 'none', borderRadius: 8, cursor: 'pointer', boxShadow: '0 0 16px var(--accent-glow)' },
  ghostBtn:    { padding: '9px 14px', fontSize: 13, fontWeight: 600, background: T.surface, color: T.textMid, border: `1px solid ${T.border}`, borderRadius: 8, cursor: 'pointer' },
  rulesList:   { display: 'flex', flexDirection: 'column' as const, gap: 6, margin: '12px 0', maxHeight: 220, overflowY: 'auto' as const },
  ruleRow:     { display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${T.border}`, borderRadius: 8 },
  ruleMatch:   { fontSize: 13, fontWeight: 600, color: T.text },
  ruleCat:     { fontSize: 12.5, color: 'var(--accent)', fontWeight: 600 },
  addRule:     { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 },
  addSplitBtn: { marginTop: 10, background: 'none', border: `1px dashed ${T.border}`, borderRadius: 7, color: T.textDim, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '7px 12px', width: '100%' },
};
