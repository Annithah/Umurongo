// In-app dialogs that require a reason (it goes into the audit log): reorder, cancel, priority change.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import { Dialog } from '../components/ui';
import { errorMessage } from '../lib/api';

export const MIN_REASON = 3;
export const MAX_REASON = 200;

export function ReasonDialog({
  open,
  title,
  intro,
  confirmLabel,
  suggestions = [],
  danger = false,
  children,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  intro?: ReactNode;
  confirmLabel: string;
  suggestions?: string[];
  danger?: boolean;
  children?: ReactNode;
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const trimmed = reason.trim();
  const valid = trimmed.length >= MIN_REASON && trimmed.length <= MAX_REASON;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(trimmed);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} noValidate>
        {intro && <div className="mb-4 text-muted">{intro}</div>}
        {children}
        <label htmlFor="reason" className="label">
          Reason (required, saved in the audit log)
        </label>
        <textarea
          id="reason"
          className="input min-h-[88px] py-2"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={MAX_REASON}
          aria-invalid={!!error}
          aria-describedby="reason-help"
        />
        <p id="reason-help" className="mt-1 text-sm text-muted">
          {trimmed.length < MIN_REASON ? `At least ${MIN_REASON} characters.` : `${trimmed.length}/${MAX_REASON}`}
        </p>
        {suggestions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Common reasons">
            {suggestions.map((s) => (
              <button key={s} type="button" className="btn-secondary btn-sm" onClick={() => setReason(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {error && (
          <p className="mt-3 rounded-xl bg-red-bg p-3 text-sm font-semibold text-red" role="alert">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={danger ? 'btn-danger' : 'btn-navy'} disabled={!valid || busy}>
            {busy && <Loader2 size={18} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export const REORDER_REASONS = ['Patient is very weak', 'Back from the lab with results', 'Stepped out when called', 'Doctor asked for this patient'];

/** Move a ticket one place up or down in its priority group. A reason is required. */
export function ReorderDialog({
  ticket,
  direction,
  onConfirm,
  onClose,
}: {
  ticket: { number: string; displayName: string } | null;
  direction: 'UP' | 'DOWN';
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <ReasonDialog
      open={!!ticket}
      title={`Move ${ticket?.number ?? ''} ${direction === 'UP' ? 'up' : 'down'}`}
      intro={
        <p className="flex items-center gap-2">
          {direction === 'UP' ? <ArrowUp size={18} aria-hidden /> : <ArrowDown size={18} aria-hidden />}
          {ticket?.displayName} swaps places with the patient {direction === 'UP' ? 'in front' : 'behind'}. Priority groups stay in order.
        </p>
      }
      confirmLabel={direction === 'UP' ? 'Move up' : 'Move down'}
      suggestions={REORDER_REASONS}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
