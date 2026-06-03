import type { CategoryGroup, Target, PayeeRule } from './data';

export interface CatState {
  cat: string;
  assigned: number;
  activity: number;
  carryIn: number;
  available: number;
  target: Target | null;
  underfunded: number;
  targetNeed: number;
  fundedPct: number | null;
}

export interface MonthState {
  month: string;
  cats: Record<string, CatState>;
  monthIncome: number;
  assignedTotal: number;
  rta: number;
  totalUnderfunded: number;
}

interface EngineData {
  months: string[];
  categoryGroups?: CategoryGroup[];
  budget: Record<string, Record<string, { assigned?: number; activity?: number }>>;
  income?: Record<string, number>;
  openingCarryover?: Record<string, number>;
  targets?: Record<string, Target>;
}

export function compute(
  data: EngineData,
  localBudget: Record<string, Record<string, { assigned?: number; activity?: number }>> | null,
  month: string,
  groups?: CategoryGroup[]
): MonthState {
  const months = data.months;
  const categoryGroups = groups ?? data.categoryGroups ?? [];
  const allCats = categoryGroups.flatMap(g => g.categories);
  const mi = months.indexOf(month);

  let carry: Record<string, number> = { ...(data.openingCarryover ?? {}) };
  let cumIncome = 0, cumAssigned = 0, cumOverspendBefore = 0;
  let result: Omit<MonthState, 'totalUnderfunded'> | null = null;

  for (let i = 0; i <= mi; i++) {
    const m = months[i];
    const md = (localBudget?.[m]) ?? data.budget[m] ?? {};
    const monthIncome = data.income?.[m] ?? 0;
    let assignedTotal = 0, monthOverspend = 0;
    const cats: Record<string, CatState> = {};
    const nextCarry: Record<string, number> = {};

    for (const cat of allCats) {
      const entry = md[cat] ?? {};
      const assigned = entry.assigned ?? 0;
      const activity = entry.activity ?? 0;
      const carryIn = carry[cat] ?? 0;
      const available = carryIn + assigned + activity;
      assignedTotal += assigned;
      cats[cat] = { cat, assigned, activity, carryIn, available, target: null, underfunded: 0, targetNeed: 0, fundedPct: null };
      if (available >= 0) nextCarry[cat] = available;
      else { nextCarry[cat] = 0; monthOverspend += -available; }
    }

    cumIncome += monthIncome;
    cumAssigned += assignedTotal;
    const rta = cumIncome - cumAssigned - cumOverspendBefore;

    if (i === mi) result = { month: m, cats, monthIncome, assignedTotal, rta };
    cumOverspendBefore += monthOverspend;
    carry = nextCarry;
  }

  if (!result) result = { month, cats: {}, monthIncome: 0, assignedTotal: 0, rta: 0 };

  const targets = data.targets ?? {};
  const monthsRemaining = (byMonth: string) => {
    const idx = months.indexOf(byMonth);
    return idx < 0 ? 1 : Math.max(1, idx - mi + 1);
  };

  let totalUnderfunded = 0;
  for (const cat of allCats) {
    const t = targets[cat] ?? null;
    const c = result.cats[cat];
    if (!c) continue;
    c.target = t;
    c.underfunded = 0;
    c.targetNeed = 0;
    c.fundedPct = null;
    if (t) {
      if (t.type === 'monthly') {
        c.targetNeed = t.amount;
        c.underfunded = Math.max(0, t.amount - c.assigned);
        c.fundedPct = t.amount > 0 ? Math.min(1, c.assigned / t.amount) : 1;
      } else if (t.type === 'refill') {
        c.targetNeed = t.amount;
        c.underfunded = Math.max(0, t.amount - c.available);
        c.fundedPct = t.amount > 0 ? Math.min(1, c.available / t.amount) : 1;
      } else if (t.type === 'savings') {
        const mr = monthsRemaining(t.by ?? '');
        const need = Math.max(0, (t.amount - c.carryIn - c.activity) / mr);
        c.targetNeed = need;
        c.underfunded = Math.max(0, need - c.assigned);
        c.fundedPct = t.amount > 0 ? Math.min(1, c.available / t.amount) : 1;
      }
    }
    totalUnderfunded += c.underfunded;
  }

  return { ...result, totalUnderfunded };
}

export function quickAssign(
  strategy: 'underfunded' | 'reset' | 'lastMonth',
  _data: unknown,
  state: MonthState,
  prevState: MonthState | null
): Record<string, number> {
  const out: Record<string, number> = {};
  Object.values(state.cats).forEach(c => {
    if (strategy === 'underfunded') out[c.cat] = c.assigned + c.underfunded;
    else if (strategy === 'reset') out[c.cat] = 0;
    else if (strategy === 'lastMonth' && prevState) out[c.cat] = (prevState.cats[c.cat]?.assigned) ?? 0;
  });
  return out;
}

export function categorize(payee: string, rules: PayeeRule[]): string | null {
  if (!payee || !rules) return null;
  const p = payee.toLowerCase();
  const hit = rules.find(r => p.includes(r.match.toLowerCase()));
  return hit ? hit.category : null;
}

export function targetLabel(t: Target | null, fmt: (n: number) => string): string | null {
  if (!t) return null;
  if (t.type === 'monthly') return fmt(t.amount) + ' / month';
  if (t.type === 'refill') return 'Refill to ' + fmt(t.amount);
  if (t.type === 'savings') return fmt(t.amount) + ' by ' + (t.by ?? '').split(' ')[0];
  return null;
}
