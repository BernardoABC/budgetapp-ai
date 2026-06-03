import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { T, GROUP_COLORS } from '../theme';
import { compute, quickAssign as engineQuickAssign, targetLabel } from '../engine';
import { MoveMoneyModal, CategoryInspector } from './BudgetModals';
import type { CategoryGroup, Target } from '../data';
import type { CatState, MonthState } from '../engine';
import { fetchBudget, setAssigned as apiSetAssigned, copyPreviousBudget, moveBudgetMoney, upsertCategoryTarget, deleteCategoryTarget, createCategoryGroup, deleteCategoryGroup, createCategory, deleteCategory, updateCategory, fetchNearestRate } from '../api';
import type { ExchangeRate } from '../api';
import { useToast } from './Toast';

const FALLBACK_COLORS = ['#5b9dff', '#3ddc97', '#f6c45a', '#c084fc', '#ff7a85', '#38d6e8', '#fb923c', '#a78bfa'];

function toDisplayMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function prevYM(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
function nextYM(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
function futureMonthDisplays(fromYM: string, count = 24): string[] {
  const result: string[] = [];
  let cur = fromYM;
  for (let i = 0; i < count; i++) { result.push(toDisplayMonth(cur)); cur = nextYM(cur); }
  return result;
}

function colorFor(groupName: string, idx: number): string {
  return GROUP_COLORS[groupName] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

function InlineRename({ value, onCommit, style }: { value: string; onCommit: (v: string) => void; style?: React.CSSProperties }) {
  const [v, setV] = useState(value);
  return (
    <input value={v} onChange={e => setV(e.target.value)} onClick={e => e.stopPropagation()}
      onBlur={() => v.trim() && v !== value && onCommit(v.trim())}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value); (e.target as HTMLInputElement).blur(); } }}
      style={{ ...st.renameInput, ...style }} />
  );
}

function BudgetCell({ value, onSave, fmt }: { value: number; onSave: (v: number) => void; fmt: (n: number) => string }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [hovered, setHovered] = useState(false);
  const startEdit = () => { setInput(String(value)); setEditing(true); };
  const commit = () => { const num = parseFloat(input.replace(/[^0-9.-]/g, '')); if (!isNaN(num)) onSave(num); setEditing(false); };
  if (editing) {
    return <input autoFocus value={input} onChange={e => setInput(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }} style={st.cellInput} />;
  }
  return (
    <div onClick={startEdit} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ ...st.cellClickable, ...(hovered ? st.cellHovered : {}) }}>
      {fmt(value)}
      <span style={{ ...st.pencil, opacity: hovered ? 1 : 0 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M4 20h4L18.5 9.5a2 2 0 0 0-3-3L5 17v3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg>
      </span>
    </div>
  );
}

interface GroupBlockProps {
  group: CategoryGroup;
  gidx: number;
  color: string;
  catState: MonthState['cats'];
  collapsed: boolean;
  onToggle: () => void;
  fmt: (n: number) => string;
  onSaveAssigned: (cat: string, v: number) => void;
  onOpenMove: (cat: string) => void;
  onOpenInspector: (cat: string) => void;
  rowPad: string;
  editMode: boolean;
  hidden: Set<string>;
  showHidden: boolean;
  onRenameCat: (gid: string, old: string, nw: string) => void;
  onMoveCat: (gid: string, idx: number, dir: number) => void;
  onHideCat: (cat: string) => void;
  onDeleteCat: (gid: string, cat: string) => void;
  onAddCat: (gid: string, name: string) => void;
  onRenameGroup: (gid: string, name: string) => void;
  onMoveGroup: (idx: number, dir: number) => void;
  onDeleteGroup: (gid: string) => void;
}

