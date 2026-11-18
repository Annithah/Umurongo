// Admin: hospital and queue settings.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import type { HospitalSettings } from '@umurongo/shared';
import { api, errorMessage } from '../../lib/api';
import { ErrorState, Field, Spinner } from '../../components/ui';
import { PageHeader, useAction } from '../common';

type Form = Omit<HospitalSettings, 'id'> & { retentionDays: number };

export default function SettingsPage() {
  const q = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [f, setF] = useState<Form | null>(null);
  useEffect(() => {
    if (q.data) {
      const { id: _id, ...rest } = q.data;
      setF(rest);
    }
  }, [q.data]);
  const save = useAction(() => api.saveSettings(f!), { invalidate: [['settings'], ['me'], ['smsTemplates']], success: 'Settings saved' });

  if (q.isLoading || !f) return q.isError ? <ErrorState text={errorMessage(q.error)} onRetry={() => q.refetch()} /> : <Spinner />;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const num = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

  return (
    <>
      <PageHeader title="Queue settings" subtitle="Changes apply at once to estimates, SMS and the no-show button." />
      <form
        className="grid max-w-4xl gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <section className="card grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="text-lg font-black text-navy sm:col-span-2">Hospital</h2>
          <Field label="Hospital name" id="h-name" help="Appears on tickets, the TV and the feedback SMS.">
            <input id="h-name" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={36} />
          </Field>
          <Field label="District" id="h-district">
            <input id="h-district" className="input" value={f.district} onChange={(e) => set('district', e.target.value)} />
          </Field>
          <Field label="SMS sender ID" id="h-sender" help="Up to 11 letters or digits, as registered with the SMS provider.">
            <input id="h-sender" className="input uppercase" value={f.smsSenderId} onChange={(e) => set('smsSenderId', e.target.value.toUpperCase())} maxLength={11} />
          </Field>
          <label className="flex min-h-touch items-center gap-2 self-end font-semibold">
            <input type="checkbox" className="h-5 w-5" checked={f.feedbackSmsEnabled} onChange={(e) => set('feedbackSmsEnabled', e.target.checked)} /> Ask for feedback by SMS after each visit
          </label>
        </section>

        <section className="card grid gap-4 p-5 sm:grid-cols-3">
          <h2 className="text-lg font-black text-navy sm:col-span-3">Queue</h2>
          <Field label="Default minutes per patient" id="q-avg" help="Used when a department has no own value.">
            <input id="q-avg" type="number" min={1} max={240} className="input" value={f.defaultConsultMinutes} onChange={num('defaultConsultMinutes')} />
          </Field>
          <Field label="Get-ready SMS at" id="q-ready" help="Sent once when this many people (or fewer) are ahead.">
            <input id="q-ready" type="number" min={1} max={20} className="input" value={f.getReadyAhead} onChange={num('getReadyAhead')} />
          </Field>
          <Field label="No-show after (minutes)" id="q-grace" help="Minutes after a call before no-show is possible.">
            <input id="q-grace" type="number" min={1} max={60} className="input" value={f.graceMinutes} onChange={num('graceMinutes')} />
          </Field>
        </section>

        <section className="card grid gap-4 p-5 sm:grid-cols-3">
          <h2 className="text-lg font-black text-navy sm:col-span-3">Privacy</h2>
          <Field label="Delete phone numbers after (days)" id="p-ret" help="The retention job removes phone numbers from tickets and SMS after this many days.">
            <input id="p-ret" type="number" min={1} max={365} className="input" value={f.retentionDays} onChange={num('retentionDays')} />
          </Field>
        </section>

        <div className="flex justify-end">
          <button className="btn-navy" disabled={save.isPending}>
            <Save size={18} aria-hidden /> Save settings
          </button>
        </div>
      </form>
    </>
  );
}
