// SMS messages: the simulated SMS feed (SMS_MODE=simulate) and, for the demo, a way to reply
// as a patient and to move the queue along.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FastForward, MessageSquareReply, RotateCcw, Smartphone } from 'lucide-react';
import type { StaffMe } from '@umurongo/shared';
import { api, errorMessage } from '../lib/api';
import { clock } from '../lib/format';
import { useLiveRefetch } from '../lib/socket';
import { ConfirmDialog, EmptyState, ErrorState, Field, Spinner } from '../components/ui';
import { Chip } from '../components/StatusChip';
import { PageHeader, isAdmin, useAction } from './common';

const TONE = { SIMULATED: 'navy', QUEUED: 'amber', SENT: 'green', DELIVERED: 'green', FAILED: 'red' } as const;

export default function SmsPanel({ me }: { me: StaffMe }) {
  const q = useQuery({ queryKey: ['devSms'], queryFn: api.devSms });
  useLiveRefetch(['sms:changed'], [['devSms']]);
  const [phone, setPhone] = useState('');
  const [text, setText] = useState('1');
  const [resetting, setResetting] = useState(false);

  const reply = useAction(() => api.devReply(phone, text), {
    invalidate: [['devSms']],
    success: (r) => (r.matched ? (r.answer ? `Feedback saved: ${r.answer === 'YES' ? 'yes' : 'no'}` : 'Reply received, but it is not 1 or 2') : 'No visit is waiting for feedback from this number'),
  });
  const advance = useAction(() => api.devAdvance(), { success: (r) => (r.log.length ? r.log.slice(0, 3).join(' · ') : 'Nothing to move') });
  const reset = useAction(() => api.devReset(), { success: 'Demo data restored' });

  return (
    <>
      <PageHeader
        title="SMS messages"
        subtitle={q.data?.simulated ? 'Simulation: no SMS leaves the server. Every message the system would send is shown here.' : 'Live SMS: messages are sent by the SMS provider.'}
        actions={
          isAdmin(me) && (
            <>
              <button className="btn-secondary" onClick={() => advance.mutate(undefined)} disabled={advance.isPending}>
                <FastForward size={18} aria-hidden /> Advance queue
              </button>
              <button className="btn-secondary" onClick={() => setResetting(true)}>
                <RotateCcw size={18} aria-hidden /> Reset demo
              </button>
            </>
          )
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="card overflow-hidden">
          {q.isLoading ? (
            <Spinner />
          ) : q.isError ? (
            <ErrorState text={errorMessage(q.error)} onRetry={() => q.refetch()} />
          ) : !q.data?.messages.length ? (
            <div className="p-5">
              <EmptyState icon={<Smartphone size={28} aria-hidden />} text="No SMS yet. Register a walk-in with a phone number." />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {q.data.messages.map((m) => (
                <li key={m.id} className="flex gap-4 p-4">
                  <div className="w-32 shrink-0 text-sm">
                    <p className="font-bold">{m.to || 'removed'}</p>
                    <p className="text-muted">{clock(m.at)}</p>
                    {m.ticketNumber && <p className="ticket-number text-base">{m.ticketNumber}</p>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="rounded-2xl rounded-tl-sm bg-sky px-4 py-2">{m.body}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Chip tone={TONE[m.status as keyof typeof TONE] ?? 'grey'}>{m.status.toLowerCase()}</Chip>
                      {m.template} · {m.language} · {m.body.length} characters
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside>
          <form
            className="card space-y-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              reply.mutate(undefined);
            }}
          >
            <h2 className="flex items-center gap-2 text-lg font-black text-navy">
              <MessageSquareReply size={20} aria-hidden /> Reply as a patient
            </h2>
            <p className="text-sm text-muted">After a visit ends, the patient gets a feedback SMS. Reply 1 for yes or 2 for no, from the same number.</p>
            <Field label="From phone" id="reply-phone">
              <input id="reply-phone" className="input" inputMode="tel" placeholder="0788 123 456" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Message" id="reply-text">
              <input id="reply-text" className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={160} />
            </Field>
            <button className="btn-navy w-full" disabled={!phone.trim() || !text.trim() || reply.isPending}>
              Send reply
            </button>
          </form>
        </aside>
      </div>
      <ConfirmDialog
        open={resetting}
        title="Reset the demo?"
        text="All tickets, SMS and changes are replaced with the demo data. Use this before a demo, never in a real hospital."
        confirmLabel="Reset demo"
        cancelLabel="Cancel"
        danger
        busy={reset.isPending}
        onConfirm={() => reset.mutate(undefined, { onSettled: () => setResetting(false) })}
        onClose={() => setResetting(false)}
      />
    </>
  );
}
