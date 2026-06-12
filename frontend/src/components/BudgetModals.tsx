import { useState } from 'react';
import { T } from '../theme';
import type { PlanCatState } from '../engine';

// ── Category Inspector ─────────────────────────────────────

type Flexibility = 'fixed' | 'flexible' | 'non_monthly';

const FLEX_OPTIONS: { id: Flexibility; label: string }[] = [
  { id: 'fixed',       label: 'Fixed'        },
  { id: 'flexible',    label: 'Flexible'     },
  { id: 'non_monthly', label: 'Non-monthly'  },
];

interface InspectorProps {
  cat: string;
  color: string;
  c: PlanCatState;
  fmt: (n: number) => string;
  onClose: () => void;
  onUpdateCategoryMeta: (catId: string, meta: { rollover: boolean; flexibility: Flexibility }) => void;
  onHide: (cat: string) => void;
  onDelete: (cat: string) => void;
}

function Stat({ label, value, color: col }: { label: string; value: string; color?: string }) {
  return (
    <div style={insp.stat}><span style={insp.statLbl}>{label}</span><span style={{ ...insp.statVal, color: col ?? T.text }}>{value}</span></div>
  );
}

export function CategoryInspector({ cat, color, c, fmt, onClose, onUpdateCategoryMeta, onHide, onDelete }: InspectorProps) {
  const [rollover, setRollover] = useState(c.rollover);
  const [flexibility, setFlexibility] = useState<Flexibility>(c.flexibility);

  const commitRollover = (next: boolean) => {
    setRollover(next);
    onUpdateCategoryMeta(c.id, { rollover: next, flexibility });
  };
  const commitFlexibility = (next: Flexibility) => {
    setFlexibility(next);
    onUpdateCategoryMeta(c.id, { rollover, flexibility: next });
  };

  const spent = -c.activity;
  const pct = c.planned > 0 ? Math.min((spent / c.planned) * 100, 100) : 0;

  return (
    <div style={insp.overlay} onClick={onClose}>
      <div style={insp.panel} onClick={e => e.stopPropagation()}>
        <div style={insp.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
            <span style={insp.title}>{cat}</span>
          </div>
          <button onClick={onClose} style={insp.close}>✕</button>
        </div>

        <div style={insp.availBlock}>
          <div style={insp.availLbl}>Remaining</div>
          <div style={{ ...insp.availAmt, color: c.remaining < 0 ? T.neg : T.pos }}>{fmt(c.remaining)}</div>
          {c.rollover && <div style={insp.carryNote}>rollover balance {fmt(c.rolloverBalance)}</div>}
        </div>

        <div style={insp.statRow}>
          <Stat label="Budgeted" value={fmt(c.planned)} />
          <Stat label="Actual" value={fmt(spent)} color={spent > 0 ? T.neg : T.textMid} />
          <Stat label="Remaining" value={fmt(c.remaining)} color={c.remaining < 0 ? T.neg : T.textMid} />
        </div>

        {c.planned > 0 && (
          <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}` }}>
            <div style={insp.targetTrack}><div style={{ ...insp.targetFill, width: pct + '%' }} /></div>
            <div style={insp.targetMeta}><span>{Math.round(pct)}% spent</span></div>
          </div>
        )}

        <div style={insp.section}>
          <div style={insp.sectionTitle}>Rollover</div>
          <label style={insp.toggleRow}>
            <input type="checkbox" checked={rollover} onChange={e => commitRollover(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 16, height: 16 }} />
            <span style={{ fontSize: 13, color: T.textMid, fontWeight: 600 }}>Carry remaining balance into next month</span>
          </label>
        </div>

        <div style={insp.section}>
          <div style={insp.sectionTitle}>Flexibility</div>
          <div style={insp.typeGrid3}>
            {FLEX_OPTIONS.map(f => (
              <button key={f.id} onClick={() => commitFlexibility(f.id)} style={{ ...insp.typeBtn, ...(flexibility === f.id ? insp.typeOn : {}) }}>{f.label}</button>
            ))}
          </div>
        </div>

        <div style={insp.actions}>
          <button onClick={() => { onHide(cat); onClose(); }} style={insp.actionBtn}>Hide</button>
          <button onClick={() => { onDelete(cat); onClose(); }} style={{ ...insp.actionBtn, color: T.neg }}>Delete</button>
        </div>
      </div>
    </div>
  );
}

const insp = {
  overlay:     { position: 'fixed' as const, inset: 0, background: 'rgba(4,6,10,0.5)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'flex-end', zIndex: 1000 },
  panel:       { width: 360, maxWidth: 'calc(100vw - 30px)', height: '100%', background: T.surface2, borderLeft: `1px solid ${T.borderHi}`, boxShadow: '-24px 0 60px -20px rgba(0,0,0,0.7)', overflowY: 'auto' as const },
  header:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: `1px solid ${T.border}`, position: 'sticky' as const, top: 0, background: T.surface2, zIndex: 2 },
  title:       { fontSize: 16, fontWeight: 800, color: T.text, letterSpacing: '-0.02em' },
  close:       { background: 'none', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: 14, padding: 4 },
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
  toggleRow:   { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' },
  targetTrack: { height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' },
  targetFill:  { height: '100%', borderRadius: 4, background: 'var(--accent)', boxShadow: '0 0 10px var(--accent-glow)', transition: 'width 0.4s' },
  targetMeta:  { display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11.5, color: T.textDim, fontFamily: T.mono },
  typeGrid3:   { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 },
  typeBtn:     { padding: '8px 8px', fontSize: 11.5, fontWeight: 600, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textMid, cursor: 'pointer', transition: 'all 0.12s' },
  typeOn:      { background: T.accentDim, borderColor: 'var(--accent)', color: 'var(--accent)' },
  actions:     { padding: '16px 20px', display: 'flex', gap: 8, flexWrap: 'wrap' as const },
  actionBtn:   { flex: 1, padding: '9px 10px', fontSize: 12.5, fontWeight: 600, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textMid, cursor: 'pointer', whiteSpace: 'nowrap' as const },
};
