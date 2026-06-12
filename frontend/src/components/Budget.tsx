import React, { useState, useCallback, useMemo, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { T, GROUP_COLORS } from '../theme';
import { computePlan, resetAllPlanned } from '../engine';
import { CategoryInspector } from './BudgetModals';
import { BudgetSummaryPane } from './BudgetSummaryPane';
import type { SummaryStats } from './BudgetSummaryPane';
import type { CategoryGroup, PlanMonthAPI } from '../api';
import type { PlanState, PlanCatState } from '../engine';
import {
  fetchPlan, setPlanned as apiSetPlanned, copyPreviousPlan, setExpectedIncome as apiSetIncome,
  setFlexBudget as apiSetFlexBudget, fetchBudgetMode, setBudgetMode as apiSetBudgetMode,
  createCategoryGroup, deleteCategoryGroup, createCategory, deleteCategory, updateCategory, fetchNearestRate,
} from '../api';
import type { ExchangeRate } from '../api';
import { useToast } from './Toast';
import { useUndoStack } from '../hooks/useUndoStack';

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

interface BudgetCellHandle { startEdit: () => void; }

const BudgetCell = forwardRef<BudgetCellHandle, { value: number; onSave: (v: number) => void; fmt: (n: number) => string; toDisplay?: (raw: number) => number; toRaw?: (display: number) => number }>(
  ({ value, onSave, fmt, toDisplay, toRaw }, ref) => {
    const [editing, setEditing] = useState(false);
    const [input, setInput] = useState('');
    const [hovered, setHovered] = useState(false);
    const startEdit = () => { const displayVal = toDisplay ? +(toDisplay(value).toFixed(2)) : value; setInput(String(displayVal)); setEditing(true); setHovered(false); };
    useImperativeHandle(ref, () => ({ startEdit }));
    const commit = () => {
      const sanitized = input.replace(/[^0-9+\-*/.() ]/g, '');
      let num: number | null = null;
      if (sanitized.trim()) {
        try {
          // eslint-disable-next-line no-new-func
          const result = new Function('return ' + sanitized)() as number;
          if (typeof result === 'number' && isFinite(result)) num = result;
        } catch { /* invalid expression */ }
        if (num === null) {
          const fallback = parseFloat(sanitized.replace(/[^0-9.-]/g, ''));
          if (!isNaN(fallback)) num = fallback;
        }
      }
      if (num !== null) onSave(toRaw ? toRaw(num) : num);
      setEditing(false);
    };
    if (editing) {
      return <input autoFocus value={input} onChange={e => setInput(e.target.value)} onBlur={commit}
        onFocus={e => e.target.select()}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }} style={st.cellInput} />;
    }
    return (
      <div onClick={e => { e.stopPropagation(); startEdit(); }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        style={{ ...st.cellClickable, ...(hovered ? st.cellHovered : {}) }}>
        {fmt(value)}
        <span style={{ ...st.pencil, opacity: hovered ? 1 : 0 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M4 20h4L18.5 9.5a2 2 0 0 0-3-3L5 17v3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg>
        </span>
      </div>
    );
  }
);

function HeaderStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={st.headerStat}>
      <div style={st.headerStatLabel}>{label}</div>
      <div style={st.headerStatValue}>{children}</div>
    </div>
  );
}

interface GroupBlockProps {
  group: CategoryGroup;
  gidx: number;
  color: string;
  catState: PlanState['cats'];
  collapsed: boolean;
  onToggle: () => void;
  fmt: (n: number) => string;
  onSavePlanned: (cat: string, v: number) => void;
  onOpenInspector: (cat: string) => void;
  inspectorCat: string | null;
  rowPad: string;
  editMode: boolean;
  hidden: Set<string>;
  showHidden: boolean;
  onRenameCat: (gid: string, old: string, nw: string) => void;
  onMoveCat: (gid: string, idx: number, dir: number) => void;
  onHideCat: (cat: string) => void;
  onDeleteCat: (gid: string, cat: string) => void;
  onAddCat: (gid: string, name: string, currency: 'CRC' | 'USD') => void;
  onRenameGroup: (gid: string, name: string) => void;
  catCurrencies: Record<string, string>;
  onMoveGroup: (idx: number, dir: number) => void;
  onDeleteGroup: (gid: string) => void;
  onReorderCat: (gid: string, fromIdx: number, toIdx: number) => void;
  toDisplay?: (raw: number) => number;
  toRaw?: (display: number) => number;
  selectedCats: Set<string>;
  onToggleCatSelection: (name: string) => void;
  onToggleGroupSelection: (catNames: string[]) => void;
}

