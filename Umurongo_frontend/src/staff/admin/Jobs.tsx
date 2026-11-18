// Admin: background jobs (SMS outbox, daily close, data retention) and their recent runs.
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { clock, shortDate } from '../../lib/format';
import { EmptyState, ErrorState, Spinner } from '../../components/ui';
import { Chip } from '../../components/StatusChip';
import { PageHeader, useAction } from '../common';

const JOBS = [
  { name: 'sms-outbox', label: 'SMS outbox', text: 'Sends queued SMS and retries failures (every 15 seconds). Does nothing in simulation mode.' },
  { name: 'daily-close', label: 'Daily close', text: 'At closing time, closes waiting tickets and sends the next opening time (checked every minute).' },
  { name: 'retention', label: 'Data retention', text: 'Removes phone numbers older than the retention period from tickets and SMS (every hour).' },
];

export default function Jobs() {
  const runs = useQuery({ queryKey: ['jobs'], queryFn: api.jobs, refetchInterval: 15_000 });
  const run = useAction((name: string) => api.runJob(name), { invalidate: [['jobs']], success: 'Job finished' });
  return (
    <>
      <PageHeader title="Background jobs" subtitle="These run by themselves. Run one now to check it." />
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        {JOBS.map((j) => (
          <section key={j.name} className="card flex flex-col gap-3 p-4">
            <h2 className="font-black text-navy">{j.label}</h2>
            <p className="flex-1 text-sm text-muted">{j.text}</p>
            <button className="btn-secondary btn-sm self-start" onClick={() => run.mutate(j.name)} disabled={run.isPending}>
              <Play size={16} aria-hidden /> Run now
            </button>
          </section>
        ))}
      </div>
      <section className="card overflow-x-auto">
        <h2 className="border-b border-line px-4 py-3 text-lg font-black text-navy">Recent runs</h2>
        {runs.isLoading ? (
          <Spinner />
        ) : runs.isError ? (
          <ErrorState text={errorMessage(runs.error)} />
        ) : !runs.data?.length ? (
          <div className="p-4">
            <EmptyState text="No runs logged yet. Runs that do nothing are not logged (except retention)." />
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-left">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Result</th>
                <th className="px-4 py-3">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs.data.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-sm tabular-nums">
                    {shortDate(r.startedAt)} {clock(r.startedAt, true)}
                  </td>
                  <td className="px-4 py-2 font-bold">{JOBS.find((j) => j.name === r.job)?.label ?? r.job}</td>
                  <td className="px-4 py-2">{r.ok ? <Chip tone="green">OK</Chip> : <Chip tone="red">Failed</Chip>}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">{r.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
