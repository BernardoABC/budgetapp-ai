// ─── Shared Types ─────────────────────────────────────────────────────────────

export interface Account {
  id: string;
  name: string;
  balance: number;        // major units (converted ÷100 from minor units at the boundary)
  type?: string;
  currency?: string;
  on_budget?: boolean;
  closed?: boolean;
  note?: string;
  sort_order?: number;
}

export interface CategoryGroup {
  id: string;
  name: string;
  categories: string[];
}

export interface Transaction {
  id: string;
  date: string;
  payee: string;
  category: string | null;
  memo: string;
  outflow: number;
  inflow: number;
  cleared: boolean;
  reconciled: boolean;
  account: string;
  currency?: string;
  exchange_rate?: number | null;
  splits?: { category: string; amount: number }[];
  transfer_peer_id?: string | null;
  transfer_peer_account_id?: string | null;
}

export interface MonthlySpendingRow {
  [key: string]: string | number;
  month: string;
  housing: number;
  food: number;
  transport: number;
  entertainment: number;
  health: number;
  savings: number;
}

export interface Target {
  type: 'monthly' | 'refill' | 'savings';
  amount: number;
  by?: string;
}

export interface CategoryItemAPI {
  id: string;
  name: string;
  currency: string;
  hidden: boolean;
  sort_order: number;
  is_system: boolean;
}

export interface CategoryGroupAPI {
  id: string;
  name: string;
  sort_order: number;
  hidden: boolean;
  is_system: boolean;
  categories: CategoryItemAPI[];
}

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
  highlight_page?: number | null;
}

export interface TxnFilterParams {
  search?: string;
  from_date?: string;
  to_date?: string;
  category_id?: string;   // UUID, "none", or omitted
  cleared?: boolean;
  min_amount?: number;    // absolute value in major units
  max_amount?: number;    // absolute value in major units
  flow_type?: 'inflow' | 'outflow';
  transfers?: 'only' | 'hide';
  sort?: string;          // date_desc | date_asc | amount_asc | amount_desc | payee_asc | ...
  page?: number;
  per_page?: number;
  highlight_id?: string;
}

