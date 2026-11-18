// Queue board: the ordered line of one department, who is being served, and (for reception)
// reorder with a reason, priority changes, cancel, reprint and search by ticket number or phone.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Ban, BellRing, Flag, Inbox, Printer, Search, X } from 'lucide-react';
import { formatRwandaPhone, type DepartmentQueue, type PriorityReason, type QueueEntry, type ReceptionEntry, type StaffMe } from '@umurongo/shared';
import { api, errorMessage } from '../lib/api';
import { duration, minutesBetween, mmss } from '../lib/format';
import { useLiveRefetch, useRooms } from '../lib/socket';
import { Choices, EmptyState, ErrorState, Printable, Spinner, useToast } from '../components/ui';
import { OpenChip, PRIORITY_REASON_LABEL, PriorityChip, StaffStatusChip, TicketStatusChip } from '../components/StatusChip';
import PrintTicket from '../components/PrintTicket';
import { ReasonDialog, ReorderDialog } from './ReasonDialog';
import NoShowButton from './NoShowButton';
import { PageHeader, isReception, useAction, useNow } from './common';

type Entry = QueueEntry & Partial<Pick<ReceptionEntry, 'phone' | 'publicToken'>>;

export default function QueueBoard({ me }: { me: StaffMe }) {
  const [params, setParams] = useSearchParams();
  const departments = useQuery({ queryKey: ['departments'], queryFn: api.departments });
  const deptId = params.get('d') ?? me.departmentId ?? departments.data?.find((d) => d.isOpen)?.id ?? '';
  const reception = isReception(me);

  const queue = useQuery({ queryKey: ['queue', deptId], queryFn: () => api.queue(deptId), enabled: !!deptId });
  useRooms([deptId && `department:${deptId}`]);
  useLiveRefetch(['queue:update', 'ticket:update', 'staff:status', 'config:changed'], [['queue', deptId], ['departments']]);

  return (
    <>
      <PageHeader
        title="Queue board"
        subtitle={reception ? 'Order, priority and search. Every change needs a reason and is logged.' : 'Live view of the line. Reception manages the order.'}
        actions={reception && <TicketSearch hospitalName={me.hospital.name} />}
      />

      <div className="mb-5 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Departments">
        {(departments.data ?? []).map((d) => (
          <button
            key={d.id}
            role="tab"
            aria-selected={d.id === deptId}
            className={`flex min-h-touch shrink-0 items-center gap-2 rounded-xl border px-4 font-bold transition ${d.id === deptId ? 'border-navy bg-navy text-white' : 'border-line bg-white text-navy hover:bg-sky'}`}
            onClick={() => setParams({ d: d.id }, { replace: true })}
          >
            {d.nameEn}
            <span className={`rounded-full px-2 text-sm ${d.id === deptId ? 'bg-white/20' : 'bg-sky'}`}>{d.waitingCount}</span>
          </button>
        ))}
      </div>

      {queue.isLoading || !deptId ? (
        <Spinner />
      ) : queue.isError ? (
        <ErrorState text={errorMessage(queue.error)} onRetry={() => queue.refetch()} />
      ) : queue.data ? (
        <Board data={queue.data} reception={reception} hospitalName={me.hospital.name} />
      ) : null}
    </>
  );
}

