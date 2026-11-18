// My queue: for clinicians and for lab, cashier and pharmacy counters.
// Never shows phone numbers (the API does not send them to these roles).
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, BellRing, CheckCheck, Inbox, Loader2, Megaphone, Play } from 'lucide-react';
import { STAFF_STATUSES, type MyQueueView, type StaffStatus } from '@umurongo/shared';
import { api, errorMessage } from '../lib/api';
import { duration, minutesBetween, mmss } from '../lib/format';
import { useLiveRefetch, useRooms } from '../lib/socket';
import { Dialog, EmptyState, ErrorState, Spinner, useToast } from '../components/ui';
import { PriorityChip, STAFF_STATUS_LABEL, STAFF_STATUS_TONE, StaffStatusChip } from '../components/StatusChip';
import NoShowButton from './NoShowButton';
import { PageHeader, useAction, useNow } from './common';

const KEY = ['myQueue'];

export default function MyQueue() {
  const q = useQuery({ queryKey: KEY, queryFn: api.myQueue });
  useRooms([q.data?.me.departmentId && `department:${q.data.me.departmentId}`]);
  useLiveRefetch(['queue:update', 'ticket:update', 'staff:status', 'config:changed'], [KEY]);

  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState text={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  return <Desk data={q.data} />;
}

function Desk({ data }: { data: MyQueueView }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const set = (v: MyQueueView) => queryClient.setQueryData(KEY, v);
  const [referring, setReferring] = useState(false);
  const { me, current, queue } = data;

  const status = useAction((s: StaffStatus) => api.setStatus(me.id, s), { invalidate: [KEY, ['me']], success: (r) => `You are now: ${STAFF_STATUS_LABEL[r.status]}` });
  const callNext = useAction(() => api.callNext(), { invalidate: [KEY] });
  const start = useAction(() => api.start(), { invalidate: [KEY, ['me']] });
  const finish = useAction(() => api.finish(), { invalidate: [KEY, ['me']], success: 'Finished' });
  const noShow = useAction(() => api.myNoShow(), { invalidate: [KEY], success: 'Marked as no-show' });
  const again = useAction(() => api.myCallAgain(), { success: 'Called again on the TV' });
  const busy = callNext.isPending || start.isPending || finish.isPending || noShow.isPending;
  const offDuty = !['AVAILABLE', 'IN_CONSULTATION'].includes(me.status);

  return (
    <>
      <PageHeader
        title="My queue"
        subtitle={`${me.departmentNameEn ?? ''}${me.roomName ? ` · ${me.roomName}` : ''}`}
        actions={
          <div className="card flex items-center gap-3 px-4 py-2">
            <CheckCheck size={20} className="text-green-ink" aria-hidden />
            <span>
              <span className="font-heading text-2xl font-black">{data.todayCount}</span> <span className="text-muted">seen today</span>
            </span>
          </div>
        }
      />

      <section className="card mb-6 p-4" aria-label="My status">
        <p className="label">My status</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" role="radiogroup" aria-label="My status">
          {STAFF_STATUSES.map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={me.status === s}
              className={`choice ${me.status === s ? (STAFF_STATUS_TONE[s] === 'green' ? 'choice-on' : 'border-2 border-navy bg-sky text-navy') : ''}`}
              onClick={() => me.status !== s && status.mutate(s)}
              disabled={status.isPending}
            >
              <StatusDot status={s} /> {STAFF_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        {offDuty && <p className="mt-3 rounded-xl bg-amber-bg p-3 font-semibold text-amber">Patients see that you are not available, and their estimates count without you.</p>}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="card p-5 lg:p-6" aria-label="Current patient">
          {current ? (
            <CurrentPatient data={data} busy={busy} onStart={() => start.mutate(undefined, { onSuccess: set })} onFinish={() => finish.mutate(undefined, { onSuccess: set })} onRefer={() => setReferring(true)} onNoShow={() => noShow.mutate(undefined, { onSuccess: set })} onCallAgain={() => again.mutate(undefined)} />
          ) : (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-lg text-muted">{queue.length ? `${queue.length} waiting. Call the next patient when you are ready.` : 'No one is waiting right now.'}</p>
            </div>
          )}
          <div className="mt-6 border-t border-line pt-5">
            <button
              className="btn-primary w-full py-4 text-xl"
              disabled={busy || !queue.length || current?.status === 'CALLED' || offDuty}
              onClick={() =>
                callNext.mutate(undefined, {
                  onSuccess: (r) => {
                    set(r);
                    if (r.called) toast(`Called ${r.called.number}`);
                  },
                })
              }
            >
              {callNext.isPending ? <Loader2 size={24} className="animate-spin" /> : <Megaphone size={24} aria-hidden />}
              {current?.status === 'IN_CONSULTATION' ? 'Finish and call next' : 'Call next'}
            </button>
            {current?.status === 'CALLED' && <p className="mt-2 text-center text-sm text-muted">Start, finish or mark no-show before calling the next patient.</p>}
            {offDuty && <p className="mt-2 text-center text-sm text-muted">Set your status to Available to call patients.</p>}
          </div>
        </section>

        <section className="card overflow-hidden" aria-label="Waiting">
          <h2 className="border-b border-line px-4 py-3 text-lg font-black text-navy">Waiting ({queue.length})</h2>
          {queue.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={<Inbox size={28} aria-hidden />} text="The line is empty." />
            </div>
          ) : (
            <ol className="divide-y divide-line">
              {queue.slice(0, 12).map((t, i) => (
                <li key={t.id} className={`flex items-center justify-between gap-2 px-4 py-3 ${i === 0 ? 'bg-mint/50' : ''}`}>
                  <div className="min-w-0">
                    <p>
                      <span className="ticket-number text-xl">{t.number}</span> <span className="font-bold">{t.displayName}</span>
                    </p>
                    <p className="text-sm text-muted">
                      waiting {duration(minutesBetween(t.joinedAt))}
                      {t.fromNumber ? ` · from ${t.fromNumber}` : ''}
                    </p>
                  </div>
                  {t.priority !== 'NORMAL' && <PriorityChip priority={t.priority} reason={t.priorityReason} />}
                </li>
              ))}
              {queue.length > 12 && <li className="px-4 py-3 text-sm text-muted">and {queue.length - 12} more</li>}
            </ol>
          )}
        </section>
      </div>

      <ReferDialog open={referring} targets={data.nextStepTargets} ticketNumber={current?.number ?? ''} onClose={() => setReferring(false)} onDone={set} />
    </>
  );
}

function StatusDot({ status }: { status: StaffStatus }) {
  const dot = { green: 'bg-green', amber: 'bg-amber', red: 'bg-red', grey: 'bg-grey', navy: 'bg-navy' }[STAFF_STATUS_TONE[status]];
  return <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />;
}

function CurrentPatient({
  data,
  busy,
  onStart,
  onFinish,
  onRefer,
  onNoShow,
  onCallAgain,
}: {
  data: MyQueueView;
  busy: boolean;
  onStart: () => void;
  onFinish: () => void;
  onRefer: () => void;
  onNoShow: () => void;
  onCallAgain: () => void;
}) {
  const t = data.current!;
  const now = useNow();
  const since = t.status === 'CALLED' ? t.calledAt : (t.startedAt ?? t.calledAt);
  return (
    <div className="animate-fadein">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-muted">{t.status === 'CALLED' ? 'Called, waiting for the patient' : 'In consultation'}</p>
          <p className="ticket-number text-ticket-md" data-testid="current-number">
            {t.number}
          </p>
          <p className="text-2xl font-black text-ink">{t.displayName}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <PriorityChip priority={t.priority} reason={t.priorityReason} />
            {t.fromNumber && <span className="text-sm text-muted">from {t.fromNumber}</span>}
          </div>
          {t.note && <p className="mt-2 rounded-xl bg-sky p-3 text-sm">Note from the previous step: {t.note}</p>}
        </div>
        <div className="text-right" aria-live="off">
          <p className="text-sm font-bold text-muted">{t.status === 'CALLED' ? 'Since call' : 'Consultation time'}</p>
          <p className="font-heading text-4xl font-black tabular-nums text-navy" data-testid="since-call">
            {since ? mmss((now - new Date(since).getTime()) / 1000) : '-'}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {t.status === 'CALLED' && (
          <>
            <button className="btn-navy" onClick={onStart} disabled={busy}>
              <Play size={20} aria-hidden /> Start
            </button>
            <button className="btn-secondary" onClick={onCallAgain} disabled={busy}>
              <BellRing size={20} aria-hidden /> Call again
            </button>
            {t.calledAt && <NoShowButton calledAt={t.calledAt} graceMinutes={data.graceMinutes} ticketNumber={t.number} busy={busy} onConfirm={onNoShow} />}
          </>
        )}
        <button className="btn-secondary" onClick={onFinish} disabled={busy}>
          <CheckCheck size={20} aria-hidden /> Finish
        </button>
        <button className="btn-secondary" onClick={onRefer} disabled={busy}>
          <ArrowRightLeft size={20} aria-hidden /> Refer
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm text-muted">
        <StaffStatusChip status={data.me.status} /> Your status changes to In consultation when you start, and back when you finish.
      </div>
    </div>
  );
}

function ReferDialog({
  open,
  targets,
  ticketNumber,
  onClose,
  onDone,
}: {
  open: boolean;
  targets: MyQueueView['nextStepTargets'];
  ticketNumber: string;
  onClose: () => void;
  onDone: (v: MyQueueView) => void;
}) {
  const toast = useToast();
  const [departmentId, setDepartmentId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      const first = targets.find((t) => t.isOpen && t.kind === 'LAB') ?? targets.find((t) => t.isOpen);
      setDepartmentId(first?.id ?? '');
      setNote('');
      setError(null);
      setBusy(false);
    }
  }, [open, targets]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.refer(departmentId, note.trim() || undefined);
      onDone(r);
      toast(`${ticketNumber} sent to ${targets.find((t) => t.id === departmentId)?.nameEn}`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Next step for ${ticketNumber}`}>
      <p className="mb-3 text-muted">The patient gets a new ticket in that department and sees where to go.</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Destination department">
        {targets.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={departmentId === t.id} disabled={!t.isOpen} className={`choice ${departmentId === t.id ? 'choice-on' : ''}`} onClick={() => setDepartmentId(t.id)}>
            {t.nameEn}
            {!t.isOpen && <span className="text-xs text-muted">(closed)</span>}
          </button>
        ))}
      </div>
      <label htmlFor="refer-note" className="label mt-4">
        Note for the next step (optional, no medical details)
      </label>
      <input id="refer-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Blood test, urgent" />
      {error && (
        <p className="mt-3 rounded-xl bg-red-bg p-3 text-sm font-semibold text-red" role="alert">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-navy" disabled={!departmentId || busy} onClick={submit}>
          {busy && <Loader2 size={18} className="animate-spin" />} Refer
        </button>
      </div>
    </Dialog>
  );
}
