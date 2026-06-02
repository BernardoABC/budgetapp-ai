import type {
  Account,
  Transaction,
  CategoryGroup,
  CategoryGroupAPI,
  CategoryItemAPI,
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
  const list: Account[] = await apiFetch('/accounts');
  return {
    budget:   list.filter(a => a.on_budget && !a.closed),
    tracking: list.filter(a => !a.on_budget && !a.closed),
  };
}

export async function createAccount(body: {
  name: string; type: string; currency: string; balance: number; on_budget: boolean; note?: string;
}): Promise<Account> {
  return apiFetch('/accounts', { method: 'POST', body: JSON.stringify(body) });
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

export async function fetchAccountTransactions(
  accountId: string,
  page = 1,
  perPage = 200,
): Promise<Transaction[]> {
  const data: { transactions: Transaction[] } = await apiFetch(
    `/accounts/${accountId}/transactions?page=${page}&per_page=${perPage}`,
  );
  return data.transactions ?? [];
}

export async function createTransaction(
  accountId: string,
  body: { date: string; payee: string; category_id?: string; amount: number; memo?: string; cleared?: boolean },
): Promise<Transaction> {
  return apiFetch(`/accounts/${accountId}/transactions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateTransaction(
  id: string,
  body: { date?: string; payee?: string; category_id?: string; amount?: number; memo?: string; cleared?: boolean },
): Promise<Transaction> {
  return apiFetch(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export async function deleteTransaction(id: string): Promise<void> {
  return apiFetch(`/transactions/${id}`, { method: 'DELETE' });
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