function Board({ data, reception, hospitalName }: { data: DepartmentQueue; reception: boolean; hospitalName: string }) {
  const { graceMinutes } = data;
  const now = useNow(15_000);
  const toast = useToast();
  const [moving, setMoving] = useState<{ ticket: Entry; direction: 'UP' | 'DOWN' } | null>(null);
  const [cancelling, setCancelling] = useState<Entry | null>(null);
  const [prioritising, setPrioritising] = useState<Entry | null>(null);
  const [printing, setPrinting] = useState<Entry | null>(null);
  const waiting = data.waiting as Entry[];
  const serving = data.serving as Entry[];
  const d = data.department;

  const noShow = useAction((id: string) => api.noShow(id), { invalidate: [['queue', d.id]], success: 'Marked as no-show' });
  const callAgain = useAction((id: string) => api.callAgain(id), { success: 'Called again on the TV' });

  useEffect(() => {
    if (printing) {
      const timer = setTimeout(() => {
        window.print();
        setPrinting(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [printing]);

  /** Within a priority group, can this ticket move? */
  const canMove = (i: number, dir: 'UP' | 'DOWN') => {
    const other = waiting[dir === 'UP' ? i - 1 : i + 1];
    return !!other && other.priority === waiting[i].priority;
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 className="text-xl font-black text-navy">{d.nameEn}</h2>
            <p className="text-sm text-muted">
              {d.waitingCount} waiting · {d.availableStaff} serving · {d.estimateMinutes === null ? 'no one available to serve' : `new patient waits about ${d.estimateMinutes} min`}
            </p>
          </div>
          <OpenChip open={d.isOpen} />
        </div>
        {waiting.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={<Inbox size={28} aria-hidden />} text="No one is waiting in this department." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Ticket</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Waiting</th>
                  {reception && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {waiting.map((t, i) => (
                  <tr key={t.id} className={i === 0 ? 'bg-mint/50' : undefined}>
                    <td className="px-4 py-3 font-bold text-muted">{i + 1}</td>
                    <td className="px-4 py-3">
                      <span className="ticket-number text-2xl">{t.number}</span>
                      {t.fromNumber && <span className="block text-xs text-muted">from {t.fromNumber}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-bold">{t.displayName}</span>
                      {reception && t.phone && <span className="block text-sm text-muted">{formatRwandaPhone(t.phone)}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <PriorityChip priority={t.priority} reason={t.priorityReason} />
                    </td>
                    <td className="px-4 py-3">
                      <TicketStatusChip status={t.status} />
                    </td>
                    <td className="px-4 py-3 tabular-nums">{duration(minutesBetween(t.joinedAt, new Date(now)))}</td>
                    {reception && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <IconButton label={`Move ${t.number} up`} disabled={!canMove(i, 'UP')} onClick={() => setMoving({ ticket: t, direction: 'UP' })}>
                            <ArrowUp size={18} />
                          </IconButton>
                          <IconButton label={`Move ${t.number} down`} disabled={!canMove(i, 'DOWN')} onClick={() => setMoving({ ticket: t, direction: 'DOWN' })}>
                            <ArrowDown size={18} />
                          </IconButton>
                          <IconButton label={`Change priority of ${t.number}`} onClick={() => setPrioritising(t)}>
                            <Flag size={18} />
                          </IconButton>
                          <IconButton label={`Reprint ${t.number}`} onClick={() => setPrinting(t)}>
                            <Printer size={18} />
                          </IconButton>
                          <IconButton label={`Cancel ${t.number}`} onClick={() => setCancelling(t)}>
                            <Ban size={18} />
                          </IconButton>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <aside className="space-y-4">
        <section className="card p-4">
          <h2 className="mb-3 text-lg font-black text-navy">Being served</h2>
          {serving.length === 0 ? (
            <p className="text-muted">No one is called right now.</p>
          ) : (
            <ul className="space-y-3">
              {serving.map((t) => (
                <li key={t.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="ticket-number text-2xl">{t.number}</p>
                      <p className="font-bold">{t.displayName}</p>
                      <p className="text-sm text-muted">
                        {t.roomName} · {t.staffName}
                      </p>
                    </div>
                    <TicketStatusChip status={t.status} />
                  </div>
                  {t.calledAt && (
                    <p className="mt-1 text-sm text-muted">
                      {t.status === 'CALLED' ? 'Called' : 'Started'} {mmss((now - new Date(t.status === 'CALLED' ? t.calledAt : (t.startedAt ?? t.calledAt)).getTime()) / 1000)} ago
                    </p>
                  )}
                  {reception && t.status === 'CALLED' && t.calledAt && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className="btn-secondary btn-sm" onClick={() => callAgain.mutate(t.id)} disabled={callAgain.isPending}>
                        <BellRing size={16} aria-hidden /> Call again
                      </button>
                      <NoShowButton small calledAt={t.calledAt} graceMinutes={graceMinutes} ticketNumber={t.number} busy={noShow.isPending} onConfirm={() => noShow.mutate(t.id)} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-4">
          <h2 className="mb-3 text-lg font-black text-navy">Team</h2>
          <ul className="space-y-2">
            {data.staff.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className="font-bold">{s.fullName}</span>
                  {s.roomName && <span className="text-sm text-muted"> · {s.roomName}</span>}
                </span>
                <StaffStatusChip status={s.status} />
              </li>
            ))}
          </ul>
        </section>
      </aside>

      <ReorderDialog
        ticket={moving?.ticket ?? null}
        direction={moving?.direction ?? 'UP'}
        onConfirm={async (reason) => {
          await api.reorder(moving!.ticket.id, moving!.direction, reason);
          toast(`${moving!.ticket.number} moved ${moving!.direction === 'UP' ? 'up' : 'down'}`);
        }}
        onClose={() => setMoving(null)}
      />
      <ReasonDialog
        open={!!cancelling}
        title={`Cancel ${cancelling?.number ?? ''}?`}
        intro={<p>The ticket ends. The patient&apos;s page shows that it was cancelled.</p>}
        confirmLabel="Cancel ticket"
        danger
        suggestions={['Patient went home', 'Registered twice', 'Sent to another hospital']}
        onConfirm={async (reason) => {
          await api.cancel(cancelling!.id, reason);
          toast(`${cancelling!.number} cancelled`);
        }}
        onClose={() => setCancelling(null)}
      />
      <PriorityDialog ticket={prioritising} onClose={() => setPrioritising(null)} />
      {printing?.publicToken && (
        <Printable>
          <PrintTicket
            t={{
              number: printing.number,
              displayName: printing.displayName,
              departmentNameRw: d.nameRw,
              departmentNameEn: d.nameEn,
              hospitalName,
              joinedAt: printing.joinedAt,
              patientUrl: `${window.location.origin}/t/${printing.publicToken}`,
            }}
          />
        </Printable>
      )}
    </div>
  );
}

function PriorityDialog({ ticket, onClose }: { ticket: Entry | null; onClose: () => void }) {
  const toast = useToast();
  const [priority, setPriority] = useState<'NORMAL' | 'PRIORITY' | 'EMERGENCY'>('NORMAL');
  const [reason, setReason] = useState<PriorityReason>('NONE');
  useEffect(() => {
    if (ticket) {
      setPriority(ticket.priority);
      setReason(ticket.priorityReason);
    }
  }, [ticket]);
  return (
    <ReasonDialog
      open={!!ticket}
      title={`Priority for ${ticket?.number ?? ''}`}
      confirmLabel="Save priority"
      suggestions={['Confirmed at the desk', 'Condition got worse', 'Set by mistake']}
      onConfirm={async (text) => {
        if (priority === 'PRIORITY' && reason === 'NONE') throw new Error('Choose why this patient has priority');
        await api.setPriority(ticket!.id, priority, priority === 'PRIORITY' ? reason : 'NONE', text);
        toast(`${ticket!.number} is now ${priority.toLowerCase()}`);
      }}
      onClose={onClose}
    >
      <div className="mb-4 space-y-3">
        <Choices
          label="Priority"
          value={priority}
          onChange={(p) => setPriority(p)}
          options={[
            { value: 'NORMAL', label: 'Normal' },
            { value: 'PRIORITY', label: 'Priority' },
            { value: 'EMERGENCY', label: 'Emergency' },
          ]}
        />
        {priority === 'PRIORITY' && (
          <Choices<PriorityReason>
            label="Why priority?"
            value={reason}
            onChange={setReason}
            columns={2}
            options={(['PREGNANT', 'ELDERLY', 'DISABILITY', 'CHILD_UNDER_5'] as const).map((r) => ({ value: r, label: PRIORITY_REASON_LABEL[r] }))}
          />
        )}
      </div>
    </ReasonDialog>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="flex h-11 w-11 items-center justify-center rounded-lg border border-line text-navy hover:bg-sky disabled:opacity-30" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** Search the last 24 hours by ticket number or phone (reception only). */
function TicketSearch({ hospitalName }: { hospitalName: string }) {
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState('');
  const results = useQuery({ queryKey: ['search', submitted], queryFn: () => api.search(submitted), enabled: submitted.length >= 2 });
  const [printing, setPrinting] = useState<ReceptionEntry | null>(null);
  const departments = useQuery({ queryKey: ['departments'], queryFn: api.departments });
  const deptOf = useMemo(() => new Map((departments.data ?? []).map((d) => [d.id, d])), [departments.data]);

  useEffect(() => {
    if (!printing) return;
    const timer = setTimeout(() => {
      window.print();
      setPrinting(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [printing]);

  return (
    <div className="relative">
      <form
        className="flex gap-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(text.trim());
        }}
      >
        <label htmlFor="ticket-search" className="sr-only">
          Search by ticket number or phone
        </label>
        <input id="ticket-search" className="input w-64" placeholder="Ticket number or phone" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn-secondary" aria-label="Search">
          <Search size={18} />
        </button>
      </form>
      {submitted.length >= 2 && (
        <div className="card absolute right-0 z-20 mt-2 w-[min(28rem,90vw)] p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-bold text-navy">Results for &quot;{submitted}&quot;</p>
            <button className="rounded-lg p-1 hover:bg-sky" aria-label="Close search" onClick={() => setSubmitted('')}>
              <X size={18} />
            </button>
          </div>
          {results.isLoading ? (
            <Spinner />
          ) : results.isError ? (
            <p className="text-red">{errorMessage(results.error)}</p>
          ) : results.data?.length ? (
            <ul className="divide-y divide-line">
              {results.data.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <p>
                      <span className="ticket-number text-xl">{t.number}</span> <span className="font-bold">{t.displayName}</span>
                    </p>
                    <p className="text-sm text-muted">
                      {deptOf.get(t.departmentId)?.nameEn} {t.phone ? `· ${formatRwandaPhone(t.phone)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <TicketStatusChip status={t.status} />
                    <IconButton label={`Reprint ${t.number}`} onClick={() => setPrinting(t)}>
                      <Printer size={18} />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">No ticket in the last 24 hours matches.</p>
          )}
        </div>
      )}
      {printing && (
        <Printable>
          <PrintTicket
            t={{
              number: printing.number,
              displayName: printing.displayName,
              departmentNameRw: deptOf.get(printing.departmentId)?.nameRw ?? '',
              departmentNameEn: deptOf.get(printing.departmentId)?.nameEn ?? '',
              hospitalName,
              joinedAt: printing.joinedAt,
              patientUrl: `${window.location.origin}/t/${printing.publicToken}`,
            }}
          />
        </Printable>
      )}
    </div>
  );
}
