// No-show: disabled until the grace period after the call has passed, with a live countdown.
// The API enforces the same rule; this only makes it visible.
import { useEffect, useState } from 'react';
import { UserX } from 'lucide-react';
import { secondsUntilNoShow } from '@umurongo/shared';
import { mmss } from '../lib/format';
import { ConfirmDialog } from '../components/ui';

export default function NoShowButton({
  calledAt,
  graceMinutes,
  ticketNumber,
  onConfirm,
  busy = false,
  small = false,
}: {
  calledAt: string;
  graceMinutes: number;
  ticketNumber: string;
  onConfirm: () => void;
  busy?: boolean;
  small?: boolean;
}) {
  const [left, setLeft] = useState(() => secondsUntilNoShow(calledAt, new Date(), graceMinutes));
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const tick = () => setLeft(secondsUntilNoShow(calledAt, new Date(), graceMinutes));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [calledAt, graceMinutes]);

  const waiting = left > 0;
  return (
    <>
      <button
        type="button"
        className={`btn-danger ${small ? 'btn-sm' : ''}`}
        disabled={waiting || busy}
        onClick={() => setConfirming(true)}
        aria-describedby={waiting ? `noshow-${ticketNumber}` : undefined}
      >
        <UserX size={small ? 16 : 20} aria-hidden />
        {waiting ? (
          <span>
            No-show in <span className="tabular-nums">{mmss(left)}</span>
          </span>
        ) : (
          'No-show'
        )}
      </button>
      {waiting && (
        <span id={`noshow-${ticketNumber}`} className="sr-only">
          No-show is possible {graceMinutes} minutes after the call.
        </span>
      )}
      <ConfirmDialog
        open={confirming}
        title={`Mark ${ticketNumber} as no-show?`}
        text="The patient did not come after being called. Their ticket ends and the next patient can be called."
        confirmLabel="Mark no-show"
        cancelLabel="Keep waiting"
        danger
        busy={busy}
        onConfirm={() => {
          setConfirming(false);
          onConfirm();
        }}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
