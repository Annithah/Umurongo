// Waiting-time analytics: where patients wait, when they come, no-shows, feedback, 30-day trend.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { addDays, kigaliDate, type AnalyticsView } from '@umurongo/shared';
import { api, errorMessage } from '../lib/api';
import { duration, percent, shortDate } from '../lib/format';
import { ErrorState, Spinner, useToast } from '../components/ui';
import { BarChart, ChartCard, LineChart, PointsTable, StatTile } from './charts';
import { PageHeader } from './common';

const RANGES = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
] as const;

export default function Analytics() {
  const toast = useToast();
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('7d');
  const [departmentId, setDepartmentId] = useState('');
  const [exporting, setExporting] = useState(false);
  const to = kigaliDate();
  const from = addDays(to, -(RANGES.find((r) => r.key === range)!.days - 1));
  const params = { from, to, departmentId: departmentId || undefined };
  const departments = useQuery({ queryKey: ['departments'], queryFn: api.departments });
  const q = useQuery({ queryKey: ['analytics', params], queryFn: () => api.analytics(params), placeholderData: (prev) => prev });

  async function exportCsv() {
    setExporting(true);
    try {
      const { blob, filename } = await api.analyticsCsv(params);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="From the time stamps of every ticket. No names or phone numbers are used."
        actions={
          <button className="btn-secondary" onClick={exportCsv} disabled={exporting}>
            {exporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} aria-hidden />} Export CSV
          </button>
        }
      />

      {/* Filters: one row above the charts */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl border border-line bg-white p-1" role="radiogroup" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r.key} role="radio" aria-checked={range === r.key} className={`min-h-[38px] rounded-lg px-4 font-bold ${range === r.key ? 'bg-navy text-white' : 'text-navy hover:bg-sky'}`} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="analytics-dept">
          Department
        </label>
        <select id="analytics-dept" className="input w-64" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">All departments</option>
          {(departments.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.nameEn}
            </option>
          ))}
        </select>
        {q.isFetching && <Loader2 size={18} className="animate-spin text-muted" aria-label="Loading" />}
      </div>

      {q.isLoading ? <Spinner /> : q.isError || !q.data ? <ErrorState text={errorMessage(q.error)} onRetry={() => q.refetch()} /> : <Dashboard a={q.data} days={RANGES.find((r) => r.key === range)!.days} />}
    </>
  );
}

function Dashboard({ a, days }: { a: AnalyticsView; days: number }) {
  const waits = a.stages.filter((s) => s.stage === 'WAIT' && s.count > 0).sort((x, y) => (y.medianMinutes ?? 0) - (x.medianMinutes ?? 0));
  const services = new Map(a.stages.filter((s) => s.stage === 'SERVICE').map((s) => [s.departmentCode, s]));
  const hours = a.perHour.slice(6, 21).map((h) => ({ label: `${h.hour}`, value: h.count / days, detail: `${String(h.hour).padStart(2, '0')}:00 to ${String(h.hour + 1).padStart(2, '0')}:00` }));
  const trendTickets = a.trend.map((d) => ({ label: shortDate(d.date), value: d.tickets, detail: d.date }));
  const trendWait = a.trend.map((d) => ({ label: shortDate(d.date), value: d.medianWaitMinutes, detail: d.date }));
  const maxWait = Math.max(1, ...waits.map((w) => w.p90Minutes ?? 0));
  const busiest = a.perHour.reduce((best, h) => (h.count > best.count ? h : best), a.perHour[0]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Tickets" value={String(a.totals.tickets)} note={`${a.totals.visits} visits`} />
        <StatTile label="Median visit time" value={a.medianVisitMinutes === null ? '-' : duration(a.medianVisitMinutes)} note={`${a.totals.completedVisits} completed visits`} />
        <StatTile label="No-show rate" value={percent(a.totals.noShowRate)} note={`${a.totals.noShows} no-shows`} />
        <StatTile label="Satisfied (SMS)" value={percent(a.feedback.score)} note={`${a.feedback.yes} yes, ${a.feedback.no} no, of ${a.feedback.asked} asked`} />
        <StatTile label="Busiest hour" value={busiest && busiest.count ? `${String(busiest.hour).padStart(2, '0')}:00` : '-'} note="tickets created" />
      </div>

      <section className="card p-5">
        <h2 className="text-lg font-black text-navy">Where patients wait</h2>
        <p className="mb-4 text-sm text-muted">Median wait from joining the line to being called, per department. The light end of each bar shows the 90th percentile.</p>
        {waits.length === 0 ? (
          <p className="text-muted">No patient has been called in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead className="table-head">
                <tr>
                  <th className="px-3 py-2">Department</th>
                  <th className="w-1/2 px-3 py-2">Wait to be called</th>
                  <th className="px-3 py-2 text-right">Median</th>
                  <th className="px-3 py-2 text-right">90% within</th>
                  <th className="px-3 py-2 text-right">Service time</th>
                  <th className="px-3 py-2 text-right">Patients</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {waits.map((w) => (
                  <tr key={w.departmentCode}>
                    <td className="px-3 py-2 font-bold">{w.departmentNameEn}</td>
                    <td className="px-3 py-2">
                      <div className="relative h-3 rounded-full bg-sky" aria-hidden>
                        <div className="absolute inset-y-0 left-0 rounded-full bg-mint" style={{ width: `${((w.p90Minutes ?? 0) / maxWait) * 100}%` }} />
                        <div className="absolute inset-y-0 left-0 rounded-full bg-green" style={{ width: `${((w.medianMinutes ?? 0) / maxWait) * 100}%` }} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{w.medianMinutes === null ? '-' : duration(w.medianMinutes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{w.p90Minutes === null ? '-' : duration(w.p90Minutes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{services.get(w.departmentCode)?.medianMinutes == null ? '-' : duration(services.get(w.departmentCode)!.medianMinutes!)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{w.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard
          title="Patients per hour"
          subtitle={days > 1 ? `Average tickets per hour of the day, over ${days} days` : 'Tickets per hour today'}
          table={<PointsTable points={hours} labelHead="Hour" valueHead="Tickets" format={(v) => v.toFixed(1)} />}
        >
          <BarChart points={hours} label="Patients per hour of the day" format={(v) => (v < 10 ? v.toFixed(1) : String(Math.round(v)))} />
        </ChartCard>
        <ChartCard title="Tickets per day" subtitle="Last 30 days" table={<PointsTable points={trendTickets} labelHead="Date" valueHead="Tickets" />}>
          <LineChart points={trendTickets} label="Tickets per day, last 30 days" tone="green" />
        </ChartCard>
        <ChartCard title="Median wait per day" subtitle="Minutes from joining to being called, last 30 days" table={<PointsTable points={trendWait} labelHead="Date" valueHead="Minutes" format={(v) => v.toFixed(1)} />}>
          <LineChart points={trendWait} label="Median wait per day in minutes" format={(v) => `${Math.round(v)}`} />
        </ChartCard>
        <ChartCard
          title="No-show rate per day"
          subtitle="Share of called patients who did not come, last 30 days"
          table={<PointsTable points={a.trend.map((d) => ({ label: shortDate(d.date), value: d.noShowRate, detail: d.date }))} labelHead="Date" valueHead="No-show rate" format={(v) => percent(v)} />}
        >
          <LineChart points={a.trend.map((d) => ({ label: shortDate(d.date), value: d.noShowRate === null ? null : d.noShowRate * 100, detail: d.date }))} label="No-show rate per day in percent" format={(v) => `${Math.round(v)}%`} />
        </ChartCard>
      </div>
    </div>
  );
}
