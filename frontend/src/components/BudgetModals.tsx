import { useState } from 'react';
import { T } from '../theme';
import { targetLabel } from '../engine';
import type { CatState, MonthState } from '../engine';
import type { Target } from '../data';

// ── Move Money ─────────────────────────────────────────────

interface CatWithColor extends CatState {
  color: string;
}

interface MoveMoneyProps {
  cat: string;
  cats: CatWithColor[];
  fmt: (n: number) => string;
  onClose: () => void;
  onMove: (from: string, to: string, amount: number) => void;
}

export function MoveMoneyModal({ cat: current, cats, fmt, onClose, onMove }: MoveMoneyProps) {
  const curObj = cats.find(c => c.cat === current)!;
  const overspent = curObj.available < 0;
  const others = cats.filter(c => c.cat !== current);
  const surplus = others.filter(c => c.available > 0).sort((a, b) => b.available - a.available);
  const deficits = others.filter(c => c.available < 0).sort((a, b) => a.available - b.available);

  const [mode, setMode] = useState<'in' | 'out'>(overspent ? 'in' : 'out');
  const [other, setOther] = useState(((overspent ? surplus[0] : deficits[0] ?? surplus[0] ?? others[0]) ?? {}).cat ?? (others[0] ?? {}).cat ?? '');
  const [amount, setAmount] = useState(overspent ? Math.abs(curObj.available) : Math.max(curObj.available, 0));

  const otherObj = cats.find(c => c.cat === other);
  const amt = Math.max(0, Number(amount) || 0);
  const fromCat = mode === 'in' ? other : current;
  const toCat = mode === 'in' ? current : other;
  const curAfter = curObj.available + (mode === 'in' ? amt : -amt);
  const otherAfter = (otherObj?.available ?? 0) + (mode === 'in' ? -amt : amt);
  const apply = () => { if (amt > 0 && other) { onMove(fromCat, toCat, amt); onClose(); } };

  const Side = ({ obj, after }: { obj: CatWithColor; after: number }) => (
    <div style={mm.side}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2.5, background: obj.color, flexShrink: 0 }} />
        <span style={mm.sideName}>{obj.cat}</span>
      </div>
      <div style={mm.sideNums}>
        <span style={{ color: T.textDim }}>{fmt(obj.available)}</span>
        <span style={{ color: T.textFaint }}>→</span>
        <span style={{ color: after < 0 ? T.neg : T.pos, fontWeight: 700 }}>{fmt(after)}</span>
      </div>
    </div>
  );

  return (
    <div style={mm.overlay} onClick={onClose}>
      <div style={mm.card} onClick={e => e.stopPropagation()}>
        <div style={mm.header}>
          <span style={mm.title}>Move Money</span>
          <button onClick={onClose} style={mm.close}>✕</button>
        </div>
        <div style={mm.body}>
          <div style={mm.modeToggle}>
            <button onClick={() => setMode('in')} style={{ ...mm.modeBtn, ...(mode === 'in' ? mm.modeOn : {}) }}>Into {current}</button>
            <button onClick={() => setMode('out')} style={{ ...mm.modeBtn, ...(mode === 'out' ? mm.modeOn : {}) }}>Out of {current}</button>
          </div>
          <div>
            <div style={mm.label}>{mode === 'in' ? 'Take from' : 'Send to'}</div>
            <select value={other} onChange={e => setOther(e.target.value)} style={mm.select}>
              {(mode === 'in' ? [...surplus, ...others.filter(o => o.available <= 0)] : [...deficits, ...others.filter(o => o.available >= 0)]).map(c => (
                <option key={c.cat} value={c.cat}>{c.cat} ({fmt(c.available)})</option>
              ))}
            </select>
          </div>
          <div>
            <div style={mm.label}>Amount</div>
            <div style={mm.amountWrap}>
              <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} style={mm.amountInput} autoFocus />
              {overspent && mode === 'in' && (
                <button onClick={() => setAmount(Math.abs(curObj.available))} style={mm.coverBtn}>Cover {fmt(Math.abs(curObj.available))}</button>
              )}
            </div>
          </div>
          <div style={mm.preview}>
            {otherObj && <Side obj={mode === 'in' ? otherObj : curObj} after={mode === 'in' ? otherAfter : curAfter} />}
            <div style={mm.arrow}>↓</div>
            {otherObj && <Side obj={mode === 'in' ? curObj : otherObj} after={mode === 'in' ? curAfter : otherAfter} />}
          </div>
        </div>
        <div style={mm.footer}>
          <button onClick={onClose} style={mm.cancelBtn}>Cancel</button>
          <button onClick={apply} disabled={!(amt > 0 && other)} style={{ ...mm.moveBtn, opacity: amt > 0 && other ? 1 : 0.4, cursor: amt > 0 && other ? 'pointer' : 'default' }}>Move {fmt(amt)}</button>
        </div>
      </div>
    </div>
  );
}

