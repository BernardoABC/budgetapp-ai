import { createContext, useContext, useState, useCallback, useMemo, type ReactNode, type CSSProperties } from 'react';
import { T } from '../theme';

type Severity = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: string; severity: Severity; }
interface ToastApi {
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => setItems(xs => xs.filter(x => x.id !== id)), []);
  const push = useCallback((message: string, severity: Severity) => {
    const id = nextId++;
    setItems(xs => [...xs, { id, message, severity }]);
    setTimeout(() => remove(id), 4000);
  }, [remove]);

  const api = useMemo<ToastApi>(() => ({
    success: m => push(m, 'success'),
    error: m => push(m, 'error'),
    info: m => push(m, 'info'),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div style={ts.container}>
        {items.map(item => (
          <div key={item.id} style={{ ...ts.toast, ...ts.bySeverity[item.severity] }}>
            <span style={{ flex: 1 }}>{item.message}</span>
            <button onClick={() => remove(item.id)} style={ts.close}>✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const ts = {
  container: { position: 'fixed' as const, bottom: 22, left: 22, display: 'flex', flexDirection: 'column' as const, gap: 8, zIndex: 10000 },
  toast: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 240, maxWidth: 380, padding: '11px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: T.text, background: T.surface2, border: `1px solid ${T.borderHi}`, boxShadow: '0 16px 40px -12px rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', animation: 'fadeUp 0.22s cubic-bezier(0.22, 1, 0.36, 1)' },
  bySeverity: {
    success: { borderColor: 'var(--accent)', boxShadow: `0 0 0 1px var(--accent), 0 16px 40px -12px rgba(0,0,0,0.7)` },
    error: { borderColor: T.neg, color: T.neg },
    info: {},
  } as Record<Severity, CSSProperties>,
  close: { background: 'none', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: 12, padding: 2 },
};