function mapApiTxn(t: {
  id: string; date: string; payee: string; category: string | null; memo: string;
  cleared: boolean; account: string; currency: string; amount: number;
  exchange_rate?: number | null; reconciled?: boolean;
  splits?: { category: string; amount: number }[];
  transfer_peer_id?: string | null;
  transfer_peer_account_id?: string | null;
}): Transaction {
  const major = t.amount / 100;
  return {
    id: t.id, date: t.date, payee: t.payee, category: t.category,
    memo: t.memo, cleared: t.cleared, account: t.account,
    currency: t.currency, exchange_rate: t.exchange_rate,
    outflow: major < 0 ? -major : 0,
    inflow: major > 0 ? major : 0,
    reconciled: t.reconciled ?? false,
    splits: (t.splits ?? []).map(s => ({ category: s.category, amount: s.amount / 100 })),
    transfer_peer_id: t.transfer_peer_id ?? null,
    transfer_peer_account_id: t.transfer_peer_account_id ?? null,
  };
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
  if (filter.min_amount !== undefined) params.set('min_amount', String(Math.round(filter.min_amount * 100)));
  if (filter.max_amount !== undefined) params.set('max_amount', String(Math.round(filter.max_amount * 100)));
  if (filter.flow_type) params.set('flow_type', filter.flow_type);
  if (filter.transfers) params.set('transfers', filter.transfers);
  if (filter.sort) params.set('sort', filter.sort);
  if (filter.highlight_id) params.set('highlight_id', filter.highlight_id);
  params.set('page', String(filter.page ?? 1));
  params.set('per_page', String(filter.per_page ?? 50));

  type ApiTxn = Parameters<typeof mapApiTxn>[0];
  const data = await apiFetch<{
    transactions: ApiTxn[];
    pagination: TxnPage['pagination'];
    summary: { total_inflow: number; total_outflow: number; cleared_balance: number; uncleared_balance: number };
    highlight_page?: number | null;
  }>(`/accounts/${accountId}/transactions?${params}`);

  return {
    transactions: (data.transactions ?? []).map(mapApiTxn),
    pagination: data.pagination,
    highlight_page: data.highlight_page ?? null,
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

export async function createTransfer(body: {
  from_account_id: string;
  to_account_id: string;
  date: string;
  amount: number;   // major units; converted to centimos here
  memo?: string;
  cleared?: boolean;
}): Promise<{ from: Transaction; to: Transaction }> {
  const raw = await apiFetch<{ from: Record<string, unknown>; to: Record<string, unknown> }>('/transfers', {
    method: 'POST',
    body: JSON.stringify({ ...body, amount: Math.round(body.amount * 100) }),
  });
  return { from: mapApiTxn(raw.from as Parameters<typeof mapApiTxn>[0]), to: mapApiTxn(raw.to as Parameters<typeof mapApiTxn>[0]) };
}

export async function updateTransaction(
  id: string,
  body: {
    date?: string; payee?: string; category_id?: string; amount?: number;
    memo?: string; cleared?: boolean;
    splits?: { category_id: string; amount: number }[]; // amounts already in centimos
  },
): Promise<Transaction> {
  const payload = body.amount === undefined ? body : { ...body, amount: Math.round(body.amount * 100) };
  return apiFetch(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function deleteTransaction(id: string): Promise<void> {
  return apiFetch(`/transactions/${id}`, { method: 'DELETE' });
}

export async function fetchTransferCandidates(
  accountId: string,
  amount: number, // major units; converted to centimos
): Promise<Transaction[]> {
  const centimos = Math.round(amount * 100);
  const data = await apiFetch<{ transactions: Parameters<typeof mapApiTxn>[0][] }>(
    `/accounts/${accountId}/transfer-candidates?amount=${centimos}`
  );
  return (data.transactions ?? []).map(mapApiTxn);
}

export async function linkTransfer(
  transactionAId: string,
  transactionBId: string,
): Promise<{ from: Transaction; to: Transaction }> {
  const raw = await apiFetch<{ from: Parameters<typeof mapApiTxn>[0]; to: Parameters<typeof mapApiTxn>[0] }>(
    '/transfers/link',
    { method: 'POST', body: JSON.stringify({ transaction_a_id: transactionAId, transaction_b_id: transactionBId }) },
  );
  return { from: mapApiTxn(raw.from), to: mapApiTxn(raw.to) };
}

export async function linkTransferBatch(
  pairs: [string, string][],
): Promise<{ linked: number }> {
  return apiFetch('/transfers/link-batch', {
    method: 'POST',
    body: JSON.stringify({ pairs }),
  });
}

export type LinkOrCreatePair =
  | { source_id: string; target_id: string }
  | { source_id: string; target_account_id: string; target_payee: string; target_date: string; target_amount: number };

export async function linkOrCreateBatch(
  pairs: LinkOrCreatePair[],
): Promise<{ linked: number; created: number }> {
  return apiFetch('/transfers/link-or-create-batch', {
    method: 'POST',
    body: JSON.stringify({ pairs }),
  });
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

export async function reconcileAccount(
  accountId: string,
  adjustment: number, // major units; converted to centimos here
): Promise<{ reconciled_count: number }> {
  return apiFetch(`/accounts/${accountId}/reconcile`, {
    method: 'POST',
    body: JSON.stringify({ adjustment: Math.round(adjustment * 100) }),
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

export async function createCategory(body: { group_id: string; name: string; sort_order?: number; currency?: string }): Promise<CategoryItemAPI> {
  return apiFetch('/categories', { method: 'POST', body: JSON.stringify(body) });
}

export async function changeCategoryCurrency(id: string, currency: string): Promise<void> {
  await apiFetch(`/categories/${id}/currency`, { method: 'PUT', body: JSON.stringify({ currency }) });
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

export interface ActivityBreakdownEntry {
  currency: string;
  amount: number;
  converted_amount: number;
}

export interface BudgetCategoryAPI {
  id: string;
  name: string;
  currency: string;
  assigned: number;
  activity: number;
  carry_in: number;
  available: number;
  underfunded: number;
  target: { type: string; amount: number; deadline: string | null } | null;
  activity_breakdown: ActivityBreakdownEntry[];
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
  rta_breakdown: {
    crc_accounts: number;
    usd_accounts_in_crc: number;
    usd_accounts_native: number;
  };
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
  if (data.rta_breakdown) {
    data.rta_breakdown.crc_accounts = fromMinor(data.rta_breakdown.crc_accounts);
    data.rta_breakdown.usd_accounts_in_crc = fromMinor(data.rta_breakdown.usd_accounts_in_crc);
    data.rta_breakdown.usd_accounts_native = fromMinor(data.rta_breakdown.usd_accounts_native);
  }
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
      if (c.activity_breakdown) {
        for (const entry of c.activity_breakdown) {
          entry.amount = fromMinor(entry.amount);
          entry.converted_amount = fromMinor(entry.converted_amount);
        }
      }
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

// ─── Import Preview / Confirm ──────────────────────────────────────────────────
// Amounts are centimos (minor units) end-to-end — callers divide by 100 for display.

export interface ImportPreviewTxn {
  temp_id: string;
  date: string;
  amount: number;
  description_raw: string;
  description_normalized: string;
  reference: string;
  transaction_code: string;
  balance: number;
  suggested_category_id: string | null;
  suggested_confidence: string;
  duplicate_of: string | null;
  is_transfer: boolean;
}

export interface ImportFileInfo {
  filename: string;
  currency: string;
  iban: string;
  opening_balance: number;
  available_balance: number;
  statement_date: string;
  transaction_count: number;
  date_range: { from: string; to: string };
  total_inflow: number;
  total_outflow: number;
  currency_mismatch: boolean;
}

export interface ImportPreviewResponse {
  file_info: ImportFileInfo;
  transactions: ImportPreviewTxn[];
}

export interface ConfirmTxn {
  include: boolean;
  date: string;
  amount: number;
  description_raw: string;
  reference: string;
  category_id: string | null;
  payee_override: string | null;
  memo: string | null;
  is_transfer: boolean;
}

export interface ImportConfirmResponse {
  import_id: string;
  imported_count: number;
  skipped_count: number;
  new_rules_created: number;
  rules_updated: number;
  transfer_transaction_ids: string[];
}

// importPreview uploads the file as multipart/form-data. It does NOT use apiFetch
// because apiFetch forces Content-Type: application/json, which would corrupt the
// multipart boundary — the browser must set it from the FormData.
export async function importPreview(file: File, accountId: string): Promise<ImportPreviewResponse> {
  const form = new FormData();
  form.append('file', file);
  form.append('account_id', accountId);
  const res = await fetch(BASE + '/imports/preview', { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function importConfirm(
  accountId: string,
  filename: string,
  transactions: ConfirmTxn[],
  csvCurrency?: string,
): Promise<ImportConfirmResponse> {
  return apiFetch<ImportConfirmResponse>('/imports/confirm', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, filename, csv_currency: csvCurrency ?? '', transactions }),
  });
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

export async function fetchServerVersion(): Promise<string> {
  try {
    const r = await apiFetch<{ sha: string }>('/version');
    return r.sha;
  } catch {
    return '?';
  }
}