function GroupBlock(props: GroupBlockProps) {
  const { group, gidx, color, catState, collapsed, onToggle, fmt, onSaveAssigned, onOpenMove, onOpenInspector,
    rowPad, editMode, hidden, showHidden, onRenameCat, onMoveCat, onHideCat, onDeleteCat, onAddCat, onRenameGroup, onMoveGroup, onDeleteGroup } = props;
  const [hovCat, setHovCat] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState('');

  const visibleCats = group.categories.filter(c => showHidden || !hidden.has(c));
  const totAssigned = group.categories.reduce((s, c) => s + (catState[c]?.assigned ?? 0), 0);
  const totActivity = group.categories.reduce((s, c) => s + (catState[c]?.activity ?? 0), 0);
  const totAvailable = group.categories.reduce((s, c) => s + (catState[c]?.available ?? 0), 0);

  const commitAdd = () => { if (newCat.trim()) { onAddCat(group.id, newCat.trim()); setNewCat(''); setAdding(false); } };

  return (
    <>
      <tr style={st.groupRow}>
        <td style={st.groupCell} onClick={editMode ? undefined : onToggle}>
          {!editMode && <span style={{ ...st.chevron, transform: collapsed ? 'rotate(-90deg)' : 'none' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>}
          <span style={{ width: 8, height: 8, borderRadius: 2.5, background: color, marginRight: 2 }} />
          {editMode ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              <InlineRename value={group.name} onCommit={v => onRenameGroup(group.id, v)} style={{ fontWeight: 700, fontSize: 13 }} />
              <span style={st.reorder}>
                <button onClick={() => onMoveGroup(gidx, -1)} style={st.iconBtn}>▲</button>
                <button onClick={() => onMoveGroup(gidx, 1)} style={st.iconBtn}>▼</button>
              </span>
              <button onClick={() => setAdding(true)} style={st.miniBtn}>+ Category</button>
              <button onClick={() => onDeleteGroup(group.id)} style={{ ...st.iconBtn, color: T.neg }}>✕</button>
            </span>
          ) : group.name}
        </td>
        <td style={st.groupNum}>{fmt(totAssigned)}</td>
        <td style={{ ...st.groupNum, color: T.textDim }}>{fmt(totActivity)}</td>
        <td style={{ ...st.groupNum, color: totAvailable < 0 ? T.neg : T.text }}>{fmt(totAvailable)}</td>
      </tr>

      {!collapsed && visibleCats.map(cat => {
        const c: CatState = catState[cat] ?? { cat, assigned: 0, activity: 0, carryIn: 0, available: 0, target: null, underfunded: 0, targetNeed: 0, fundedPct: null };
        const over = c.available < 0;
        const near = !over && c.assigned > 0 && c.available / c.assigned < 0.15;
        const spent = Math.abs(Math.min(c.activity, 0));
        const pct = c.assigned > 0 ? Math.min((spent / c.assigned) * 100, 100) : 0;
        const barColor = over ? T.neg : near ? T.warn : color;
        const rowBg = over ? T.negDim : hovCat === cat ? 'rgba(255,255,255,0.02)' : 'transparent';
        const tLabel = targetLabel(c.target, fmt);
        const isHidden = hidden.has(cat);
        const realIdx = group.categories.indexOf(cat);

        return (
          <React.Fragment key={cat}>
            <tr style={{ ...st.catRow, background: rowBg, opacity: isHidden ? 0.45 : 1 }}
              onMouseEnter={() => setHovCat(cat)} onMouseLeave={() => setHovCat(null)}>
              <td style={{ ...st.catCell, padding: rowPad + ' 16px 5px 40px', borderBottom: 'none' }}>
                {editMode ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <InlineRename value={cat} onCommit={v => onRenameCat(group.id, cat, v)} />
                    <span style={st.reorder}>
                      <button onClick={() => onMoveCat(group.id, realIdx, -1)} style={st.iconBtn}>▲</button>
                      <button onClick={() => onMoveCat(group.id, realIdx, 1)} style={st.iconBtn}>▼</button>
                    </span>
                    <button onClick={() => onHideCat(cat)} style={st.miniBtn}>{isHidden ? 'Unhide' : 'Hide'}</button>
                    <button onClick={() => onDeleteCat(group.id, cat)} style={{ ...st.iconBtn, color: T.neg }}>✕</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => onOpenInspector(cat)} style={{ ...st.catName, color: over ? T.neg : T.textMid }}>{cat}</button>
                    {tLabel && <span style={st.targetChip} title="Target">◎ {tLabel}</span>}
                    {c.underfunded > 0 && <span style={st.underBadge}>−{fmt(c.underfunded)}</span>}
                  </div>
                )}
              </td>
              <td style={{ ...st.numCell, padding: '0 16px', borderBottom: 'none' }}><BudgetCell value={c.assigned} onSave={v => onSaveAssigned(cat, v)} fmt={fmt} /></td>
              <td style={{ ...st.numCell, padding: rowPad + ' 16px 5px', borderBottom: 'none', color: c.activity < 0 ? T.textDim : T.pos }}>{fmt(c.activity)}</td>
              <td style={{ ...st.numCell, padding: rowPad + ' 16px 5px', borderBottom: 'none' }}>
                <button onClick={e => { e.stopPropagation(); onOpenMove(cat); }}
                  style={{ ...st.pillBtn, ...(over ? st.pillNeg : near ? st.pillWarn : st.pillPos) }}>
                  {hovCat === cat && <span style={{ opacity: 0.65, fontSize: 11 }}>⇄</span>}
                  {fmt(c.available)}
                </button>
              </td>
            </tr>
            <tr style={{ background: rowBg }} onMouseEnter={() => setHovCat(cat)} onMouseLeave={() => setHovCat(null)}>
              <td colSpan={4} style={{ padding: '0 16px ' + rowPad, borderBottom: `1px solid ${T.borderSoft}` }}>
                <div style={st.barRowWrap}>
                  <div style={st.barTrack}><div style={{ ...st.barFill, width: pct + '%', background: barColor, boxShadow: pct > 0 ? `0 0 8px ${barColor}66` : 'none' }} /></div>
                  <span style={st.barPct}>{c.assigned > 0 ? Math.round((spent / c.assigned) * 100) + '%' : '—'}</span>
                </div>
              </td>
            </tr>
          </React.Fragment>
        );
      })}

      {editMode && !collapsed && (
        <tr>
          <td colSpan={4} style={{ padding: '6px 16px 10px 40px', borderBottom: `1px solid ${T.borderSoft}` }}>
            {adding ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <input autoFocus value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="Category name"
                  onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') setAdding(false); }} style={st.renameInput} />
                <button onClick={commitAdd} style={st.miniBtnOn}>Add</button>
                <button onClick={() => setAdding(false)} style={st.miniBtn}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => setAdding(true)} style={st.addCatBtn}>+ Add category</button>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

interface Props {
  categoryGroups: CategoryGroup[];
  fmt: (n: number) => string;
  currency: string;
  density: string;
  categoryIdByName: Record<string, string>;
  onCategoriesChanged: () => void;
}

export function Budget({ categoryGroups, fmt, currency, density, categoryIdByName, onCategoriesChanged }: Props) {
  const [currentYM, setCurrentYM] = useState(() => new Date().toISOString().slice(0, 7));
  const currentDisplayMonth = toDisplayMonth(currentYM);
  const [localBudget, setLocalBudget] = useState<Record<string, Record<string, { assigned: number; activity: number }>>>({});
  const [targets, setTargets] = useState<Record<string, Target>>({});
  const [carryIn, setCarryIn] = useState<Record<string, number>>({});
  const serverRtaRef = useRef<number>(0);
  const serverAssignedTotalRef = useRef<number>(0);
  const [aom, setAom] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const toast = useToast();
  const [fetchCounter, setFetchCounter] = useState(0);
  const [monthRate, setMonthRate] = useState<ExchangeRate | null>(null);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [groups, setGroups] = useState(() => categoryGroups.map(g => ({ ...g, categories: [...g.categories] })));
  const [hidden, setHidden] = useState(new Set<string>());
  const [showHidden, setShowHidden] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [moveCat, setMoveCat] = useState<string | null>(null);
  const [inspectorCat, setInspectorCat] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const nameById: Record<string, string> = Object.fromEntries(
      Object.entries(categoryIdByName).map(([name, id]) => [id, name])
    );
    fetchBudget(currentYM).then(data => {
      const newCarryIn: Record<string, number> = {};
      const newBudgetMonth: Record<string, { assigned: number; activity: number }> = {};
      const newTargets: Record<string, Target> = {};

      for (const g of data.category_groups) {
        for (const c of g.categories) {
          const name = nameById[c.id] ?? c.name;
          newCarryIn[name] = c.carry_in;
          newBudgetMonth[name] = { assigned: c.assigned, activity: c.activity };
          if (c.target) {
            let by: string | undefined;
            if (c.target.deadline) {
              const [y, m] = c.target.deadline.split('-').map(Number);
              by = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            }
            newTargets[name] = { type: c.target.type as Target['type'], amount: c.target.amount, ...(by ? { by } : {}) };
          }
        }
      }

      setCarryIn(newCarryIn);
      serverRtaRef.current = data.ready_to_assign;
      serverAssignedTotalRef.current = Object.values(newBudgetMonth).reduce((s, e) => s + e.assigned, 0);
      setAom(data.age_of_money);
      setLocalBudget({ [currentDisplayMonth]: newBudgetMonth });
      setTargets(newTargets);
      setBudgetError(null);
    }).catch(err => {
      setBudgetError(err.message);
    }).finally(() => setLoading(false));
  }, [currentYM, categoryIdByName, fetchCounter]);

  useEffect(() => {
    let cancelled = false;
    fetchNearestRate(`${currentYM}-01`)
      .then(rate => { if (!cancelled) setMonthRate(rate); })
      .catch(() => { if (!cancelled) setMonthRate(null); });
    return () => { cancelled = true; };
  }, [currentYM]);

  const month = currentDisplayMonth;
  const rowPad = density === 'compact' ? '6px' : '11px';
  const fmtMonth = useMemo<(n: number) => string>(() => {
    if (currency !== 'USD' || monthRate === null) return fmt;
    const rate = monthRate.usd_to_crc;
    return (amount: number) => {
      const usd = amount / rate;
      return (amount < 0 ? '-' : '') + '$' + Math.abs(usd).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    };
  }, [currency, monthRate, fmt]);

  const dataT = useMemo(() => ({
    months: [currentDisplayMonth],
    budget: {},
    openingCarryover: carryIn,
    targets,
    categoryGroups: groups,
  }), [currentDisplayMonth, carryIn, targets, groups]);

  const state = useMemo(
    () => compute(dataT, localBudget, currentDisplayMonth, groups),
    [dataT, localBudget, currentDisplayMonth, groups]
  );

  const rta = useMemo(() => {
    const localTotal = Object.values(state.cats).reduce((s, c) => s + c.assigned, 0);
    return serverRtaRef.current - (localTotal - serverAssignedTotalRef.current);
  }, [state.cats]);

  const handleSaveAssigned = useCallback((cat: string, value: number) => {
    setLocalBudget(prev => ({
      ...prev,
      [currentDisplayMonth]: {
        ...prev[currentDisplayMonth],
        [cat]: { ...(prev[currentDisplayMonth]?.[cat] ?? {}), assigned: value },
      },
    }));
    const catId = categoryIdByName[cat];
    if (catId) {
      apiSetAssigned(currentYM, catId, value).catch(err => toast.error(err.message));
    }
  }, [currentDisplayMonth, currentYM, categoryIdByName]);

  const mergeAssigned = (updates: Record<string, number>) => {
    setLocalBudget(prev => {
      const m = { ...(prev[currentDisplayMonth] ?? {}) };
      Object.entries(updates).forEach(([cat, val]) => { m[cat] = { ...(m[cat] ?? {}), assigned: val }; });
      return { ...prev, [currentDisplayMonth]: m };
    });
  };

  const doQuickAssign = (strategy: 'underfunded' | 'reset' | 'lastMonth') => {
    if (strategy === 'lastMonth') {
      copyPreviousBudget(currentYM)
        .then(() => setFetchCounter(c => c + 1))
        .catch(err => toast.error(err.message));
      return;
    }
    mergeAssigned(engineQuickAssign(strategy, dataT, state, null));
  };

  const handleMove = useCallback((fromCat: string, toCat: string, amount: number) => {
    setLocalBudget(prev => {
      const m = { ...(prev[currentDisplayMonth] ?? {}) };
      m[fromCat] = { ...(m[fromCat] ?? {}), assigned: ((m[fromCat] ?? {}).assigned ?? 0) - amount };
      m[toCat]   = { ...(m[toCat]   ?? {}), assigned: ((m[toCat]   ?? {}).assigned ?? 0) + amount };
      return { ...prev, [currentDisplayMonth]: m };
    });
    const fromId = categoryIdByName[fromCat];
    const toId   = categoryIdByName[toCat];
    if (fromId && toId) {
      moveBudgetMoney(currentYM, fromId, toId, amount).catch(err => {
        toast.error(err.message);
        setLocalBudget(prev => {
          const m = { ...(prev[currentDisplayMonth] ?? {}) };
          m[fromCat] = { ...(m[fromCat] ?? {}), assigned: ((m[fromCat] ?? {}).assigned ?? 0) + amount };
          m[toCat]   = { ...(m[toCat]   ?? {}), assigned: ((m[toCat]   ?? {}).assigned ?? 0) - amount };
          return { ...prev, [currentDisplayMonth]: m };
        });
      });
    }
  }, [currentDisplayMonth, currentYM, categoryIdByName]);

  const toggleGroup = (gid: string) => setCollapsed(c => ({ ...c, [gid]: !c[gid] }));

  const renameCat = (gid: string, oldName: string, newName: string) => {
    setGroups(gs => gs.map(g =>
      g.id === gid
        ? { ...g, categories: g.categories.map(c => c === oldName ? newName : c) }
        : g
    ));
    const catId = categoryIdByName[oldName];
    if (catId) {
      const grp = groups.find(g => g.id === gid);
      const sortOrder = grp ? grp.categories.indexOf(oldName) : 0;
      updateCategory(catId, { name: newName, hidden: false, sort_order: sortOrder })
        .then(() => onCategoriesChanged())
        .catch(err => toast.error(err.message));
    }
  };
  const reorderCat = (gid: string, idx: number, dir: number) => setGroups(gs => gs.map(g => {
    if (g.id !== gid) return g;
    const arr = [...g.categories]; const j = idx + dir;
    if (j < 0 || j >= arr.length) return g;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    return { ...g, categories: arr };
  }));
  const hideCat = (name: string) => setHidden(h => { const n = new Set(h); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const deleteCat = (gid: string, name: string) => {
    const catId = categoryIdByName[name];
    setGroups(gs => gs.map(g => g.id === gid ? { ...g, categories: g.categories.filter(c => c !== name) } : g));
    if (catId) {
      deleteCategory(catId)
        .then(() => onCategoriesChanged())
        .catch(err => {
          toast.error(err.message);
          onCategoriesChanged();
        });
    }
  };
  const addCat = (gid: string, name: string) => {
    setGroups(gs => gs.map(g => g.id === gid ? { ...g, categories: [...g.categories, name] } : g));
    createCategory({ group_id: gid, name, sort_order: 0 })
      .then(() => onCategoriesChanged())
      .catch(err => {
        toast.error(err.message);
        setGroups(gs => gs.map(g => g.id === gid ? { ...g, categories: g.categories.filter(c => c !== name) } : g));
      });
  };
  const renameGroup = (gid: string, name: string) => setGroups(gs => gs.map(g => g.id === gid ? { ...g, name } : g));
  const moveGroup = (idx: number, dir: number) => setGroups(gs => { const arr = [...gs]; const j = idx + dir; if (j < 0 || j >= arr.length) return gs; [arr[idx], arr[j]] = [arr[j], arr[idx]]; return arr; });
  const deleteGroup = (gid: string) => {
    setGroups(gs => gs.filter(g => g.id !== gid));
    deleteCategoryGroup(gid)
      .then(() => onCategoriesChanged())
      .catch(err => {
        toast.error(err.message);
        onCategoriesChanged();
      });
  };
  const addGroup = () => {
    createCategoryGroup({ name: 'New Group', sort_order: groups.length })
      .then(g => {
        setGroups(gs => [...gs, { id: g.id, name: g.name, categories: [] }]);
        onCategoriesChanged();
      })
      .catch(err => toast.error(err.message));
  };
  const setTarget = (cat: string, target: Target | null) => {
    setTargets(t => { const nt = { ...t }; if (target) nt[cat] = target; else delete nt[cat]; return nt; });
    const catId = categoryIdByName[cat];
    if (!catId) return;
    if (target === null) {
      deleteCategoryTarget(catId).catch(err => toast.error(err.message));
    } else {
      let deadline: string | null = null;
      if (target.type === 'savings' && target.by) {
        const d = new Date(target.by + ' 1');
        if (!isNaN(d.getTime())) {
          deadline = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
        }
      }
      upsertCategoryTarget(catId, { type: target.type, amount: target.amount, deadline })
        .catch(err => toast.error(err.message));
    }
  };

  const futureMonths = useMemo(() => futureMonthDisplays(currentYM), [currentYM]);

  const allCats = groups.flatMap((g, gi) => g.categories.map(cat => ({
    color: colorFor(g.name, gi),
    ...(state.cats[cat] ?? { cat, assigned: 0, activity: 0, carryIn: 0, available: 0, target: null, underfunded: 0, targetNeed: 0, fundedPct: null })
  })));

  return (
    <div>
      {budgetError && (
        <div style={{ margin: '12px 16px 0', padding: '12px 16px', background: 'rgba(255,80,80,0.08)', border: `1px solid rgba(255,80,80,0.2)`, borderRadius: 8, color: T.neg, fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1 }}>Failed to load budget: {budgetError}</span>
          <button onClick={() => setFetchCounter(c => c + 1)} style={{ background: 'none', border: 'none', color: T.neg, cursor: 'pointer', fontWeight: 700, fontSize: 13, textDecoration: 'underline' }}>Retry</button>
        </div>
      )}
      <div style={st.topBar}>
        <div style={st.monthNav}>
          <button onClick={() => setCurrentYM(ym => prevYM(ym))} style={st.monthBtn}>‹</button>
          <div style={st.monthCenter}>
            <span style={st.curMonth}>{month}</span>
            {currency === 'USD' && monthRate !== null && monthRate.date !== new Date().toISOString().slice(0, 10) && (
              <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 2, fontFamily: T.mono }}>
                Rate: ₡{Math.round(monthRate.usd_to_crc).toLocaleString('en-US')} ({new Date(monthRate.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})
              </div>
            )}
          </div>
          <button onClick={() => setCurrentYM(ym => nextYM(ym))} style={st.monthBtn}>›</button>
        </div>

        <div style={st.rtaCard}>
          <div style={{ flex: 1 }}>
            <div style={st.rtaLabel}>Ready to Assign</div>
            <div style={{ ...st.rtaAmount, color: rta < 0 ? T.neg : rta === 0 ? T.textMid : 'var(--accent)' }}>{fmt(rta)}</div>
          </div>
          <div style={st.rtaDivider} />
          <div>
            <div style={st.rtaLabel}>Underfunded</div>
            <div style={{ ...st.rtaSub, color: state.totalUnderfunded > 0 ? T.warn : T.textDim }}>{fmt(state.totalUnderfunded)}</div>
          </div>
          <div style={st.rtaDivider} />
          <div>
            <div style={st.rtaLabel}>Age of Money</div>
            <div style={st.rtaSub}>
              {aom != null ? <>{aom} <span style={{ fontSize: 11, color: T.textDim }}>days</span></> : <span style={{ color: T.textDim }}>—</span>}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button onClick={() => doQuickAssign('underfunded')} disabled={state.totalUnderfunded <= 0}
            style={{ ...st.primaryBtn, opacity: state.totalUnderfunded > 0 ? 1 : 0.45 }}>
            Auto-assign {state.totalUnderfunded > 0 ? fmt(state.totalUnderfunded) : ''}
          </button>
          <button onClick={() => doQuickAssign('lastMonth')} style={st.actionBtn}>Last month</button>
          <button onClick={() => doQuickAssign('reset')} style={{ ...st.actionBtn, color: T.neg, borderColor: T.negDim }}>Reset</button>
          <button onClick={() => setEditMode(e => !e)} style={{ ...st.actionBtn, ...(editMode ? st.actionOn : {}) }}>{editMode ? 'Done' : 'Edit'}</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' as const, color: T.textDim }}>Loading budget…</div>
      ) : (
        <div style={{ padding: '20px 28px', maxWidth: 1180, margin: '0 auto' }}>
          {editMode && (
            <div style={st.editBar}>
              <span style={{ fontSize: 12.5, color: T.textMid, fontWeight: 600 }}>Editing categories — rename, reorder, hide or delete.</span>
              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                <label style={st.checkLabel}><input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} style={{ accentColor: 'var(--accent)' }} /> Show hidden</label>
                <button onClick={addGroup} style={st.miniBtnOn}>+ Add group</button>
              </div>
            </div>
          )}
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={{ ...st.th, textAlign: 'left', width: '46%' }}>Category</th>
                  <th style={{ ...st.th, textAlign: 'right' }}>Assigned</th>
                  <th style={{ ...st.th, textAlign: 'right' }}>Activity</th>
                  <th style={{ ...st.th, textAlign: 'right' }}>Available</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, gi) => (
                  <GroupBlock key={g.id} group={g} gidx={gi} color={colorFor(g.name, gi)} catState={state.cats}
                    collapsed={!!collapsed[g.id]} onToggle={() => toggleGroup(g.id)} fmt={fmtMonth} onSaveAssigned={handleSaveAssigned}
                    onOpenMove={setMoveCat} onOpenInspector={setInspectorCat} rowPad={rowPad} editMode={editMode} hidden={hidden} showHidden={showHidden}
                    onRenameCat={renameCat} onMoveCat={reorderCat} onHideCat={hideCat} onDeleteCat={deleteCat} onAddCat={addCat}
                    onRenameGroup={renameGroup} onMoveGroup={moveGroup} onDeleteGroup={deleteGroup} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {moveCat && (
        <MoveMoneyModal cat={moveCat} cats={allCats} fmt={fmtMonth} onClose={() => setMoveCat(null)} onMove={handleMove} />
      )}
      {inspectorCat && state.cats[inspectorCat] && (() => {
        const grpName = (groups.find(g => g.categories.includes(inspectorCat)) ?? {}).name ?? '';
        const grpIdx = groups.findIndex(g => g.categories.includes(inspectorCat));
        return (
          <CategoryInspector cat={inspectorCat} color={colorFor(grpName, grpIdx)} c={state.cats[inspectorCat]}
            months={futureMonths} monthIdx={0} fmt={fmtMonth} onClose={() => setInspectorCat(null)}
            onSetTarget={setTarget} onMoveMoney={cat => setMoveCat(cat)} onHide={hideCat}
            onDelete={cat => { const g = groups.find(x => x.categories.includes(cat)); if (g) deleteCat(g.id, cat); }} />
        );
      })()}
    </div>
  );
}

const st = {
  topBar:      { display: 'flex', alignItems: 'center', gap: 16, padding: '14px 28px', background: 'rgba(255,255,255,0.015)', borderBottom: `1px solid ${T.border}`, flexWrap: 'wrap' as const },
  monthNav:    { display: 'flex', alignItems: 'center', gap: 6 },
  monthBtn:    { width: 32, height: 32, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 18, color: T.textMid, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.12s' },
  monthCenter: { minWidth: 130, textAlign: 'center' as const },
  curMonth:    { fontSize: 16, fontWeight: 700, color: T.text, letterSpacing: '-0.02em' },
  rtaCard:     { flex: 1, display: 'flex', alignItems: 'center', gap: 18, background: `linear-gradient(135deg, ${T.accentDim}, transparent)`, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: '9px 22px', minWidth: 360, maxWidth: 520 },
  rtaDivider:  { width: 1, height: 34, background: T.border },
  rtaLabel:    { fontSize: 10, fontWeight: 700, color: T.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: 3 },
  rtaAmount:   { fontSize: 22, fontWeight: 700, fontFamily: T.mono, letterSpacing: '-0.02em', lineHeight: 1 },
  rtaSub:      { fontSize: 15, fontWeight: 700, fontFamily: T.mono, color: T.text, lineHeight: 1 },
  primaryBtn:  { padding: '8px 14px', fontSize: 12.5, fontWeight: 700, background: 'var(--accent)', color: '#06140d', border: 'none', borderRadius: 8, cursor: 'pointer', boxShadow: '0 0 16px var(--accent-glow)' },
  actionBtn:   { padding: '8px 13px', fontSize: 12.5, fontWeight: 600, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, cursor: 'pointer', color: T.textMid, transition: 'all 0.12s' },
  actionOn:    { background: T.accentDim, borderColor: 'var(--accent)', color: 'var(--accent)' },
  editBar:     { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', marginBottom: 12, background: T.accentDim, border: `1px solid ${T.borderHi}`, borderRadius: T.radiusSm },
  checkLabel:  { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.textMid, fontWeight: 600, cursor: 'pointer' },
  tableWrap:   { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: 'hidden', boxShadow: T.shadow },
  table:       { width: '100%', borderCollapse: 'collapse' as const },
  th:          { padding: '12px 16px', fontSize: 10.5, fontWeight: 700, color: T.textDim, letterSpacing: '0.09em', textTransform: 'uppercase' as const, borderBottom: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.015)' },
  groupRow:    { background: 'rgba(255,255,255,0.025)', userSelect: 'none' as const },
  groupCell:   { padding: '11px 16px', fontSize: 13, fontWeight: 700, color: T.text, borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' },
  groupNum:    { padding: '11px 16px', fontSize: 12.5, fontWeight: 600, textAlign: 'right' as const, fontFamily: T.mono, color: T.text, borderBottom: `1px solid ${T.border}` },
  chevron:     { display: 'flex', color: T.textDim, transition: 'transform 0.15s' },
  catRow:      { transition: 'background 0.1s' },
  catCell:     { fontSize: 13, fontWeight: 500, borderBottom: `1px solid ${T.borderSoft}`, verticalAlign: 'middle' as const },
  catName:     { background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: T.sans, textAlign: 'left' as const },
  targetChip:  { fontSize: 10.5, fontWeight: 600, color: T.textDim, fontFamily: T.mono, background: 'rgba(255,255,255,0.04)', padding: '1px 7px', borderRadius: 5 },
  underBadge:  { fontSize: 10.5, fontWeight: 700, color: T.warn, fontFamily: T.mono, background: T.warnDim, padding: '1px 7px', borderRadius: 5 },
  barRowWrap:  { display: 'flex', alignItems: 'center', gap: 10 },
  barTrack:    { flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' },
  barFill:     { height: '100%', borderRadius: 3, transition: 'width 0.5s cubic-bezier(0.22,1,0.36,1)' },
  barPct:      { fontSize: 11, fontFamily: T.mono, color: T.textDim, fontWeight: 500, flexShrink: 0, width: 36, textAlign: 'right' as const },
  numCell:     { fontSize: 12.5, textAlign: 'right' as const, fontFamily: T.mono, borderBottom: `1px solid ${T.borderSoft}`, color: T.textMid },
  cellClickable:{ display: 'inline-flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, cursor: 'text', padding: '4px 8px', borderRadius: 6, transition: 'background 0.1s', minWidth: 90, marginLeft: 'auto', color: T.text },
  cellHovered: { background: T.accentDim, boxShadow: `inset 0 0 0 1px ${T.borderHi}` },
  pencil:      { color: 'var(--accent)', display: 'flex', transition: 'opacity 0.1s' },
  cellInput:   { width: 96, textAlign: 'right' as const, border: `1px solid var(--accent)`, borderRadius: 6, padding: '4px 8px', fontSize: 12.5, fontFamily: T.mono, background: T.surface2, color: T.text, boxShadow: '0 0 0 3px var(--accent-dim)' },
  pillBtn:     { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 11px', borderRadius: 20, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: T.mono, transition: 'filter 0.12s, box-shadow 0.12s' },
  pillPos:     { background: 'rgba(255,255,255,0.05)', color: T.textMid },
  pillNeg:     { background: T.negDim, color: T.neg },
  pillWarn:    { background: T.warnDim, color: T.warn },
  renameInput: { padding: '4px 8px', fontSize: 13, border: `1px solid var(--accent)`, borderRadius: 6, background: T.surface2, color: T.text, fontFamily: T.sans, width: 150 },
  reorder:     { display: 'inline-flex', flexDirection: 'column' as const, gap: 1 },
  iconBtn:     { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, color: T.textDim, cursor: 'pointer', fontSize: 8, lineHeight: 1, padding: '2px 4px' },
  miniBtn:     { padding: '3px 9px', fontSize: 11, fontWeight: 600, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, color: T.textMid, cursor: 'pointer' },
  miniBtnOn:   { padding: '3px 9px', fontSize: 11, fontWeight: 700, background: 'var(--accent)', color: '#06140d', border: 'none', borderRadius: 6, cursor: 'pointer' },
  addCatBtn:   { background: 'none', border: `1px dashed ${T.border}`, borderRadius: 7, color: T.textDim, cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '6px 12px' },
};
