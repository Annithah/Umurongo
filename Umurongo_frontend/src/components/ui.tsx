// Small shared UI pieces: dialog, toasts, live indicator, loading / empty / error states.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { useLiveState } from '../lib/socket';

// ─── Dialog (instead of browser alert/confirm) ──────────────────────────────

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card max-h-[90vh] w-full overflow-y-auto p-5 ${wide ? 'max-w-2xl' : 'max-w-md'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-xl font-black text-navy">{title}</h2>
          <button className="-m-2 rounded-lg p-2 text-muted hover:bg-sky" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Yes/no confirmation in an in-app dialog. */
export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel,
  cancelLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  text?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {text && <p className="text-muted">{text}</p>}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button className="btn-secondary" onClick={onClose}>
          {cancelLabel}
        </button>
        <button className={danger ? 'btn bg-red text-white hover:brightness-95' : 'btn-primary'} onClick={onConfirm} disabled={busy}>
          {busy && <Loader2 size={18} className="animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

// ─── Toasts ─────────────────────────────────────────────────────────────────

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}
const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { id, kind, text }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4500);
  }, []);
  const icons = { success: CheckCircle2, error: AlertTriangle, info: Info };
  const styles = { success: 'border-green bg-mint text-green-ink', error: 'border-red bg-red-bg text-red', info: 'border-navy/30 bg-sky text-navy' };
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 no-print" aria-live="polite">
        {toasts.map((t) => {
          const Icon = icons[t.kind];
          return (
            <div key={t.id} className={`pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-xl border px-4 py-3 font-semibold shadow-sm ${styles[t.kind]}`}>
              <Icon size={20} className="mt-0.5 shrink-0" />
              <span>{t.text}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ─── Live indicator ─────────────────────────────────────────────────────────

export function LiveBadge({ liveLabel = 'Live', offLabel = 'Reconnecting...', dark = false }: { liveLabel?: string; offLabel?: string; dark?: boolean }) {
  const live = useLiveState() === 'live';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
        live ? (dark ? 'bg-white/15 text-white' : 'bg-mint text-green-ink') : 'bg-amber-bg text-amber'
      }`}
      role="status"
    >
      <span className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-green' : 'bg-amber'}`} aria-hidden />
      {live ? liveLabel : offLabel}
    </span>
  );
}

// ─── States ─────────────────────────────────────────────────────────────────

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-muted" role="status">
      <Loader2 className="animate-spin" size={22} />
      {label && <span>{label}</span>}
    </div>
  );
}

export function ErrorState({ text, onRetry, retryLabel = 'Try again' }: { text: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="card flex flex-col items-center gap-3 p-6 text-center">
      <AlertTriangle className="text-red" size={28} />
      <p className="text-muted">{text}</p>
      {onRetry && (
        <button className="btn-secondary" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, text, children }: { icon?: ReactNode; text: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line px-6 py-10 text-center text-muted">
      {icon}
      <p>{text}</p>
      {children}
    </div>
  );
}

// ─── Form fields ────────────────────────────────────────────────────────────

/** Label + control + help or error text, wired for screen readers. */
export function Field({ label, id, error, help, children }: { label: string; id: string; error?: string | null; help?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm font-semibold text-red" role="alert">
          {error}
        </p>
      ) : help ? (
        <p id={`${id}-help`} className="mt-1 text-sm text-muted">
          {help}
        </p>
      ) : null}
    </div>
  );
}

/** A row of large choice buttons (a radio group). */
export function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 3,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  columns?: 2 | 3 | 4 | 5;
}) {
  const cols = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4', 5: 'grid-cols-2 sm:grid-cols-5' }[columns];
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className={`grid gap-2 ${cols}`} role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={`choice ${value === o.value ? 'choice-on' : ''}`} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// ─── Printing ───────────────────────────────────────────────────────────────

/** A copy of `children` placed directly under <body>: hidden on screen, the only thing printed by window.print(). */
export function Printable({ children }: { children: ReactNode }) {
  return createPortal(<div className="printable print-only">{children}</div>, document.body);
}
