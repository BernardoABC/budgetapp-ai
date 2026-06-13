import type { PlanGroupAPI } from './api';

export interface PlanCatState {
  cat: string;            // category name (keying matches existing Budget.tsx convention)
  id: string;
  currency: string;       // current category currency (for new entries)
  plannedCurrency: string; // currency the displayed month's planned amount was entered in
  flexibility: 'fixed' | 'flexible' | 'non_monthly';
  rollover: boolean;
  planned: number;        // CRC
  activity: number;       // CRC, negative = spending
  remaining: number;      // CRC: planned + activity
  rolloverBalance: number; // CRC: accumulated balance through this month (rollover cats)
}

export interface PlanState {
  cats: Record<string, PlanCatState>;
  plannedTotalCRC: number;
  expectedIncome: number;
  leftToBudget: number;
}

interface ComputeInput {
  groups: PlanGroupAPI[];          // server snapshot for the month
  expectedIncome: number;
  rate: number;                    // USD→CRC for cross-currency totals
  // local planned overrides keyed by category name (major units)
  localPlanned: Record<string, number> | null;
  nameById: Record<string, string>;
}

const toCRC = (amount: number, currency: string, rate: number) =>
  currency === 'USD' ? amount * rate : amount;

export function computePlan(input: ComputeInput): PlanState {
  const { groups, expectedIncome, rate, localPlanned, nameById } = input;
  const cats: Record<string, PlanCatState> = {};
  let plannedTotalCRC = 0;

  for (const g of groups) {
    for (const c of g.categories) {
      const name = nameById[c.id] ?? c.name;
      const planned = localPlanned?.[name] ?? c.planned;
      const remaining = planned + c.activity;
      // rollover balance shifts by the delta of any local planned edit;
      // non-monthly categories accumulate regardless of the rollover flag
      const accumulates = c.rollover || c.flexibility === 'non_monthly';
      const rolloverBalance = accumulates
        ? c.rollover_balance + (planned - c.planned)
        : 0;
      cats[name] = {
        cat: name, id: c.id, currency: c.currency, plannedCurrency: c.planned_currency ?? c.currency,
        flexibility: c.flexibility, rollover: c.rollover,
        planned, activity: c.activity, remaining, rolloverBalance,
      };
      // planned is already in CRC (service converts before sending)
      plannedTotalCRC += planned;
    }
  }

  return {
    cats,
    plannedTotalCRC,
    expectedIncome,
    leftToBudget: expectedIncome - plannedTotalCRC,
  };
}

// resetAllPlanned returns a planned-override map setting every category to 0.
export function resetAllPlanned(state: PlanState): Record<string, number> {
  const out: Record<string, number> = {};
  Object.values(state.cats).forEach(c => { out[c.cat] = 0; });
  return out;
}
