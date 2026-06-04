import { useState } from 'react';
import { T } from '../theme';
import { createAccount } from '../api';
import type { Account } from '../api';

interface Props {
  onClose: () => void;
  onCreated: (account: Account) => void;
}

export function AccountFormModal({ onClose, onCreated }: Props) {
  const [name,      setName]      = useState('');
  const [type,      setType]      = useState('checking');
  const [currency,  setCurrency]  = useState('CRC');
  const [balance,   setBalance]   = useState('');
  const [onBudget,  setOnBudget]  = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const acc = await createAccount({
        name: name.trim(),
        type,
        currency,
        balance: parseFloat(balance) || 0,
        on_budget: onBudget,
      });
      onCreated(acc);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={st.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={st.panel}>
        <div style={st.header}>
          <span style={st.title}>New Account</span>
          <button onClick={onClose} style={st.closeBtn}>✕</button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={st.field}>
            <label style={st.label}>Account Name</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. BAC Checking"
              style={st.input}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={st.field}>
              <label style={st.label}>Type</label>
              <select value={type} onChange={e => setType(e.target.value)} style={st.select}>
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="credit_card">Credit Card</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Currency</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['CRC', 'USD'] as const).map(c => (
                  <button
                    key={c} type="button"
                    onClick={() => setCurrency(c)}
                    style={{ ...st.pill, ...(currency === c ? st.pillOn : {}) }}
                  >
                    {c === 'CRC' ? '₡ CRC' : '$ USD'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={st.field}>
            <label style={st.label}>Starting Balance</label>
            <input
              type="number"
              value={balance}
              onChange={e => setBalance(e.target.value)}
              placeholder="0"
              style={st.input}
            />
            <span style={st.hint}>Leave 0 if you'll import transactions instead</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              id="onBudget"
              checked={onBudget}
              onChange={e => setOnBudget(e.target.checked)}
              style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }}
            />
            <label htmlFor="onBudget" style={{ fontSize: 13, color: T.textMid, cursor: 'pointer' }}>
              Include in budget
            </label>
          </div>

          {error && <div style={st.errorMsg}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button type="button" onClick={onClose} style={st.cancelBtn}>Cancel</button>
            <button type="submit" disabled={saving} style={st.submitBtn}>
              {saving ? 'Creating…' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const st = {
  overlay:   { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, backdropFilter: 'blur(4px)' },
  panel:     { background: T.surface2, border: `1px solid ${T.borderHi}`, borderRadius: T.radius, padding: 28, width: 440, boxShadow: '0 24px 60px rgba(0,0,0,0.85)' },
  header:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title:     { fontSize: 15, fontWeight: 700, color: T.text, letterSpacing: '-0.02em' },
  closeBtn:  { background: 'none', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: 14, padding: 4 },
  field:     { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  label:     { fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const },
  input:     { padding: '9px 12px', fontSize: 13.5, border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface, color: T.text, outline: 'none' },
  select:    { padding: '9px 12px', fontSize: 13.5, border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface, color: T.text, cursor: 'pointer' },
  pill:      { flex: 1, padding: '8px 10px', fontSize: 12.5, fontWeight: 600, border: `1px solid ${T.border}`, borderRadius: 7, background: T.surface, color: T.textMid, cursor: 'pointer' },
  pillOn:    { background: T.accentDim, borderColor: 'var(--accent)', color: 'var(--accent)' },
  hint:      { fontSize: 11, color: T.textFaint, marginTop: 2 },
  errorMsg:  { fontSize: 12.5, color: T.neg, background: T.negDim, border: `1px solid ${T.neg}`, borderRadius: 7, padding: '8px 12px' },
  cancelBtn: { padding: '9px 16px', fontSize: 13, fontWeight: 600, background: 'none', border: `1px solid ${T.border}`, borderRadius: 8, color: T.textMid, cursor: 'pointer' },
  submitBtn: { padding: '9px 20px', fontSize: 13, fontWeight: 700, background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#06140d', cursor: 'pointer' },
};
