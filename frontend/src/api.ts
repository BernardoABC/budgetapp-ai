import type {
  Account,
  Transaction,
  CategoryGroup,
  CategoryGroupAPI,
  CategoryItemAPI,
  MonthlySpendingRow,
} from './data';

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8080') + '/api';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

export async function fetchAccounts(): Promise<{ budget: Account[]; tracking: Account[] }> {
  const list: Array<Account & { balance: number }> = await apiFetch('/accounts');
  const toMajor = (a: Account): Account => ({ ...a, balance: a.balance / 100 });
  return {
    budget:   list.filter(a => a.on_budget && !a.closed).map(toMajor),
    tracking: list.filter(a => !a.on_budget && !a.closed).map(toMajor),
  };
}

export async function createAccount(body: {
  name: string; type: string; currency: string; balance: number; on_budget: boolean; note?: string;
}): Promise<Account> {
  const acc: Account = await apiFetch('/accounts', {
    method: 'POST',
    body: JSON.stringify({ ...body, balance: Math.round(body.balance * 100) }),
  });
  return { ...acc, balance: acc.balance / 100 };
}

export async function updateAccount(id: string, body: Partial<Account>): Promise<Account> {
  return apiFetch(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export async function deleteAccount(id: string): Promise<void> {
  return apiFetch(`/accounts/${id}`, { method: 'DELETE' });
}

export async function toggleAccountClosed(id: string): Promise<Account> {
  return apiFetch(`/accounts/${id}/close`, { method: 'PATCH' });
}

// ─── Transactions ──────────────────────────────────────────────────────────────

export interface TxnPage {
  transactions: Transaction[];
  pagination: { page: number; per_page: number; total: number; total_pages: number };
  summary: { total_inflow: number; total_outflow: number; cleared_balance: number; uncleared_balance: number };
}

export interface TxnFilterParams {
  search?: string;
  from_date?: string;
  to_date?: string;
  category_id?: string;   // UUID, "none", or omitted
  cleared?: boolean;
  sort?: string;          // date_desc | date_asc | amount_asc | amount_desc | payee_asc | ...
  page?: number;
  per_page?: number;
}

function mapApiTxn(t: { id: string; date: string; payee: string; category: string | null; memo: string; cleared: boolean; account: string; currency: string; amount: number; exchange_rate?: number | null }): Transaction {
  const major = t.amount / 100;
  return {
    id: t.id, date: t.date, payee: t.payee, category: t.category,
    memo: t.memo, cleared: t.cleared, account: t.account,
    currency: t.currency, exchange_rate: t.exchange_rate,
    outflow: major < 0 ? -major : 0,
    inflow: major > 0 ? major : 0,
  } as Transaction;
}

export async function fetchTransactionsPage(
  accountId: string,
  filter: TxnFilterParams = {},
): Promise<TxnPage> {
  const params = new URLSearchParams();
  if (filter.search) params.set('search', filter.search);
  if (filter.from_date) params.set('from_date', filter.from_date);
  if (filter.to_date) params.set('to_date', filter.to_date);
  if (filter.category_id) params.set('category_id', filter.category_id);
  if (filter.cleared !== undefined) params.set('cleared', String(filter.cleared));
  if (filter.sort) params.set('sort', filter.sort);
  params.set('page', String(filter.page ?? 1));
  params.set('per_page', String(filter.per_page ?? 50));

  type ApiTxn = Parameters<typeof mapApiTxn>[0];
  const data = await apiFetch<{
    transactions: ApiTxn[];
    pagination: TxnPage['pagination'];
    summary: { total_inflow: number; total_outflow: number; cleared_balance: number; uncleared_balance: number };
  }>(`/accounts/${accountId}/transactions?${params}`);

  return {
    transactions: (data.transactions ?? []).map(mapApiTxn),
    pagination: data.pagination,
    summary: {
      total_inflow: data.summary.total_inflow / 100,
      total_outflow: data.summary.total_outflow / 100,
      cleared_balance: data.summary.cleared_balance / 100,
      uncleared_balance: data.summary.uncleared_balance / 100,
    },
  };
}

// Backwards-compatible helper used by fetchRecentTransactions / Dashboard.
export async function fetchAccountTransactions(
  accountId: string,
  page = 1,
  perPage = 200,
): Promise<Transaction[]> {
  const data = await fetchTransactionsPage(accountId, { page, per_page: perPage });
  return data.transactions;
}

export async function createTransaction(
  accountId: string,
  body: { date: string; payee: string; category_id?: string; amount: number; memo?: string; cleared?: boolean },
): Promise<Transaction> {
  return apiFetch(`/accounts/${accountId}/transactions`, {
    method: 'POST',
    body: JSON.stringify({ ...body, amount: Math.round(body.amount * 100) }),
  });
}

export async function updateTransaction(
  id: string,
  body: { date?: string; payee?: string; category_id?: string; amount?: number; memo?: string; cleared?: boolean },
): Promise<Transaction> {
  const payload = body.amount === undefined ? body : { ...body, amount: Math.round(body.amount * 100) };
  return apiFetch(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function deleteTransaction(id: string): Promise<void> {
  return apiFetch(`/transactions/${id}`, { method: 'DELETE' });
}

export async function batchTransactions(
  ids: string[],
  action: 'categorize' | 'clear' | 'unclear' | 'delete',
  categoryId?: string,
): Promise<{ affected: number }> {
  return apiFetch('/transactions/batch', {
    method: 'PATCH',
    body: JSON.stringify({ transaction_ids: ids, action, ...(categoryId !== undefined ? { category_id: categoryId } : {}) }),
  });
}

// ─── Categories ────────────────────────────────────────────────────────────────

export async function fetchCategoryGroups(): Promise<CategoryGroup[]> {
  const apiGroups: CategoryGroupAPI[] = await apiFetch('/category-groups');
  // Transform to the CategoryGroup shape used throughout the app (categories: string[])
  return apiGroups.map(g => ({
    id:   g.id,
    name: g.name,
    categories: g.categories.map(c => c.name),
  }));
}

export async function fetchCategoryGroupsRaw(): Promise<CategoryGroupAPI[]> {
  return apiFetch('/category-groups');
}

// ─── Category group CRUD ───────────────────────────────────────────────────────

export async function createCategoryGroup(body: { name: string; sort_order?: number }): Promise<CategoryGroupAPI> {
  return apiFetch('/category-groups', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateCategoryGroup(id: string, body: { name: string; sort_order?: number; hidden?: boolean }): Promise<CategoryGroupAPI> {
  return apiFetch(`/category-groups/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export async function deleteCategoryGroup(id: string): Promise<void> {
  return apiFetch(`/category-groups/${id}`, { method: 'DELETE' });
}

// ─── Category CRUD ─────────────────────────────────────────────────────────────

export async function createCategory(body: { group_id: string; name: string; sort_order?: number }): Promise<CategoryItemAPI> {
  return apiFetch('/categories', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateCategory(id: string, body: { name: string; hidden?: boolean; sort_order?: number }): Promise<CategoryItemAPI> {
  return apiFetch(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export async function deleteCategory(id: string): Promise<void> {
  return apiFetch(`/categories/${id}`, { method: 'DELETE' });
}

// ─── Exchange Rates ───────────────────────────────────────────────────────────

export interface ExchangeRate {
  date: string;
  usd_to_crc: number;
  source: string;
}

export interface BudgetCategoryAPI {
  id: string;
  name: string;
  assigned: number;
  activity: number;
  carry_in: number;
  available: number;
  underfunded: number;
  target: { type: string; amount: number; deadline: string | null } | null;
}

export interface BudgetGroupAPI {
  id: string;
  name: string;
  assigned: number;
  activity: number;
  available: number;
  categories: BudgetCategoryAPI[];
}

export interface BudgetMonthAPI {
  month: string;
  ready_to_assign: number;
  age_of_money: number | null;
  total_underfunded: number;
  category_groups: BudgetGroupAPI[];
}

export async function fetchCurrentRate(): Promise<ExchangeRate> {
  return apiFetch<ExchangeRate>('/exchange-rates/current');
}

export async function fetchNearestRate(date: string): Promise<ExchangeRate> {
  return apiFetch<ExchangeRate>(`/exchange-rates/nearest?date=${encodeURIComponent(date)}`);
}

export async function fetchRates(from: string, to: string): Promise<ExchangeRate[]> {
  const params = new URLSearchParams({ from, to });
  const data = await apiFetch<{ rates: ExchangeRate[] }>(`/exchange-rates?${params}`);
  return data.rates ?? [];
}

export async function upsertRate(date: string, usd_to_crc: number): Promise<ExchangeRate> {
  return apiFetch<ExchangeRate>(`/exchange-rates/${date}`, {
    method: 'PUT',
    body: JSON.stringify({ usd_to_crc }),
  });
}

// ─── Budget ───────────────────────────────────────────────────────────────────

export async function fetchBudget(month: string): Promise<BudgetMonthAPI> {
  const data = await apiFetch<any>(`/budgets/${month}`);
  // Convert centimos → major units throughout
  const fromMinor = (n: number) => n / 100;
  data.ready_to_assign = fromMinor(data.ready_to_assign);
  data.total_underfunded = fromMinor(data.total_underfunded);
  for (const g of data.category_groups) {
    g.assigned  = fromMinor(g.assigned);
    g.activity  = fromMinor(g.activity);
    g.available = fromMinor(g.available);
    for (const c of g.categories) {
      c.assigned    = fromMinor(c.assigned);
      c.activity    = fromMinor(c.activity);
      c.carry_in    = fromMinor(c.carry_in);
      c.available   = fromMinor(c.available);
      c.underfunded = fromMinor(c.underfunded);
      if (c.target) c.target.amount = fromMinor(c.target.amount);
    }
  }
  return data as BudgetMonthAPI;
}

export async function setAssigned(month: string, categoryId: string, amount: number): Promise<void> {
  await apiFetch(`/budgets/${month}/categories/${categoryId}`, {
    method: 'PUT',
    body: JSON.stringify({ assigned: Math.round(amount * 100) }),
  });
}

export async function copyPreviousBudget(month: string): Promise<void> {
  await apiFetch(`/budgets/${month}/copy-previous`, { method: 'POST' });
}

export async function moveBudgetMoney(month: string, fromId: string, toId: string, amount: number): Promise<void> {
  await apiFetch(`/budgets/${month}/move`, {
    method: 'POST',
    body: JSON.stringify({
      from_category_id: fromId,
      to_category_id: toId,
      amount: Math.round(amount * 100),
    }),
  });
}

export async function upsertCategoryTarget(
  categoryId: string,
  target: { type: string; amount: number; deadline: string | null }
): Promise<void> {
  await apiFetch(`/categories/${categoryId}/target`, {
    method: 'PUT',
    body: JSON.stringify({
      type: target.type,
      amount: Math.round(target.amount * 100),
      deadline: target.deadline,
    }),
  });
}

export async function deleteCategoryTarget(categoryId: string): Promise<void> {
  await apiFetch(`/categories/${categoryId}/target`, { method: 'DELETE' });
}

// ─── Reports ─────────────────────────────────────────────────────────────────

interface SpendingApiMonth {
  month: string;
  groups: { name: string; total: number }[];
}

export const groupKey = (g: string) => g.toLowerCase().split(' ')[0];

export async function fetchSpendingReport(from: string, to: string): Promise<MonthlySpendingRow[]> {
  const data = await apiFetch<SpendingApiMonth[]>(
    `/reports/spending?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
  return data.map(m => {
    const row: MonthlySpendingRow = {
      month: m.month,
      housing: 0, food: 0, transport: 0, entertainment: 0, health: 0, savings: 0,
    };
    for (const g of m.groups) {
      const key = groupKey(g.name);
      if (key in row) (row as Record<string, string | number>)[key] = g.total;
    }
    return row;
  });
}

// fetchIncomeExpense returns raw centimos — callers divide by 100 before display.
export async function fetchIncomeExpense(
  from: string,
  to: string,
): Promise<{ month: string; income: number; expense: number }[]> {
  const data = await apiFetch<{ month: string; income: number; expense: number }[]>(
    `/reports/income-expense?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
  return data ?? [];
}

// fetchNetWorth returns raw centimos — callers divide by 100 before display.
export async function fetchNetWorth(
  from: string,
  to: string,
): Promise<{ month: string; net_worth: number }[]> {
  const data = await apiFetch<{ month: string; net_worth: number }[]>(
    `/reports/net-worth?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
  return data ?? [];
}

// fetchAgeOfMoney calls fetchBudget for the trailing `months` months in parallel
// and extracts age_of_money. Months where age_of_money is null are omitted.
export async function fetchAgeOfMoney(
  months: number,
): Promise<{ month: string; days: number }[]> {
  const now = new Date();
  const monthStrings: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthStrings.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    );
  }
  const budgets = await Promise.all(
    monthStrings.map(m => fetchBudget(m).catch(() => null))
  );
  return budgets
    .map((b, i) => ({ month: monthStrings[i], days: b?.age_of_money ?? null }))
    .filter((r): r is { month: string; days: number } => r.days !== null);
}

// ─── Recent Transactions ──────────────────────────────────────────────────────

export async function fetchRecentTransactions(limit: number): Promise<Transaction[]> {
  const accs = await fetchAccounts();
  const pages = await Promise.all(
    accs.budget.map(a => fetchAccountTransactions(a.id, 1, limit).catch(() => [] as Transaction[]))
  );
  return pages
    .flat()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

// ─── Import History ───────────────────────────────────────────────────────────

export interface ImportRecord {
  id: string;
  account_id: string;
  filename: string;
  imported_at: string;
  transaction_count: number;
  status: string;
}

export async function fetchImportHistory(): Promise<ImportRecord[]> {
  return apiFetch<ImportRecord[]>('/imports');
}

// ─── Payee Rules ──────────────────────────────────────────────────────────────

export interface PayeeRule {
  id: string;
  pattern: string;
  category_id: string;
  match_count: number;
}

export async function fetchPayeeRules(): Promise<PayeeRule[]> {
  const data = await apiFetch<{ id: string; payee_pattern: string; category_id: string; match_count: number }[]>('/payee-rules');
  return (data ?? []).map(r => ({ id: r.id, pattern: r.payee_pattern, category_id: r.category_id, match_count: r.match_count }));
}

export async function createPayeeRule(pattern: string, categoryId: string): Promise<PayeeRule> {
  const r = await apiFetch<{ id: string; payee_pattern: string; category_id: string; match_count: number }>('/payee-rules', {
    method: 'POST',
    body: JSON.stringify({ payee_pattern: pattern, category_id: categoryId }),
  });
  return { id: r.id, pattern: r.payee_pattern, category_id: r.category_id, match_count: r.match_count };
}

export async function updatePayeeRule(id: string, pattern: string, categoryId: string): Promise<PayeeRule> {
  const r = await apiFetch<{ id: string; payee_pattern: string; category_id: string; match_count: number }>(`/payee-rules/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ payee_pattern: pattern, category_id: categoryId }),
  });
  return { id: r.id, pattern: r.payee_pattern, category_id: r.category_id, match_count: r.match_count };
}

export async function deletePayeeRule(id: string): Promise<void> {
  return apiFetch(`/payee-rules/${id}`, { method: 'DELETE' });
}
