import { useState, useCallback, useEffect } from 'react';
import { T, ACCENTS, applyAccent } from './theme';
import type { AccentKey } from './theme';
import { AppData } from './data';
import { fetchAccounts, fetchCategoryGroupsRaw, fetchCurrentRate } from './api';
import { AccountFormModal } from './components/AccountFormModal';
import type { Account, CategoryGroup } from './data';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { Budget } from './components/Budget';
import { Accounts } from './components/Accounts';
import { ImportWizard } from './components/Import';
import { Reports } from './components/Reports';


const TWEAK_DEFAULTS = { accent: 'mint' as AccentKey, density: 'comfortable' };

applyAccent(TWEAK_DEFAULTS.accent);

function fmt(amount: number, currency: string, rate: number): string {
  if (currency === 'USD') {
    const usd = amount / rate;
    return (amount < 0 ? '-' : '') + '$' + Math.abs(usd).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  const abs = Math.abs(Math.round(amount));
  return (amount < 0 ? '-' : '') + '₡' + abs.toLocaleString('en-US');
}

interface Tweaks { accent: AccentKey; density: string; }

function TweaksPanel({ tweaks, updateTweak, onClose }: { tweaks: Tweaks; updateTweak: (k: keyof Tweaks, v: string) => void; onClose: () => void }) {
  return (
    <div style={twk.root}>
      <div style={twk.header}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text, letterSpacing: '-0.01em' }}>Tweaks</span>
        <button onClick={onClose} style={twk.close}>✕</button>
      </div>
      <div style={twk.body}>
        <div>
          <div style={twk.label}>Accent</div>
          <div style={{ display: 'flex', gap: 9 }}>
            {(Object.entries(ACCENTS) as [AccentKey, typeof ACCENTS[AccentKey]][]).map(([k, a]) => (
              <button key={k} onClick={() => updateTweak('accent', k)} title={k}
                style={{ width: 26, height: 26, borderRadius: '50%', background: a.c, border: 'none', cursor: 'pointer', boxShadow: tweaks.accent === k ? `0 0 0 2px ${T.surface2}, 0 0 0 4px ${a.c}, 0 0 12px ${a.glow}` : 'none', transition: 'box-shadow 0.15s' }} />
            ))}
          </div>
        </div>
        <div>
          <div style={twk.label}>Row Density</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['compact', 'comfortable'].map(d => (
              <button key={d} onClick={() => updateTweak('density', d)} style={{ ...twk.pill, ...(tweaks.density === d ? twk.pillOn : {}) }}>
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const saved = (() => { try { return JSON.parse(localStorage.getItem('budgetapp-nav') ?? '{}'); } catch { return {}; } })();
  const [currency, setCurrency] = useState<string>(saved.currency ?? 'USD');
  const [page, setPage] = useState<string>(saved.page ?? 'dashboard');
  // Live data — fetched from API
  const [accounts, setAccounts] = useState<{ budget: Account[]; tracking: Account[] }>({
    budget:   AppData.accounts.budget,
    tracking: AppData.accounts.tracking,
  });
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>(AppData.categoryGroups);
  const [categoryIdByName, setCategoryIdByName] = useState<Record<string, string>>({});
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [exchangeRate, setExchangeRate] = useState<number>(AppData.exchangeRate);
  const [exchangeRateDate, setExchangeRateDate] = useState<string>(AppData.exchangeRateDate);

  const reloadCategories = useCallback(() => {
    fetchCategoryGroupsRaw()
      .then(rawGroups => {
        const idMap: Record<string, string> = {};
        rawGroups.forEach(g => g.categories.forEach(c => { idMap[c.name] = c.id; }));
        setCategoryIdByName(idMap);
        setCategoryGroups(rawGroups.map(g => ({
          id: g.id,
          name: g.name,
          categories: g.categories.map(c => c.name),
        })));
      })
      .catch(err => console.warn('Failed to load categories:', err.message));
  }, []);

  const reloadAccounts = useCallback(() => {
    fetchAccounts()
      .then(setAccounts)
      .catch(err => console.warn('Failed to load accounts:', err.message));
  }, []);

  useEffect(() => {
    Promise.all([fetchAccounts(), fetchCategoryGroupsRaw(), fetchCurrentRate()])
      .then(([accs, rawGroups, rate]) => {
        setAccounts(accs);
        setExchangeRate(rate.usd_to_crc);
        setExchangeRateDate(
          new Date(rate.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        );
        const idMap: Record<string, string> = {};
        rawGroups.forEach(g => g.categories.forEach(c => { idMap[c.name] = c.id; }));
        setCategoryIdByName(idMap);
        setCategoryGroups(rawGroups.map(g => ({
          id: g.id,
          name: g.name,
          categories: g.categories.map(c => c.name),
        })));
      })
      .catch(err => console.warn('API unavailable, using static data:', err.message));
  }, []);

  // Still static
  const { monthlySpending } = AppData;
  const transactions = AppData.transactions;

  const [accountId, setAccountId] = useState<string>(saved.accountId ?? AppData.accounts.budget[0].id);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [tweaks, setTweaks] = useState<Tweaks>(TWEAK_DEFAULTS);

  const navigate = useCallback((p: string, aid?: string) => {
    setPage(p);
    if (aid) setAccountId(aid);
    localStorage.setItem('budgetapp-nav', JSON.stringify({ page: p, accountId: aid ?? accountId, currency }));
  }, [accountId, currency]);

  const handleCurrencyChange = (c: string) => {
    setCurrency(c);
    localStorage.setItem('budgetapp-nav', JSON.stringify({ page, accountId, currency: c }));
  };

  const updateTweak = (key: keyof Tweaks, val: string) => {
    const next = { ...tweaks, [key]: val };
    setTweaks(next);
    if (key === 'accent') applyAccent(val as AccentKey);
  };

  const fmtBound = (amount: number) => fmt(amount, currency, exchangeRate);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg, backgroundImage: T.bgGrad, position: 'relative' }}>
      <Layout currentPage={page} currentAccountId={accountId} onNavigate={navigate} currency={currency} onCurrencyChange={handleCurrencyChange} accounts={accounts} exchangeRate={exchangeRate} exchangeRateDate={exchangeRateDate} fmt={fmtBound} onAddAccount={() => setShowAddAccount(true)}>
        <div key={page + accountId} style={{ animation: 'fadeUp 0.32s cubic-bezier(0.22, 1, 0.36, 1)' }}>
          {page === 'dashboard' && <Dashboard transactions={transactions} categoryGroups={categoryGroups} fmt={fmtBound} onNavigate={navigate} />}
          {page === 'budget' && <Budget categoryGroups={categoryGroups} fmt={fmtBound} currency={currency} density={tweaks.density} categoryIdByName={categoryIdByName} onCategoriesChanged={reloadCategories} />}
          {page === 'accounts' && <Accounts accounts={accounts} accountId={accountId} categoryGroups={categoryGroups} fmt={fmtBound} density={tweaks.density} categoryIdByName={categoryIdByName} onAccountsChanged={reloadAccounts} />}
          {page === 'import' && <ImportWizard accounts={accounts} categoryGroups={categoryGroups} onNavigate={navigate} />}
          {page === 'reports' && <Reports monthlySpending={monthlySpending} fmt={fmtBound} />}
        </div>
      </Layout>

      <button onClick={() => setTweaksOpen(o => !o)} style={twk.fab} title="Tweaks">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" stroke="currentColor" strokeWidth="1.8"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="1.8"/></svg>
      </button>

      {tweaksOpen && <TweaksPanel tweaks={tweaks} updateTweak={updateTweak} onClose={() => setTweaksOpen(false)} />}

      {showAddAccount && (
        <AccountFormModal
          onClose={() => setShowAddAccount(false)}
          onCreated={acc => {
            setAccounts(prev => ({
              ...prev,
              budget:   acc.on_budget ? [...prev.budget, acc]   : prev.budget,
              tracking: acc.on_budget ? prev.tracking : [...prev.tracking, acc],
            }));
            setShowAddAccount(false);
          }}
        />
      )}
    </div>
  );
}

export default App;

const twk = {
  root:   { position: 'fixed' as const, bottom: 22, right: 22, width: 268, background: T.surface2, border: `1px solid ${T.borderHi}`, borderRadius: T.radius, boxShadow: '0 24px 60px -16px rgba(0,0,0,0.85)', zIndex: 9999, overflow: 'hidden', backdropFilter: 'blur(12px)' },
  header: { padding: '12px 16px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)' },
  close:  { background: 'none', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: 13, padding: 4 },
  body:   { padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 16 },
  label:  { fontSize: 10.5, fontWeight: 700, color: T.textDim, marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' as const },
  pill:   { flex: 1, padding: '6px 8px', fontSize: 12.5, border: `1px solid ${T.border}`, borderRadius: 7, background: T.surface, cursor: 'pointer', color: T.textMid, fontWeight: 600, transition: 'all 0.12s' },
  pillOn: { background: T.accentDim, borderColor: 'var(--accent)', color: 'var(--accent)' },
  fab:    { position: 'fixed' as const, bottom: 84, right: 26, width: 40, height: 40, borderRadius: '50%', background: T.surface2, border: `1px solid ${T.borderHi}`, color: T.textDim, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: T.shadow, zIndex: 9998 },
};