// ── Category Inspector ─────────────────────────────────────

const TARGET_TYPES: { id: string; label: string }[] = [
  { id: 'none',    label: 'No target'       },
  { id: 'monthly', label: 'Monthly'          },
  { id: 'refill',  label: 'Refill up to'     },
  { id: 'savings', label: 'Savings by date'  },
];

interface InspectorProps {
  cat: string;
  color: string;
  c: CatState;
  months: string[];
  monthIdx: number;
  fmt: (n: number) => string;
  onClose: () => void;
  onSetTarget: (cat: string, t: Target | null) => void;
  onMoveMoney: (cat: string) => void;
  onHide: (cat: string) => void;
  onDelete: (cat: string) => void;
}

export function CategoryInspector({ cat, color, c, months, monthIdx, fmt, onClose, onSetTarget, onMoveMoney, onHide, onDelete }: InspectorProps) {
  const t = c.target;
  const [type, setType] = useState(t ? t.type : 'none');
  const [amount, setAmount] = useState<string | number>(t ? t.amount : '');
  const [by, setBy] = useState(t?.by ?? (months[months.length - 1] ?? ''));

  const save = () => {
    if (type === 'none') onSetTarget(cat, null);
    else onSetTarget(cat, { type: type as Target['type'], amount: Number(amount) || 0, ...(type === 'savings' ? { by } : {}) });
    onClose();
  };

  const futureMonths = months.slice(monthIdx);
  const fundedPct = c.fundedPct != null ? Math.round(c.fundedPct * 100) : null;

  const Stat = ({ label, value, color: col }: { label: string; value: string; color?: string }) => (
    <div style={insp.stat}><span style={insp.statLbl}>{label}</span><span style={{ ...insp.statVal, color: col ?? T.text }}>{value}</span></div>
  );

  return (
    <div style={insp.overlay} onClick={onClose}>
      <div style={insp.panel} onClick={e => e.stopPropagation()}>
        <div style={insp.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
            <span style={insp.title}>{cat}</span>
          </div>
          <button onClick={onClose} style={mm.close}>✕</button>
        </div>
        <div style={insp.availBlock}>
          <div style={insp.availLbl}>Available</div>
          <div style={{ ...insp.availAmt, color: c.available < 0 ? T.neg : T.pos }}>{fmt(c.available)}</div>
          {c.carryIn !== 0 && <div style={insp.carryNote}>incl. {fmt(c.carryIn)} rolled over</div>}
        </div>
        <div style={insp.statRow}>
          <Stat label="Assigned" value={fmt(c.assigned)} />
          <Stat label="Activity" value={fmt(c.activity)} color={T.textMid} />
          <Stat label="Underfunded" value={fmt(c.underfunded)} color={c.underfunded > 0 ? T.warn : T.textDim} />
        </div>
        <div style={insp.section}>
          <div style={insp.sectionTitle}>Target</div>
          {fundedPct != null && type !== 'none' && (
            <div style={{ marginBottom: 12 }}>
              <div style={insp.targetTrack}><div style={{ ...insp.targetFill, width: fundedPct + '%' }} /></div>
              <div style={insp.targetMeta}>
                <span>{fundedPct}% funded</span>
                {c.target && <span>{targetLabel(c.target, fmt)}</span>}
              </div>
            </div>
          )}
          <div style={insp.typeGrid}>
            {TARGET_TYPES.map(tt => (
              <button key={tt.id} onClick={() => setType(tt.id)} style={{ ...insp.typeBtn, ...(type === tt.id ? insp.typeOn : {}) }}>{tt.label}</button>
            ))}
          </div>
          {type !== 'none' && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={insp.fieldLbl}>{type === 'refill' ? 'Refill up to' : type === 'savings' ? 'Target balance' : 'Amount per month'}</div>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={insp.input} placeholder="0" />
              </div>
              {type === 'savings' && (
                <div>
                  <div style={insp.fieldLbl}>By month</div>
                  <select value={by} onChange={e => setBy(e.target.value)} style={insp.input}>
                    {futureMonths.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}
          <button onClick={save} style={insp.saveBtn}>Save target</button>
        </div>
        <div style={insp.actions}>
          <button onClick={() => { onMoveMoney(cat); onClose(); }} style={insp.actionBtn}>⇄ Move money</button>
          <button onClick={() => { onHide(cat); onClose(); }} style={insp.actionBtn}>Hide</button>
          <button onClick={() => { onDelete(cat); onClose(); }} style={{ ...insp.actionBtn, color: T.neg }}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// Shared state helper for parent (Budget) to know inspector state
export type { MonthState };

const mm = {
  overlay:    { position: 'fixed' as const, inset: 0, background: 'rgba(4,6,10,0.66)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  card:       { width: 400, maxWidth: 'calc(100vw - 40px)', background: T.surface2, border: `1px solid ${T.borderHi}`, borderRadius: T.radius, boxShadow: '0 32px 80px -20px rgba(0,0,0,0.85)', overflow: 'hidden' },
  header:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${T.border}` },
  title:      { fontSize: 15, fontWeight: 800, color: T.text, letterSpacing: '-0.02em' },
  close:      { background: 'none', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: 14, padding: 4 },
  body:       { padding: 20, display: 'flex', flexDirection: 'column' as const, gap: 16 },
  modeToggle: { display: 'flex', gap: 4, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 9, padding: 3 },
  modeBtn:    { flex: 1, padding: '7px 8px', fontSize: 12, fontWeight: 600, background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer', color: T.textDim, transition: 'all 0.12s', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  modeOn:     { background: T.accentDim, color: 'var(--accent)' },
  label:      { fontSize: 10.5, fontWeight: 700, color: T.textDim, marginBottom: 7, letterSpacing: '0.08em', textTransform: 'uppercase' as const },
  select:     { width: '100%', padding: '9px 11px', fontSize: 13.5, border: `1px solid ${T.border}`, borderRadius: 9, background: T.surface, color: T.text, cursor: 'pointer' },
  amountWrap: { display: 'flex', gap: 8, alignItems: 'center' },
  amountInput:{ flex: 1, padding: '9px 12px', fontSize: 16, fontFamily: T.mono, fontWeight: 600, border: `1px solid ${T.borderHi}`, borderRadius: 9, background: T.surface, color: T.text },
  coverBtn:   { padding: '8px 11px', fontSize: 11.5, fontWeight: 700, background: T.accentDim, color: 'var(--accent)', border: `1px solid var(--accent)`, borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' as const },
  preview:    { background: 'rgba(255,255,255,0.02)', border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: '12px 14px', display: 'flex', flexDirection: 'column' as const, gap: 4 },
  side:       { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sideName:   { fontSize: 13, fontWeight: 600, color: T.text },
  sideNums:   { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontFamily: T.mono },
  arrow:      { textAlign: 'center' as const, color: T.textFaint, fontSize: 13, lineHeight: 1, margin: '1px 0' },
  footer:     { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.015)' },
  cancelBtn:  { padding: '9px 16px', fontSize: 13, fontWeight: 600, background: T.surface, color: T.textMid, border: `1px solid ${T.border}`, borderRadius: 8, cursor: 'pointer' },
  moveBtn:    { padding: '9px 18px', fontSize: 13, fontWeight: 700, background: 'var(--accent)', color: '#06140d', border: 'none', borderRadius: 8, boxShadow: '0 0 18px var(--accent-glow)' },
};

const insp = {
  overlay:     { position: 'fixed' as const, inset: 0, background: 'rgba(4,6,10,0.5)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'flex-end', zIndex: 1000 },
  panel:       { width: 360, maxWidth: 'calc(100vw - 30px)', height: '100%', background: T.surface2, borderLeft: `1px solid ${T.borderHi}`, boxShadow: '-24px 0 60px -20px rgba(0,0,0,0.7)', overflowY: 'auto' as const },
  header:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: `1px solid ${T.border}`, position: 'sticky' as const, top: 0, background: T.surface2, zIndex: 2 },
  title:       { fontSize: 16, fontWeight: 800, color: T.text, letterSpacing: '-0.02em' },
  availBlock:  { padding: '20px', borderBottom: `1px solid ${T.border}` },
  availLbl:    { fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const },
  availAmt:    { fontSize: 30, fontWeight: 700, fontFamily: T.mono, letterSpacing: '-0.03em', marginTop: 4 },
  carryNote:   { fontSize: 11.5, color: T.textDim, marginTop: 4, fontStyle: 'italic' as const },
  statRow:     { display: 'flex', padding: '14px 20px', gap: 16, borderBottom: `1px solid ${T.border}` },
  stat:        { display: 'flex', flexDirection: 'column' as const, gap: 3 },
  statLbl:     { fontSize: 10.5, fontWeight: 600, color: T.textDim, letterSpacing: '0.04em' },
  statVal:     { fontSize: 14, fontWeight: 700, fontFamily: T.mono },
  section:     { padding: '18px 20px', borderBottom: `1px solid ${T.border}` },
  sectionTitle:{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: 12 },
  targetTrack: { height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' },
  targetFill:  { height: '100%', borderRadius: 4, background: 'var(--accent)', boxShadow: '0 0 10px var(--accent-glow)', transition: 'width 0.4s' },
  targetMeta:  { display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11.5, color: T.textDim, fontFamily: T.mono },
  typeGrid:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 },
  typeBtn:     { padding: '8px 10px', fontSize: 12, fontWeight: 600, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textMid, cursor: 'pointer', transition: 'all 0.12s' },
  typeOn:      { background: T.accentDim, borderColor: 'var(--accent)', color: 'var(--accent)' },
  fieldLbl:    { fontSize: 11, fontWeight: 600, color: T.textDim, marginBottom: 6 },
  input:       { width: '100%', padding: '9px 11px', fontSize: 14, fontFamily: T.mono, border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface, color: T.text },
  saveBtn:     { width: '100%', marginTop: 14, padding: '10px', fontSize: 13, fontWeight: 700, background: 'var(--accent)', color: '#06140d', border: 'none', borderRadius: 8, cursor: 'pointer', boxShadow: '0 0 18px var(--accent-glow)' },
  actions:     { padding: '16px 20px', display: 'flex', gap: 8, flexWrap: 'wrap' as const },
  actionBtn:   { flex: 1, padding: '9px 10px', fontSize: 12.5, fontWeight: 600, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textMid, cursor: 'pointer', whiteSpace: 'nowrap' as const },
};
