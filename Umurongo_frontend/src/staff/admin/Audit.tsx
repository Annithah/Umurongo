// Admin: audit log. Who did what, when and why. Read-only.
import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { clock, shortDate } from '../../lib/format';
import { EmptyState, ErrorState, Spinner } from '../../components/ui';
import { PageHeader } from '../common';

const ACTION_LABEL: Record<string, string> = {
  REGISTERED: 'Registered',
  CALLED: 'Called',
  CALLED_AGAIN: 'Called again',
  STARTED: 'Started',
  FINISHED: 'Finished',
  REFERRED: 'Referred',
  NEXT_STEP_CREATED: 'Next-step ticket',
  NO_SHOW: 'No-show',
  CANCELLED: 'Cancelled',
  MOVED_UP: 'Moved up',
  MOVED_DOWN: 'Moved down',
  PRIORITY_CHANGED: 'Priority changed',
  STAFF_STATUS: 'Staff status',
  DAY_CLOSED: 'Closed at end of day',
  SIGNED_IN: 'Signed in',
  SETTINGS_UPDATED: 'Settings changed',
  DEPARTMENT_CREATED: 'Department added',
  DEPARTMENT_UPDATED: 'Department changed',
  ROOM_CREATED: 'Room added',
  ROOM_UPDATED: 'Room changed',
  STAFF_INVITED: 'Staff invited',
  STAFF_UPDATED: 'Staff changed',
  STAFF_DEACTIVATED: 'Staff deactivated',
  STAFF_INVITE_RENEWED: 'Invite renewed',
  INVITE_ACCEPTED: 'Invite accepted',
  RETENTION_RUN: 'Phone numbers removed',
  JOB_RUN_MANUAL: 'Job run by hand',
};

export default function Audit() {
  const [ticket, setTicket] = useState('');
  const [action, setAction] = useState('');
  const [filters, setFilters] = useState<{ ticket?: string; action?: string }>({});
  const q = useInfiniteQuery({
    queryKey: ['audit', filters],
    queryFn: ({ pageParam }) => api.audit({ ...filters, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length === 100 ? last[last.length - 1].at : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every queue action, status change and admin change, with who did it and why." />
      <form
        className="mb-5 flex flex-wrap gap-3"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ticket: ticket.trim() || undefined, action: action || undefined });
        }}
      >
        <label className="sr-only" htmlFor="audit-ticket">
          Ticket number
        </label>
        <input id="audit-ticket" className="input w-48" placeholder="Ticket, e.g. OPD-024" value={ticket} onChange={(e) => setTicket(e.target.value)} />
        <label className="sr-only" htmlFor="audit-action">
          Action
        </label>
        <select id="audit-action" className="input w-56" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {Object.entries(ACTION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className="btn-secondary">
          <Search size={18} aria-hidden /> Filter
        </button>
      </form>
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState text={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState text="Nothing matches." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3">What</th>
                <th className="px-4 py-3">Ticket</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-sm tabular-nums">
                    {shortDate(r.at)} {clock(r.at, true)}
                  </td>
                  <td className="px-4 py-2 text-sm font-semibold">{r.actorName ?? 'Removed account'}</td>
                  <td className="px-4 py-2 text-sm">{ACTION_LABEL[r.action] ?? r.action}</td>
                  <td className="px-4 py-2">{r.ticketNumber && <span className="ticket-number text-base">{r.ticketNumber}</span>}</td>
                  <td className="px-4 py-2 text-sm">{r.reason}</td>
                  <td className="px-4 py-2 text-xs text-muted">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.hasNextPage && (
            <div className="border-t border-line p-3 text-center">
              <button className="btn-secondary btn-sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                Load older entries
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