function GroupBlock(props: GroupBlockProps) {
  const { group, gidx, color, catState, collapsed, onToggle, fmt, onSavePlanned, onOpenInspector,
    inspectorCat, rowPad, editMode, hidden, showHidden, onRenameCat, onMoveCat, onHideCat, onDeleteCat, onAddCat, onRenameGroup,
    onMoveGroup, onDeleteGroup, onReorderCat, catCurrencies, toDisplay, toRaw,
    selectedCats, onToggleCatSelection, onToggleGroupSelection } = props;
  const [hovCat, setHovCat] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [newCatCurrency, setNewCatCurrency] = useState<'CRC' | 'USD'>('CRC');
  const [renamingCat, setRenamingCat] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const cellRefs = useRef<Record<string, BudgetCellHandle | null>>({});
  const [dragCat, setDragCat] = useState<string | null>(null);
  const [dragOverCat, setDragOverCat] = useState<string | null>(null);
  const dragHappened = useRef(false);
  const visibleCats = group.categories.filter(c => showHidden || !hidden.has(c));
  const groupCheckRef = useRef<HTMLInputElement>(null);
  const groupCheckedCount = visibleCats.filter(c => selectedCats.has(c)).length;
  const groupChecked = groupCheckedCount === visibleCats.length && visibleCats.length > 0;
  const groupIndeterminate = groupCheckedCount > 0 && !groupChecked;

  useEffect(() => {
    if (groupCheckRef.current) groupCheckRef.current.indeterminate = groupIndeterminate;
  }, [groupIndeterminate]);

  useEffect(() => {
    setRenamingCat(null);
  }, [inspectorCat]);

  const totPlanned = group.categories.reduce((s, c) => s + (catState[c]?.planned ?? 0), 0);
  const totActivity = group.categories.reduce((s, c) => s + (catState[c]?.activity ?? 0), 0);
  const totRemaining = group.categories.reduce((s, c) => s + (catState[c]?.remaining ?? 0), 0);

  const commitAdd = () => { if (newCat.trim()) { onAddCat(group.id, newCat.trim(), newCatCurrency); setNewCat(''); setNewCatCurrency('CRC'); setAdding(false); } };

  return (
    <>
      <tr style={st.groupRow}>
        <td style={st.checkCell}>
          <input
            ref={groupCheckRef}
            type="checkbox"
            checked={groupChecked}
            onChange={() => onToggleGroupSelection(visibleCats)}
            onClick={e => e.stopPropagation()}
            style={st.check}
          />
        </td>
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
        <td style={st.groupNum}>{fmt(totPlanned)}</td>
        <td style={{ ...st.groupNum, color: T.textDim }}>{fmt(-totActivity)}</td>
        <td style={{ ...st.groupNum, color: totRemaining < 0 ? T.neg : T.text }}>{fmt(totRemaining)}</td>
      </tr>

      {!collapsed && visibleCats.map(cat => {
        const c: PlanCatState = catState[cat] ?? { cat, id: '', currency: 'CRC', flexibility: 'flexible', rollover: false, planned: 0, activity: 0, remaining: 0, rolloverBalance: 0 };
        const over = c.remaining < 0;
        const spent = Math.abs(Math.min(c.activity, 0));
        const pct = c.planned > 0 ? Math.min((spent / c.planned) * 100, 100) : 0;
        const near = !over && c.planned > 0 && pct > 85;
        const barColor = over ? T.neg : near ? T.warn : color;
        const rowBg = over ? T.negDim : hovCat === cat ? 'rgba(255,255,255,0.02)' : 'transparent';
        const isHidden = hidden.has(cat);
        const realIdx = group.categories.indexOf(cat);

        const isDragOver = dragOverCat === cat && dragCat !== cat;
        const dragRowStyle: React.CSSProperties = isDragOver
          ? { boxShadow: `inset 0 2px 0 var(--accent)` }
          : dragCat === cat ? { opacity: 0.4 } : {};

        const dragHandlers = editMode ? {} : {
          draggable: true as const,
          onDragStart: (e: React.DragEvent) => { dragHappened.current = false; setDragCat(cat); e.dataTransfer.effectAllowed = 'move'; },
          onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCat(cat); },
          onDragLeave: () => setDragOverCat(null),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            if (dragCat && dragCat !== cat) {
              dragHappened.current = true;
              const fromIdx = group.categories.indexOf(dragCat);
              const toIdx = group.categories.indexOf(cat);
              if (fromIdx !== -1 && toIdx !== -1) onReorderCat(group.id, fromIdx, toIdx);
            }
            setDragCat(null); setDragOverCat(null);
          },
          onDragEnd: () => { setDragCat(null); setDragOverCat(null); },
        };

        return (
          <React.Fragment key={cat}>
            <tr style={{ ...st.catRow, background: rowBg, opacity: isHidden ? 0.45 : 1, cursor: editMode ? 'default' : 'text', ...dragRowStyle }}
              onMouseEnter={() => setHovCat(cat)} onMouseLeave={() => setHovCat(null)}
              onClick={editMode ? undefined : () => { if (dragHappened.current) { dragHappened.current = false; return; } cellRefs.current[cat]?.startEdit(); }}
              {...dragHandlers}>
              <td style={{ ...st.checkCell, padding: rowPad + ' 0 5px 8px', borderBottom: 'none', verticalAlign: 'middle' }}>
                <input
                  type="checkbox"
                  checked={selectedCats.has(cat)}
                  onChange={() => onToggleCatSelection(cat)}
                  onClick={e => e.stopPropagation()}
                  style={st.check}
                />
              </td>
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
                    <span style={{ ...st.dragHandle, opacity: hovCat === cat ? 0.35 : 0 }}>⠿</span>
                    {renamingCat === cat ? (
                      <input
                        autoFocus
                        value={renameVal}
                        onChange={e => setRenameVal(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        onBlur={() => {
                          const trimmed = renameVal.trim();
                          if (trimmed && trimmed !== cat) onRenameCat(group.id, cat, trimmed);
                          setRenamingCat(null);
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') { setRenameVal(cat); setRenamingCat(null); }
                        }}
                        style={st.renameInput}
                      />
                    ) : (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          if (inspectorCat === cat) {
                            setRenamingCat(cat);
                            setRenameVal(cat);
                          } else {
                            onOpenInspector(cat);
                          }
                        }}
                        style={{ ...st.catName, color: over ? T.neg : inspectorCat === cat ? T.text : T.textMid }}
                      >
                        {cat}
                      </button>
                    )}
                    {c.rollover && <span style={st.rolloverChip} title="Rollover balance">↻ {fmt(c.rolloverBalance)}</span>}
                  </div>
                )}
              </td>
              <td style={{ ...st.numCell, padding: '0 16px', borderBottom: 'none' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                  <BudgetCell ref={el => { cellRefs.current[cat] = el; }} value={c.planned} onSave={v => onSavePlanned(cat, v)} fmt={fmt} toDisplay={toDisplay} toRaw={toRaw} />
                  <span style={{ fontSize: 9, fontWeight: 700, color: T.textDim, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 3, padding: '1px 4px', letterSpacing: '0.05em', flexShrink: 0 }}>
                    {(catCurrencies[cat] ?? 'CRC') === 'USD' ? '$' : '₡'}
                  </span>
                </div>
              </td>
              <td style={{ ...st.numCell, padding: rowPad + ' 16px 5px', borderBottom: 'none', color: c.activity < 0 ? T.neg : T.textDim }}>{fmt(-c.activity)}</td>
              <td style={{ ...st.numCell, padding: rowPad + ' 16px 5px', borderBottom: 'none', color: c.remaining < 0 ? T.neg : T.text }}>{fmt(c.remaining)}</td>
            </tr>
            <tr style={{ background: rowBg, cursor: editMode ? 'default' : 'text' }} onMouseEnter={() => setHovCat(cat)} onMouseLeave={() => setHovCat(null)}
              onClick={editMode ? undefined : () => { if (dragHappened.current) { dragHappened.current = false; return; } cellRefs.current[cat]?.startEdit(); }}
              {...dragHandlers}>
              <td colSpan={5} style={{ padding: '0 16px ' + rowPad, borderBottom: `1px solid ${T.borderSoft}` }}>
                <div style={st.barRowWrap}>
                  <div style={st.barTrack}><div style={{ ...st.barFill, width: pct + '%', background: barColor, boxShadow: pct > 0 ? `0 0 8px ${barColor}66` : 'none' }} /></div>
                  <span style={st.barPct}>{c.planned > 0 ? Math.round(pct) + '%' : '—'}</span>
                </div>
              </td>
            </tr>
          </React.Fragment>
        );
      })}

      {editMode && !collapsed && (
        <tr>
          <td colSpan={5} style={{ padding: '6px 16px 10px 40px', borderBottom: `1px solid ${T.borderSoft}` }}>
            {adding ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input autoFocus value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="Category name"
                  onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') setAdding(false); }} style={st.renameInput} />
                <button
                  onClick={(e) => { e.stopPropagation(); setNewCatCurrency(c => c === 'CRC' ? 'USD' : 'CRC'); }}
                  style={{ fontSize: 10, padding: '2px 6px', border: `1px solid ${T.border}`, borderRadius: 4, background: newCatCurrency === 'USD' ? T.accentDim : T.surface, cursor: 'pointer', color: T.text }}
                >
                  {newCatCurrency}
                </button>
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

// ── Flex-mode rows ─────────────────────────────────────────

function FlexEditRow({ c, fmt, onSavePlanned, toDisplay, toRaw, showRollover }:
  { c: PlanCatState; fmt: (n: number) => string; onSavePlanned: (cat: string, v: number) => void; toDisplay?: (raw: number) => number; toRaw?: (display: number) => number; showRollover?: boolean }) {
  const spent = -c.activity;
  return (
    <div style={st.flexRow}>
      <span style={st.flexRowName}>{c.cat}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {showRollover && <span style={st.flexAccrued} title="Accumulated funds">↻ {fmt(c.rolloverBalance)}</span>}
        <span style={{ fontSize: 12.5, fontFamily: T.mono, color: spent > 0 ? T.neg : T.textDim, minWidth: 70, textAlign: 'right' as const }}>{fmt(spent)}</span>
        <div style={{ minWidth: 110, display: 'flex', justifyContent: 'flex-end' }}>
          <BudgetCell value={c.planned} onSave={v => onSavePlanned(c.cat, v)} fmt={fmt} toDisplay={toDisplay} toRaw={toRaw} />
        </div>
      </div>
    </div>
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
  const [server, setServer] = useState<PlanMonthAPI | null>(null);
  const [localPlanned, setLocalPlanned] = useState<Record<string, number> | null>(null);
  const [expectedIncome, setExpectedIncome] = useState(0);
  const [mode, setMode] = useState<'category' | 'flex'>('category');
  const [flexBudget, setFlexBudget] = useState(0);
  const [loading, setLoading] = useState(true);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [monthRate, setMonthRate] = useState<ExchangeRate | null>(null);
  const toast = useToast();
  const { push: undoPush, pop: undoPop } = useUndoStack();

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [groups, setGroups] = useState(() => categoryGroups.map(g => ({ ...g, categories: [...g.categories] })));
  const [hidden, setHidden] = useState(new Set<string>());
  const [showHidden, setShowHidden] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [inspectorCat, setInspectorCat] = useState<string | null>(null);
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [fetchCounter, setFetchCounter] = useState(0);

  // Ctrl-Z handler — unchanged from previous implementation.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'z' || e.shiftKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      const label = undoPop();
      if (label) toast.success(`Undone: ${label}`);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [undoPop, toast]);

  const nameById = useMemo(
    () => Object.fromEntries(Object.entries(categoryIdByName).map(([n, id]) => [id, n])),
    [categoryIdByName],
  );

  // Sync groups when the prop arrives after mount.
  useEffect(() => {
    if (categoryGroups.length > 0) {
      setGroups(categoryGroups.map(g => ({ ...g, categories: [...g.categories] })));
    }
  }, [categoryGroups]);

  useEffect(() => { fetchBudgetMode().then(setMode).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    fetchPlan(currentYM)
      .then(data => {
        setServer(data);
        setExpectedIncome(data.expected_income);
        setFlexBudget(data.flex_budget);
        setLocalPlanned(null);
        setBudgetError(null);
      })
      .catch(err => setBudgetError(err.message))
      .finally(() => setLoading(false));
    fetchNearestRate(currentYM + '-15').then(setMonthRate).catch(() => {});
  }, [currentYM, fetchCounter]);

  const rate = monthRate?.usd_to_crc ?? 500;

  const state: PlanState = useMemo(() => computePlan({
    groups: server?.category_groups ?? [],
    expectedIncome,
    rate,
    localPlanned,
    nameById,
  }), [server, expectedIncome, rate, localPlanned, nameById]);

  const catCurrencies = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [name, c] of Object.entries(state.cats)) out[name] = c.currency;
    return out;
  }, [state.cats]);

  const month = currentDisplayMonth;
  const rowPad = density === 'compact' ? '6px' : '11px';

  const fmtMonth = useMemo<(n: number) => string>(() => {
    if (currency !== 'USD' || monthRate === null) return fmt;
    const r = monthRate.usd_to_crc;
    return (amount: number) => {
      const usd = amount / r;
      return (amount < 0 ? '-' : '') + '$' + Math.abs(usd).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    };
  }, [currency, monthRate, fmt]);

  const toDisplayFn = useMemo<((raw: number) => number) | undefined>(() => {
    if (currency !== 'USD' || monthRate === null) return undefined;
    const r = monthRate.usd_to_crc;
    return (crc: number) => crc / r;
  }, [currency, monthRate]);

  const toRawFn = useMemo<((display: number) => number) | undefined>(() => {
    if (currency !== 'USD' || monthRate === null) return undefined;
    const r = monthRate.usd_to_crc;
    return (usd: number) => Math.round(usd * r);
  }, [currency, monthRate]);

  // ── Plan handlers ────────────────────────────────────────

  const handleSavePlanned = useCallback((catName: string, value: number) => {
    const catId = categoryIdByName[catName];
    const prev = state.cats[catName]?.planned ?? 0;
    setLocalPlanned(p => ({ ...(p ?? {}), [catName]: value }));
    if (catId) apiSetPlanned(currentYM, catId, value).catch(err => toast.error(err.message));
    undoPush({
      label: `Budget ${catName}`,
      undo: () => {
        setLocalPlanned(p => ({ ...(p ?? {}), [catName]: prev }));
        if (catId) apiSetPlanned(currentYM, catId, prev).catch(err => toast.error(err.message));
      },
    });
  }, [state, categoryIdByName, currentYM, toast, undoPush]);

  const handleSaveIncome = useCallback((value: number) => {
    const prev = expectedIncome;
    setExpectedIncome(value);
    apiSetIncome(currentYM, value).catch(err => toast.error(err.message));
    undoPush({
      label: 'Expected income',
      undo: () => { setExpectedIncome(prev); apiSetIncome(currentYM, prev).catch(() => {}); },
    });
  }, [expectedIncome, currentYM, toast, undoPush]);

  const handleSaveFlexBudget = useCallback((value: number) => {
    const prev = flexBudget;
    setFlexBudget(value);
    apiSetFlexBudget(currentYM, value).catch(err => toast.error(err.message));
    undoPush({
      label: 'Flex budget',
      undo: () => { setFlexBudget(prev); apiSetFlexBudget(currentYM, prev).catch(() => {}); },
    });
  }, [flexBudget, currentYM, toast, undoPush]);

  const handleModeChange = useCallback((m: 'category' | 'flex') => {
    setMode(m);
    apiSetBudgetMode(m).catch(err => toast.error(err.message));
  }, [toast]);

  const handleCopyPrevious = useCallback(() => {
    copyPreviousPlan(currentYM)
      .then(() => fetchPlan(currentYM))
      .then(data => { setServer(data); setExpectedIncome(data.expected_income); setFlexBudget(data.flex_budget); setLocalPlanned(null); })
      .catch(err => toast.error(err.message));
  }, [currentYM, toast]);

  const handleResetAll = useCallback(() => {
    const updates = resetAllPlanned(state);
    setLocalPlanned(updates);
    Object.entries(updates).forEach(([name, v]) => {
      const id = categoryIdByName[name];
      if (id) apiSetPlanned(currentYM, id, v).catch(() => {});
    });
  }, [state, categoryIdByName, currentYM]);

  const handleUpdateCategoryMeta = useCallback((catId: string, meta: { rollover: boolean; flexibility: 'fixed' | 'flexible' | 'non_monthly' }) => {
    const name = nameById[catId];
    const grp = groups.find(g => g.categories.includes(name));
    const sortOrder = grp ? grp.categories.indexOf(name) : 0;
    updateCategory(catId, { name, hidden: hidden.has(name), sort_order: sortOrder, rollover: meta.rollover, flexibility: meta.flexibility })
      .then(() => { onCategoriesChanged(); setFetchCounter(c => c + 1); })
      .catch(err => toast.error(err.message));
  }, [nameById, groups, hidden, onCategoriesChanged, toast]);

  // ── Selection ────────────────────────────────────────────

  const toggleCatSelection = useCallback((name: string) => {
    setSelectedCats(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const toggleGroupSelection = useCallback((catNames: string[]) => {
    setSelectedCats(prev => {
      const next = new Set(prev);
      const allSelected = catNames.every(c => next.has(c));
      if (allSelected) catNames.forEach(c => next.delete(c));
      else catNames.forEach(c => next.add(c));
      return next;
    });
  }, []);

  const summaryStats = useMemo<SummaryStats>(() => {
    const sel = selectedCats.size ? [...selectedCats] : Object.keys(state.cats);
    let planned = 0, actual = 0, remaining = 0, roll = 0;
    let allRoll = sel.length > 0;
    for (const name of sel) {
      const c = state.cats[name];
      if (!c) continue;
      const k = (n: number) => c.currency === 'USD' ? n * rate : n;
      planned += k(c.planned);
      actual += k(-c.activity);
      remaining += k(c.remaining);
      if (c.rollover) roll += k(c.rolloverBalance); else allRoll = false;
    }
    return { planned, actual, remaining, rolloverBalance: allRoll ? roll : null };
  }, [selectedCats, state, rate]);

  const selectionLabel = useMemo(() => {
    const totalCount = Object.keys(state.cats).length;
    if (selectedCats.size === 0) return `All categories · ${totalCount}`;
    const parts: string[] = [];
    const handledCats = new Set<string>();
    for (const g of groups) {
      const inGroup = g.categories.filter(c => selectedCats.has(c));
      if (inGroup.length > 0 && inGroup.length === g.categories.length) {
        parts.push(g.name);
        inGroup.forEach(c => handledCats.add(c));
      }
    }
    for (const c of selectedCats) {
      if (!handledCats.has(c)) parts.push(c);
    }
    const label = parts.length <= 2
      ? parts.join(' + ')
      : `${parts.slice(0, 2).join(' + ')} +${parts.length - 2} more`;
    return `${label} · ${selectedCats.size} ${selectedCats.size === 1 ? 'category' : 'categories'}`;
  }, [selectedCats, state.cats, groups]);

  // ── Category edit handlers (rename/hide/delete/reorder/groups) ──

  const toggleGroup = (gid: string) => setCollapsed(c => ({ ...c, [gid]: !c[gid] }));

  const metaFor = (name: string) => {
    const c = state.cats[name];
    return { rollover: c?.rollover ?? false, flexibility: c?.flexibility ?? 'flexible' as const };
  };

  const renameCat = (gid: string, oldName: string, newName: string) => {
    const catId = categoryIdByName[oldName];
    const grp = groups.find(g => g.id === gid);
    const sortOrder = grp ? grp.categories.indexOf(oldName) : 0;
    const meta = metaFor(oldName);
    undoPush({
      label: `Rename '${oldName}'`,
      undo: () => {
        setGroups(gs => gs.map(g =>
          g.id === gid ? { ...g, categories: g.categories.map(c => c === newName ? oldName : c) } : g
        ));
        if (catId) {
          updateCategory(catId, { name: oldName, hidden: hidden.has(oldName), sort_order: sortOrder, rollover: meta.rollover, flexibility: meta.flexibility })
            .then(() => onCategoriesChanged())
            .catch(err => toast.error(err.message));
        }
      },
    });
    setGroups(gs => gs.map(g =>
      g.id === gid
        ? { ...g, categories: g.categories.map(c => c === oldName ? newName : c) }
        : g
    ));
    setSelectedCats(prev => {
      if (!prev.has(oldName)) return prev;
      const next = new Set(prev); next.delete(oldName); next.add(newName); return next;
    });
    setInspectorCat(newName);
    if (catId) {
      updateCategory(catId, { name: newName, hidden: hidden.has(oldName), sort_order: sortOrder, rollover: meta.rollover, flexibility: meta.flexibility })
        .then(() => onCategoriesChanged())
        .catch(err => toast.error(err.message));
    }
  };

  const reorderCat = (gid: string, idx: number, dir: number) => {
    undoPush({
      label: 'Reorder category',
      undo: () => {
        setGroups(gs => gs.map(g => {
          if (g.id !== gid) return g;
          const arr = [...g.categories];
          const j = idx + dir;
          if (j < 0 || j >= arr.length) return g;
          [arr[idx], arr[j]] = [arr[j], arr[idx]];
          return { ...g, categories: arr };
        }));
      },
    });
    setGroups(gs => gs.map(g => {
      if (g.id !== gid) return g;
      const arr = [...g.categories];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return g;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return { ...g, categories: arr };
    }));
  };

  const handleReorderCat = useCallback((gid: string, fromIdx: number, toIdx: number) => {
    const capturedCategoryIdByName = { ...categoryIdByName };
    const metaByName = (name: string) => {
      const c = state.cats[name];
      return { rollover: c?.rollover ?? false, flexibility: c?.flexibility ?? 'flexible' as const };
    };
    undoPush({
      label: 'Reorder category',
      undo: () => {
        setGroups(gs => gs.map(g => {
          if (g.id !== gid) return g;
          const arr = [...g.categories];
          const [moved] = arr.splice(toIdx, 1);
          arr.splice(fromIdx, 0, moved);
          arr.forEach((catName, idx) => {
            const catId = capturedCategoryIdByName[catName];
            const m = metaByName(catName);
            if (catId) updateCategory(catId, { name: catName, hidden: hidden.has(catName), sort_order: idx, rollover: m.rollover, flexibility: m.flexibility }).catch(err => toast.error(err.message));
          });
          return { ...g, categories: arr };
        }));
      },
    });
    setGroups(gs => gs.map(g => {
      if (g.id !== gid) return g;
      const arr = [...g.categories];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      arr.forEach((catName, idx) => {
        const catId = categoryIdByName[catName];
        const m = metaByName(catName);
        if (catId) updateCategory(catId, { name: catName, hidden: hidden.has(catName), sort_order: idx, rollover: m.rollover, flexibility: m.flexibility }).catch(err => toast.error(err.message));
      });
      return { ...g, categories: arr };
    }));
  }, [categoryIdByName, undoPush, state, hidden, toast]);

  const hideCat = (name: string) => {
    const wasHidden = hidden.has(name);
    undoPush({
      label: wasHidden ? `Unhide '${name}'` : `Hide '${name}'`,
      undo: () => setHidden(h => {
        const n = new Set(h);
        if (wasHidden) n.add(name); else n.delete(name);
        return n;
      }),
    });
    setHidden(h => { const n = new Set(h); n.has(name) ? n.delete(name) : n.add(name); return n; });
  };

  const deleteCat = (gid: string, name: string) => {
    const catId = categoryIdByName[name];
    const capturedCurrency = (state.cats[name]?.currency ?? 'CRC');
    const capturedPlanned = state.cats[name]?.planned ?? 0;
    const capturedYM = currentYM;
    const capturedSortIdx = groups.find(g => g.id === gid)?.categories.indexOf(name) ?? 0;
    setGroups(gs => gs.map(g => g.id === gid ? { ...g, categories: g.categories.filter(c => c !== name) } : g));
    setSelectedCats(prev => { if (!prev.has(name)) return prev; const next = new Set(prev); next.delete(name); return next; });
    if (catId) {
      deleteCategory(catId)
        .then(() => {
          undoPush({
            label: `Delete '${name}'`,
            undo: async () => {
              try {
                const newCat = await createCategory({ group_id: gid, name, sort_order: capturedSortIdx, currency: capturedCurrency as 'CRC' | 'USD' });
                if (capturedPlanned !== 0) {
                  await apiSetPlanned(capturedYM, newCat.id, capturedPlanned);
                }
                onCategoriesChanged();
              } catch (err: unknown) {
                toast.error((err as Error).message);
                onCategoriesChanged();
              }
            },
          });
          onCategoriesChanged();
        })
        .catch(err => { toast.error(err.message); onCategoriesChanged(); });
    }
  };

  const addCat = (gid: string, name: string, cur: 'CRC' | 'USD') => {
    setGroups(gs => gs.map(g => g.id === gid ? { ...g, categories: [...g.categories, name] } : g));
    createCategory({ group_id: gid, name, sort_order: 0, currency: cur })
      .then(newCat => {
        undoPush({
          label: `Add '${name}'`,
          undo: () => {
            setGroups(gs => gs.map(g => g.id === gid ? { ...g, categories: g.categories.filter(c => c !== name) } : g));
            deleteCategory(newCat.id)
              .then(() => onCategoriesChanged())
              .catch(err => { toast.error(err.message); onCategoriesChanged(); });
          },
        });
        onCategoriesChanged();
      })
      .catch(err => {
        toast.error(err.message);
        setGroups(gs => gs.map(g => g.id === gid ? { ...g, categories: g.categories.filter(c => c !== name) } : g));
      });
  };

  const renameGroup = (gid: string, name: string) => {
    const prev = groups.find(g => g.id === gid)?.name ?? '';
    undoPush({
      label: `Rename group '${prev}'`,
      undo: () => setGroups(gs => gs.map(g => g.id === gid ? { ...g, name: prev } : g)),
    });
    setGroups(gs => gs.map(g => g.id === gid ? { ...g, name } : g));
  };

  const moveGroup = (idx: number, dir: number) => {
    undoPush({
      label: 'Reorder group',
      undo: () => setGroups(gs => {
        const arr = [...gs];
        const j = idx + dir;
        if (j < 0 || j >= arr.length) return gs;
        [arr[idx], arr[j]] = [arr[j], arr[idx]];
        return arr;
      }),
    });
    setGroups(gs => {
      const arr = [...gs];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return gs;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return arr;
    });
  };

  const deleteGroup = (gid: string) => {
    const grp = groups.find(g => g.id === gid);
    if (!grp) return;
    const capturedGroupName = grp.name;
    const capturedGroupSortOrder = groups.findIndex(g => g.id === gid);
    const capturedYM = currentYM;
    const capturedCats = grp.categories.map((name, i) => ({
      name,
      currency: (state.cats[name]?.currency ?? 'CRC') as 'CRC' | 'USD',
      planned: state.cats[name]?.planned ?? 0,
      sortOrder: i,
    }));
    undoPush({
      label: `Delete group '${capturedGroupName}'`,
      undo: async () => {
        try {
          const newGroup = await createCategoryGroup({ name: capturedGroupName, sort_order: capturedGroupSortOrder });
          for (const cat of capturedCats) {
            const newCat = await createCategory({ group_id: newGroup.id, name: cat.name, sort_order: cat.sortOrder, currency: cat.currency });
            if (cat.planned !== 0) {
              await apiSetPlanned(capturedYM, newCat.id, cat.planned);
            }
          }
          onCategoriesChanged();
        } catch (err: unknown) {
          toast.error((err as Error).message);
          onCategoriesChanged();
        }
      },
    });
    setGroups(gs => gs.filter(g => g.id !== gid));
    deleteCategoryGroup(gid)
      .then(() => onCategoriesChanged())
      .catch(err => { toast.error(err.message); onCategoriesChanged(); });
  };

  const addGroup = () => {
    createCategoryGroup({ name: 'New Group', sort_order: groups.length })
      .then(g => {
        undoPush({
          label: `Add group 'New Group'`,
          undo: () => {
            setGroups(gs => gs.filter(grp => grp.id !== g.id));
            deleteCategoryGroup(g.id)
              .then(() => onCategoriesChanged())
              .catch(err => { toast.error(err.message); onCategoriesChanged(); });
          },
        });
        setGroups(gs => [...gs, { id: g.id, name: g.name, categories: [] }]);
        onCategoriesChanged();
      })
      .catch(err => toast.error(err.message));
  };

  // ── Flex-mode partitioning ───────────────────────────────

  const fixedCats = useMemo(() => Object.values(state.cats).filter(c => c.flexibility === 'fixed' && (showHidden || !hidden.has(c.cat))), [state.cats, hidden, showHidden]);
  const flexibleCats = useMemo(() => Object.values(state.cats).filter(c => c.flexibility === 'flexible' && (showHidden || !hidden.has(c.cat))), [state.cats, hidden, showHidden]);
  const nonMonthlyCats = useMemo(() => Object.values(state.cats).filter(c => c.flexibility === 'non_monthly' && (showHidden || !hidden.has(c.cat))), [state.cats, hidden, showHidden]);

  const leftToBudget = state.leftToBudget;
  const plannedSavings = leftToBudget > 0 ? leftToBudget : 0;

  const flexPct = flexBudget > 0 ? Math.min(((server?.flexible_actual ?? 0) / flexBudget) * 100, 100) : 0;
  const flexOver = (server?.flexible_actual ?? 0) > flexBudget && flexBudget > 0;

  return (
    <div>
      {budgetError && (
        <div style={{ margin: '12px 16px 0', padding: '12px 16px', background: 'rgba(255,80,80,0.08)', border: `1px solid rgba(255,80,80,0.2)`, borderRadius: 8, color: T.neg, fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1 }}>Failed to load plan: {budgetError}</span>
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

        <div style={st.summaryHeader}>
          <HeaderStat label="Expected income">
            <BudgetCell value={expectedIncome} onSave={handleSaveIncome} fmt={fmt} />
          </HeaderStat>
          <HeaderStat label="Planned"><span>{fmt(state.plannedTotalCRC)}</span></HeaderStat>
          <HeaderStat label="Left to budget">
            <span style={{ color: leftToBudget < 0 ? T.neg : T.pos }}>{fmt(leftToBudget)}</span>
          </HeaderStat>
          <HeaderStat label="Planned savings"><span>{fmt(plannedSavings)}</span></HeaderStat>
          <div style={st.modeToggle}>
            {(['category', 'flex'] as const).map(m => (
              <button key={m} onClick={() => handleModeChange(m)} style={{ ...st.modePill, ...(mode === m ? st.modePillOn : {}) }}>
                {m === 'category' ? 'Category' : 'Flex'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button onClick={handleCopyPrevious} style={st.actionBtn}>Copy last month</button>
          <button onClick={handleResetAll} style={{ ...st.actionBtn, color: T.neg, borderColor: T.negDim }}>Reset all</button>
          <button onClick={() => setEditMode(e => !e)} style={{ ...st.actionBtn, ...(editMode ? st.actionOn : {}) }}>{editMode ? 'Done' : 'Edit'}</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' as const, color: T.textDim }}>Loading plan…</div>
      ) : mode === 'flex' ? (
        <div style={{ padding: '20px 28px', maxWidth: 900, margin: '0 auto' }}>
          {/* Fixed */}
          <div style={st.flexSection}>
            <div style={st.flexSectionHead}>
              <span style={st.flexSectionTitle}>Fixed</span>
              <span style={st.flexSectionSums}>{fmt(server?.fixed_actual ?? 0)} <span style={{ color: T.textFaint }}>/ {fmt(server?.fixed_planned ?? 0)}</span></span>
            </div>
            <div style={st.flexHeaderRow}><span>Category</span><div style={{ display: 'flex', gap: 16 }}><span style={{ minWidth: 70, textAlign: 'right' as const }}>Actual</span><span style={{ minWidth: 110, textAlign: 'right' as const }}>Budgeted</span></div></div>
            {fixedCats.length === 0 ? <div style={st.flexEmpty}>No fixed categories</div> :
              fixedCats.map(c => <FlexEditRow key={c.cat} c={c} fmt={fmtMonth} onSavePlanned={handleSavePlanned} toDisplay={c.currency === 'USD' ? toDisplayFn : undefined} toRaw={c.currency === 'USD' ? toRawFn : undefined} />)}
          </div>

          {/* Flexible */}
          <div style={st.flexSection}>
            <div style={st.flexSectionHead}>
              <span style={st.flexSectionTitle}>Flexible</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, fontFamily: T.mono, color: flexOver ? T.neg : T.textMid }}>{fmt(server?.flexible_actual ?? 0)} <span style={{ color: T.textFaint }}>spent</span></span>
                <BudgetCell value={flexBudget} onSave={handleSaveFlexBudget} fmt={fmt} />
              </div>
            </div>
            <div style={{ padding: '4px 0 12px' }}>
              <div style={st.barTrack}><div style={{ ...st.barFill, width: flexPct + '%', background: flexOver ? T.neg : '#f6c45a', boxShadow: flexPct > 0 ? `0 0 8px ${flexOver ? T.neg : '#f6c45a'}66` : 'none' }} /></div>
            </div>
            {flexibleCats.length === 0 ? <div style={st.flexEmpty}>No flexible categories</div> :
              flexibleCats.map(c => (
                <div key={c.cat} style={st.flexRow}>
                  <span style={st.flexRowName}>{c.cat}</span>
                  <span style={{ fontSize: 12.5, fontFamily: T.mono, color: c.activity < 0 ? T.neg : T.textDim }}>{fmtMonth(-c.activity)}</span>
                </div>
              ))}
          </div>

          {/* Non-monthly */}
          <div style={st.flexSection}>
            <div style={st.flexSectionHead}>
              <span style={st.flexSectionTitle}>Non-monthly</span>
              <span style={st.flexSectionSums}>{fmt(server?.non_monthly_actual ?? 0)} <span style={{ color: T.textFaint }}>/ {fmt(server?.non_monthly_planned ?? 0)}</span></span>
            </div>
            <div style={st.flexHeaderRow}><span>Category</span><div style={{ display: 'flex', gap: 16 }}><span style={{ minWidth: 70, textAlign: 'right' as const }}>Funds</span><span style={{ minWidth: 70, textAlign: 'right' as const }}>Actual</span><span style={{ minWidth: 110, textAlign: 'right' as const }}>Budgeted</span></div></div>
            {nonMonthlyCats.length === 0 ? <div style={st.flexEmpty}>No non-monthly categories</div> :
              nonMonthlyCats.map(c => <FlexEditRow key={c.cat} c={c} fmt={fmtMonth} onSavePlanned={handleSavePlanned} toDisplay={c.currency === 'USD' ? toDisplayFn : undefined} toRaw={c.currency === 'USD' ? toRawFn : undefined} showRollover />)}
          </div>
        </div>
      ) : (
        <div style={{ padding: '20px 28px', maxWidth: 1400, margin: '0 auto' }}>
          {editMode && (
            <div style={st.editBar}>
              <span style={{ fontSize: 12.5, color: T.textMid, fontWeight: 600 }}>Editing categories — rename, reorder, hide or delete.</span>
              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                <label style={st.checkLabel}><input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} style={{ accentColor: 'var(--accent)' }} /> Show hidden</label>
                <button onClick={addGroup} style={st.miniBtnOn}>+ Add group</button>
              </div>
            </div>
          )}
          <div style={{ ...st.tableWrap, display: 'flex', alignItems: 'stretch', overflow: 'visible' }}>
            <div style={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', borderRadius: `${T.radius} 0 0 ${T.radius}`, borderRight: `1px solid ${T.border}` }}>
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={{ ...st.th, width: 28, padding: '12px 4px 12px 12px' }}></th>
                    <th style={{ ...st.th, textAlign: 'left', width: '46%' }}>Category</th>
                    <th style={{ ...st.th, textAlign: 'right' }}>Budgeted</th>
                    <th style={{ ...st.th, textAlign: 'right' }}>Actual</th>
                    <th style={{ ...st.th, textAlign: 'right' }}>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g, gi) => (
                    <GroupBlock key={g.id} group={g} gidx={gi} color={colorFor(g.name, gi)} catState={state.cats}
                      collapsed={!!collapsed[g.id]} onToggle={() => toggleGroup(g.id)} fmt={fmtMonth} onSavePlanned={handleSavePlanned}
                      onOpenInspector={setInspectorCat} inspectorCat={inspectorCat} rowPad={rowPad} editMode={editMode} hidden={hidden} showHidden={showHidden}
                      onRenameCat={renameCat} onMoveCat={reorderCat} onHideCat={hideCat} onDeleteCat={deleteCat} onAddCat={addCat}
                      onRenameGroup={renameGroup} onMoveGroup={moveGroup} onDeleteGroup={deleteGroup} onReorderCat={handleReorderCat}
                      catCurrencies={catCurrencies} toDisplay={toDisplayFn} toRaw={toRawFn}
                      selectedCats={selectedCats} onToggleCatSelection={toggleCatSelection} onToggleGroupSelection={toggleGroupSelection} />
                  ))}
                </tbody>
              </table>
            </div>
            <BudgetSummaryPane
              stats={summaryStats}
              selectionLabel={selectionLabel}
              hasSelection={selectedCats.size > 0}
              onClear={() => setSelectedCats(new Set())}
              fmt={fmtMonth}
            />
          </div>
        </div>
      )}

      {inspectorCat && state.cats[inspectorCat] && (() => {
        const grpName = (groups.find(g => g.categories.includes(inspectorCat)) ?? {}).name ?? '';
        const grpIdx = groups.findIndex(g => g.categories.includes(inspectorCat));
        return (
          <CategoryInspector cat={inspectorCat} color={colorFor(grpName, grpIdx)} c={state.cats[inspectorCat]}
            fmt={fmtMonth} onClose={() => setInspectorCat(null)}
            onUpdateCategoryMeta={handleUpdateCategoryMeta} onHide={hideCat}
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
  summaryHeader:{ flex: 1, display: 'flex', alignItems: 'stretch', gap: 14, background: `linear-gradient(135deg, ${T.accentDim}, transparent)`, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: '9px 22px', minWidth: 360, flexWrap: 'wrap' as const },
  headerStat:  { display: 'flex', flexDirection: 'column' as const, justifyContent: 'center', gap: 3, minWidth: 96 },
  headerStatLabel: { fontSize: 10, fontWeight: 700, color: T.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const },
  headerStatValue: { fontSize: 16, fontWeight: 700, fontFamily: T.mono, letterSpacing: '-0.02em', lineHeight: 1.1, color: T.text },
  modeToggle:  { display: 'flex', gap: 3, alignItems: 'center', marginLeft: 'auto', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 9, padding: 3, alignSelf: 'center' },
  modePill:    { padding: '6px 13px', fontSize: 12, fontWeight: 600, background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer', color: T.textDim, transition: 'all 0.12s' },
  modePillOn:  { background: T.accentDim, color: 'var(--accent)' },
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
  rolloverChip:{ fontSize: 10.5, fontWeight: 600, color: 'var(--accent)', fontFamily: T.mono, background: T.accentDim, padding: '1px 7px', borderRadius: 5 },
  barRowWrap:  { display: 'flex', alignItems: 'center', gap: 10 },
  barTrack:    { flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' },
  barFill:     { height: '100%', borderRadius: 3, transition: 'width 0.5s cubic-bezier(0.22,1,0.36,1)' },
  barPct:      { fontSize: 11, fontFamily: T.mono, color: T.textDim, fontWeight: 500, flexShrink: 0, width: 36, textAlign: 'right' as const },
  numCell:     { fontSize: 12.5, textAlign: 'right' as const, fontFamily: T.mono, borderBottom: `1px solid ${T.borderSoft}`, color: T.textMid },
  cellClickable:{ display: 'inline-flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, cursor: 'text', padding: '4px 8px', borderRadius: 6, transition: 'background 0.1s', minWidth: 90, marginLeft: 'auto', color: T.text },
  cellHovered: { background: T.accentDim, boxShadow: `inset 0 0 0 1px ${T.borderHi}` },
  pencil:      { color: 'var(--accent)', display: 'flex', transition: 'opacity 0.1s' },
  cellInput:   { width: 96, textAlign: 'right' as const, border: `1px solid var(--accent)`, borderRadius: 6, padding: '4px 8px', fontSize: 12.5, fontFamily: T.mono, background: T.surface2, color: T.text, boxShadow: '0 0 0 3px var(--accent-dim)' },
  renameInput: { padding: '4px 8px', fontSize: 13, border: `1px solid var(--accent)`, borderRadius: 6, background: T.surface2, color: T.text, fontFamily: T.sans, width: 150 },
  reorder:     { display: 'inline-flex', flexDirection: 'column' as const, gap: 1 },
  iconBtn:     { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, color: T.textDim, cursor: 'pointer', fontSize: 8, lineHeight: 1, padding: '2px 4px' },
  miniBtn:     { padding: '3px 9px', fontSize: 11, fontWeight: 600, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, color: T.textMid, cursor: 'pointer' },
  miniBtnOn:   { padding: '3px 9px', fontSize: 11, fontWeight: 700, background: 'var(--accent)', color: '#06140d', border: 'none', borderRadius: 6, cursor: 'pointer' },
  addCatBtn:   { background: 'none', border: `1px dashed ${T.border}`, borderRadius: 7, color: T.textDim, cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '6px 12px' },
  dragHandle:  { fontSize: 14, color: T.textDim, cursor: 'grab', transition: 'opacity 0.1s', userSelect: 'none' as const, lineHeight: 1 },
  checkCell:   { width: 28, padding: '0 4px 0 12px', verticalAlign: 'middle' as const },
  check:       { accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer', display: 'block' as const },
  flexSection: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, boxShadow: T.shadow, padding: '16px 20px', marginBottom: 16 },
  flexSectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${T.border}` },
  flexSectionTitle:{ fontSize: 13, fontWeight: 800, color: T.text, letterSpacing: '-0.01em' },
  flexSectionSums: { fontSize: 12.5, fontFamily: T.mono, color: T.textMid },
  flexHeaderRow:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, fontWeight: 700, color: T.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const, padding: '0 0 6px' },
  flexRow:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${T.borderSoft}` },
  flexRowName: { fontSize: 13, fontWeight: 500, color: T.textMid },
  flexAccrued: { fontSize: 11, fontWeight: 600, color: 'var(--accent)', fontFamily: T.mono, minWidth: 70, textAlign: 'right' as const },
  flexEmpty:   { fontSize: 12.5, color: T.textDim, padding: '10px 0', fontStyle: 'italic' as const },
};
