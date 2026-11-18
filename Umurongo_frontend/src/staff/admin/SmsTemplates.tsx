// Admin: preview of every SMS the system sends, in both languages, with this hospital's names.
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { SMS_MAX_LENGTH } from '@umurongo/shared';
import { api, errorMessage } from '../../lib/api';
import { ErrorState, Spinner } from '../../components/ui';
import { Chip } from '../../components/StatusChip';
import { PageHeader } from '../common';

const WHEN: Record<string, string> = {
  JOINED: 'Registered at reception (with the patient link)',
  GET_READY: 'A few people ahead (queue setting "get ready")',
  CALLED: 'Called by a doctor or counter',
  NEXT_STEP: 'Sent to the lab, cashier or pharmacy',
  WAIT_CHANGED: 'No one is left to serve the line, or someone is back',
  FEEDBACK: 'Visit finished (if feedback SMS is on)',
  DAY_CLOSED: 'Department closed for the day with the patient still waiting',
};

export default function SmsTemplates() {
  const q = useQuery({ queryKey: ['smsTemplates'], queryFn: api.smsTemplates });
  return (
    <>
      <PageHeader
        title="SMS templates"
        subtitle={q.data ? `Sender ID ${q.data.senderId} · mode: ${q.data.mode === 'live' ? 'live SMS' : 'simulation (nothing is sent)'}` : undefined}
      />
      <p className="card mb-5 bg-sky p-4 text-sm">
        Every SMS must fit in one message of {SMS_MAX_LENGTH} plain characters, so a patient never receives a message in two parts. The check uses this hospital&apos;s longest department and room names. Kinyarwanda texts need a native check before the pilot.
      </p>
      {q.isLoading ? (
        <Spinner />
      ) : q.isError || !q.data ? (
        <ErrorState text={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {q.data.templates.map((t) => (
            <section key={`${t.template}-${t.language}`} className="card p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-black text-navy">
                    {t.template} · {t.language === 'RW' ? 'Kinyarwanda' : 'English'}
                  </h2>
                  <p className="text-sm text-muted">{WHEN[t.template]}</p>
                </div>
                {t.fits ? (
                  <Chip tone="green">
                    <CheckCircle2 size={14} aria-hidden /> One SMS
                  </Chip>
                ) : (
                  <Chip tone="red">
                    <AlertTriangle size={14} aria-hidden /> Too long
                  </Chip>
                )}
              </div>
              <p className="rounded-2xl rounded-tl-sm bg-sky px-4 py-3" lang={t.language === 'RW' ? 'rw' : 'en'}>
                {t.text}
              </p>
              <p className="mt-2 text-xs text-muted">
                {t.length} characters in this example · longest possible {t.worstLength}/{SMS_MAX_LENGTH}
              </p>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
