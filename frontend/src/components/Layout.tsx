import { useState } from 'react';
import { T } from '../theme';
import type { Account } from '../api';

interface SidebarProps {
  currentPage: string;
  currentAccountId: string;
  onNavigate: (page: string, accountId?: string) => void;
  accounts: { budget: Account[]; tracking: Account[] };
  exchangeRate: number;
  exchangeRateDate: string;
  fmt: (n: number, txnCurrency?: string) => string;
  onAddAccount?: () => void;
}

function Logo() {
  return (
    <div style={st.logo}>
      <div style={st.logoMark}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M4 13.5 L9.5 8 L13.5 12 L20 5" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="20" cy="5" r="2.4" fill="var(--accent)" />
        </svg>
      </div>
      <span style={st.logoText}>budget<span style={{ color: 'var(--accent)' }}>app</span></span>
    </div>
  );
}

function NavItem({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...st.navItem, ...(active ? st.navActive : hover ? st.navHover : {}) }}>
      {active && <span style={st.navBar} />}
      <span style={{ ...st.navIcon, color: active ? 'var(--accent)' : T.textDim }}>{icon}</span>
      {label}
    </button>
  );
}

const ICONS = {
  dashboard: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="1.8"/><rect x="13.5" y="3" width="7.5" height="4.5" rx="1.6" stroke="currentColor" strokeWidth="1.8"/><rect x="13.5" y="10.5" width="7.5" height="10.5" rx="1.6" stroke="currentColor" strokeWidth="1.8"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="1.8"/></svg>,
  budget: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M3 12h18M3 18h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  reports: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 19V5M4 19h16M8 15l3.5-4 3 2.5L20 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

function Sidebar({ currentPage, currentAccountId, onNavigate, accounts, exchangeRate, exchangeRateDate, fmt, onAddAccount }: SidebarProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const totalBudget = accounts.budget.reduce((s, a) => s + a.balance, 0);

  const AccountRow = ({ acc }: { acc: Account }) => {
    const active = currentPage === 'accounts' && currentAccountId === acc.id;
    const isHov = hovered === acc.id;
    return (
      <button onClick={() => onNavigate('accounts', acc.id)}
        onMouseEnter={() => setHovered(acc.id)} onMouseLeave={() => setHovered(null)}
        style={{ ...st.accItem, ...(active ? st.accActive : isHov ? st.navHover : {}) }}>
        {active && <span style={st.navBar} />}
        <span style={{ ...st.dot, background: active ? 'var(--accent)' : T.textFaint }} />
        <span style={{ ...st.accName, color: active ? T.text : T.textMid }}>{acc.name}</span>
        {acc.currency && <span style={st.currBadge}>{acc.currency}</span>}
        <span style={{ ...st.accBal, color: acc.balance < 0 ? T.neg : active ? T.text : T.textDim }}>{fmt(acc.balance, acc.currency)}</span>
      </button>
    );
  };

  return (
    <aside style={st.sidebar}>
      <Logo />
      <div style={st.scroll}>
        <nav style={{ padding: '4px 12px 8px' }}>
          <NavItem active={currentPage === 'dashboard'} onClick={() => onNavigate('dashboard')} icon={ICONS.dashboard} label="Dashboard" />
          <NavItem active={currentPage === 'budget'} onClick={() => onNavigate('budget')} icon={ICONS.budget} label="Budget" />
          <NavItem active={currentPage === 'cashflow'} onClick={() => onNavigate('cashflow')} icon={ICONS.reports} label="Cash Flow" />
          <NavItem active={currentPage === 'reports'} onClick={() => onNavigate('reports')} icon={ICONS.reports} label="Reports" />
        </nav>
        <div style={st.section}>
          <div style={st.sectionHead}>
            <span style={st.groupLabel}>Budget Accounts</span>
            <span style={st.groupTotal}>{fmt(totalBudget)}</span>
          </div>
          {accounts.budget.map(acc => <AccountRow key={acc.id} acc={acc} />)}
        </div>
        <div style={st.section}>
          <div style={st.sectionHead}><span style={st.groupLabel}>Tracking</span></div>
          {accounts.tracking.map(acc => <AccountRow key={acc.id} acc={acc} />)}
        </div>
        <button onClick={onAddAccount} onMouseEnter={() => setHovered('add')} onMouseLeave={() => setHovered(null)}
          style={{ ...st.addBtn, color: hovered === 'add' ? 'var(--accent)' : T.textDim, borderColor: hovered === 'add' ? T.borderHi : T.border }}>
          + Add Account
        </button>
      </div>
      <div style={st.footer}>
        <span style={st.fxDot} />
        <div>
          <div style={{ color: T.textMid, fontWeight: 600 }}>₡{exchangeRate.toFixed(2)} <span style={{ color: T.textFaint }}>/ $1</span></div>
          <div style={{ color: T.textFaint, fontSize: 9.5, marginTop: 1 }}>BCCR · updated {exchangeRateDate}</div>
        </div>
      </div>
    </aside>
  );
}

interface HeaderProps {
  currency: string;
  onCurrencyChange: (c: string) => void;
  onNavigate: (page: string) => void;
  page: string;
}

function Header({ currency, onCurrencyChange, onNavigate, page }: HeaderProps) {
  const titles: Record<string, string> = { dashboard: 'Overview', budget: 'Budget', accounts: 'Account', import: 'Import Transactions', reports: 'Reports' };
  return (
    <header style={st.header}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={st.crumb}>{titles[page] ?? 'Overview'}</span>
      </div>
      <div style={st.headerCenter}>
        <div style={st.pill}>
          {['CRC', 'USD'].map(c => (
            <button key={c} onClick={() => onCurrencyChange(c)} style={{ ...st.pillBtn, ...(currency === c ? st.pillOn : {}) }}>
              {c === 'CRC' ? '₡ CRC' : '$ USD'}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button onClick={() => onNavigate('import')} style={st.importBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 16V4M12 4 7 9M12 4l5 5M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Import
        </button>
      </div>
    </header>
  );
}

interface LayoutProps {
  currentPage: string;
  currentAccountId: string;
  onNavigate: (page: string, accountId?: string) => void;
  currency: string;
  onCurrencyChange: (c: string) => void;
  accounts: { budget: Account[]; tracking: Account[] };
  exchangeRate: number;
  exchangeRateDate: string;
  fmt: (n: number, txnCurrency?: string) => string;
  children: React.ReactNode;
  onAddAccount?: () => void;
}

export function Layout({ currentPage, currentAccountId, onNavigate, currency, onCurrencyChange, accounts, exchangeRate, exchangeRateDate, fmt, children, onAddAccount }: LayoutProps) {
  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: T.sans, color: T.text }}>
      <Sidebar currentPage={currentPage} currentAccountId={currentAccountId} onNavigate={onNavigate} accounts={accounts} exchangeRate={exchangeRate} exchangeRateDate={exchangeRateDate} fmt={fmt} onAddAccount={onAddAccount} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Header currency={currency} onCurrencyChange={onCurrencyChange} onNavigate={onNavigate} page={currentPage} />
        <main style={{ flex: 1, overflowY: 'auto' }}>{children}</main>
      </div>
    </div>
  );
}

const st = {
  sidebar:     { width: 248, minWidth: 248, background: T.sidebar, borderRight: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  logo:        { display: 'flex', alignItems: 'center', gap: 10, padding: '18px 20px 14px' },
  logoMark:    { width: 30, height: 30, borderRadius: 9, background: T.accentDim, border: `1px solid ${T.borderHi}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 18px var(--accent-glow)' },
  logoText:    { fontSize: 16.5, fontWeight: 800, color: T.text, letterSpacing: '-0.03em' },
  scroll:      { flex: 1, overflowY: 'auto' as const, paddingBottom: 8 },
  navItem:     { position: 'relative' as const, display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left' as const, padding: '9px 14px', marginBottom: 2, background: 'none', border: 'none', borderRadius: 9, color: T.textMid, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.13s' },
  navActive:   { background: T.accentDim, color: T.text },
  navHover:    { background: 'rgba(255,255,255,0.04)', color: T.text },
  navIcon:     { display: 'flex', transition: 'color 0.13s' },
  navBar:      { position: 'absolute' as const, left: -12, top: '50%', transform: 'translateY(-50%)', width: 3, height: 18, borderRadius: 3, background: 'var(--accent)', boxShadow: '0 0 10px var(--accent-glow)' },
  section:     { padding: '6px 12px 2px', marginTop: 8 },
  sectionHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '4px 10px 6px' },
  groupLabel:  { fontSize: 10, fontWeight: 700, color: T.textDim, letterSpacing: '0.12em', textTransform: 'uppercase' as const },
  groupTotal:  { fontSize: 10.5, fontFamily: T.mono, color: T.textDim, fontWeight: 500 },
  accItem:     { position: 'relative' as const, display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 10px', marginBottom: 1, background: 'none', border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left' as const, transition: 'all 0.12s' },
  accActive:   { background: T.accentDim },
  dot:         { width: 6, height: 6, borderRadius: '50%', flexShrink: 0, transition: 'background 0.12s' },
  accName:     { fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 },
  accBal:      { fontSize: 11, fontFamily: T.mono, fontWeight: 500, flexShrink: 0 },
  currBadge:   { fontSize: 9.5, fontWeight: 600, color: T.textFaint, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: '1px 5px', letterSpacing: '0.04em', flexShrink: 0 },
  addBtn:      { display: 'block', width: 'calc(100% - 24px)', margin: '8px 12px 0', padding: '8px 12px', background: 'none', border: `1px dashed ${T.border}`, borderRadius: 9, fontSize: 12.5, cursor: 'pointer', textAlign: 'center' as const, fontWeight: 600, transition: 'all 0.13s' },
  footer:      { display: 'flex', alignItems: 'center', gap: 9, padding: '13px 20px', borderTop: `1px solid ${T.border}`, fontSize: 11, fontFamily: T.mono },
  fxDot:       { width: 7, height: 7, borderRadius: '50%', background: T.pos, boxShadow: `0 0 8px ${T.pos}`, flexShrink: 0 },
  header:      { height: 58, background: 'rgba(10,14,21,0.7)', backdropFilter: 'blur(14px)', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', padding: '0 24px', flexShrink: 0, position: 'relative' as const, zIndex: 10 },
  crumb:       { fontSize: 15, fontWeight: 700, color: T.text, letterSpacing: '-0.02em' },
  headerCenter:{ flex: 1, display: 'flex', justifyContent: 'center' },
  pill:        { display: 'flex', background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}`, borderRadius: 9, padding: 3, gap: 2 },
  pillBtn:     { padding: '4px 13px', fontSize: 12, fontWeight: 600, background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer', color: T.textDim, transition: 'all 0.14s' },
  pillOn:      { background: T.accentDim, color: 'var(--accent)' },
  importBtn:   { display: 'flex', alignItems: 'center', gap: 7, padding: '8px 15px', fontSize: 13, fontWeight: 700, background: 'var(--accent)', color: '#06140d', border: 'none', borderRadius: 9, cursor: 'pointer', boxShadow: '0 0 20px var(--accent-glow)', transition: 'transform 0.1s' },
};
