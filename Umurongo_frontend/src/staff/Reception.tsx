// Reception desk: register a walk-in, print the ticket, and see every department at a glance.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock, Loader2, Printer, UserPlus, Users } from 'lucide-react';
import { isValidDisplayName, normalizeRwandaPhone, type DepartmentSummary, type Language, type Priority, type PriorityReason, type RegisterResult, type StaffMe } from '@umurongo/shared';
import { api } from '../lib/api';
import { useLiveRefetch } from '../lib/socket';
import { Choices, EmptyState, ErrorState, Field, Printable, Spinner } from '../components/ui';
import { OpenChip, PRIORITY_REASON_LABEL } from '../components/StatusChip';
import PrintTicket from '../components/PrintTicket';
import { PageHeader, useAction } from './common';

type PriorityChoice = 'NORMAL' | 'PRIORITY' | 'EMERGENCY';
const REASONS: PriorityReason[] = ['PREGNANT', 'ELDERLY', 'DISABILITY', 'CHILD_UNDER_5'];

export default function Reception({ me }: { me: StaffMe }) {
  const departments = useQuery({ queryKey: ['departments'], queryFn: api.departments });
  useLiveRefetch(['queue:update', 'staff:status', 'config:changed'], [['departments']]);
  const [result, setResult] = useState<RegisterResult | null>(null);

  return (
    <>
      <PageHeader title="Reception desk" subtitle="Register walk-ins and give them a ticket." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          {departments.isLoading ? (
            <Spinner />
          ) : departments.isError ? (
            <ErrorState text="Could not load departments." onRetry={() => departments.refetch()} />
          ) : (
            <RegisterForm departments={departments.data ?? []} onDone={setResult} />
          )}
        </div>
        <aside className="space-y-6">
          {result ? <RegisterResultCard result={result} hospitalName={me.hospital.name} onNext={() => setResult(null)} /> : <LastTicketHint />}
          <DepartmentsAtAGlance departments={departments.data ?? []} />
        </aside>
      </div>
    </>
  );
}

function RegisterForm({ departments, onDone }: { departments: DepartmentSummary[]; onDone: (r: RegisterResult) => void }) {
  const open = departments.filter((d) => d.isOpen);
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState<Language>('RW');
  const [departmentId, setDepartmentId] = useState('');
  const [priority, setPriority] = useState<PriorityChoice>('NORMAL');
  const [reason, setReason] = useState<PriorityReason>('NONE');
  const [touched, setTouched] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!departmentId && open[0]) setDepartmentId((open.find((d) => d.kind === 'CONSULTATION') ?? open[0]).id);
  }, [open, departmentId]);

  const nameError = touched && !isValidDisplayName(displayName) ? 'First name or initials only, e.g. "Aline" or "J. B." (max 20 characters)' : null;
  const phoneError = touched && phone.trim() && !normalizeRwandaPhone(phone) ? 'Rwandan mobile number, e.g. 0788 123 456' : null;
  const reasonError = touched && priority === 'PRIORITY' && reason === 'NONE' ? 'Choose why this patient has priority' : null;

  const register = useAction(
    () =>
      api.register({
        departmentId,
        displayName: displayName.trim(),
        phone: phone.trim(),
        language,
        priority: priority as Priority,
        priorityReason: priority === 'PRIORITY' ? reason : 'NONE',
      }),
    { invalidate: [['departments']], success: (r) => `Ticket ${r.ticket.number} registered` },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!isValidDisplayName(displayName) || (phone.trim() && !normalizeRwandaPhone(phone)) || (priority === 'PRIORITY' && reason === 'NONE') || !departmentId) return;
    register.mutate(undefined, {
      onSuccess: (r) => {
        onDone(r);
        setDisplayName('');
        setPhone('');
        setPriority('NORMAL');
        setReason('NONE');
        setTouched(false);
        nameRef.current?.focus();
      },
    });
  }

  if (!open.length) return <EmptyState text="All departments are closed. An admin can open them under Departments." />;

  return (
    <form className="card space-y-5 p-5 lg:p-6" onSubmit={submit} noValidate aria-label="Register walk-in">
      <h2 className="flex items-center gap-2 text-xl font-black text-navy">
        <UserPlus size={22} aria-hidden /> Register walk-in
      </h2>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Display name" id="displayName" error={nameError} help="First name or initials only. Never the full name.">
          <input
            ref={nameRef}
            id="displayName"
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={20}
            autoComplete="off"
            autoFocus
            aria-invalid={!!nameError}
            aria-describedby={nameError ? 'displayName-error' : 'displayName-help'}
          />
        </Field>
        <Field label="Phone (optional, for SMS)" id="phone" error={phoneError} help="Only reception can see it. Removed after 30 days.">
          <input
            id="phone"
            className="input"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0788 123 456"
            autoComplete="off"
            aria-invalid={!!phoneError}
            aria-describedby={phoneError ? 'phone-error' : 'phone-help'}
          />
        </Field>
      </div>

      <Choices<Language>
        label="Language for SMS and the patient page"
        value={language}
        onChange={setLanguage}
        columns={2}
        options={[
          { value: 'RW', label: 'Ikinyarwanda' },
          { value: 'EN', label: 'English' },
        ]}
      />

      <fieldset>
        <legend className="label">Department</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Department">
          {open.map((d) => (
            <button
              type="button"
              key={d.id}
              role="radio"
              aria-checked={departmentId === d.id}
              className={`choice flex-col items-start text-left ${departmentId === d.id ? 'choice-on' : ''}`}
              onClick={() => setDepartmentId(d.id)}
            >
              <span>{d.nameEn}</span>
              <span className="text-xs font-semibold text-muted">
                {d.waitingCount} waiting · {d.estimateMinutes === null ? 'no one serving' : `about ${d.estimateMinutes} min`}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <Choices<PriorityChoice>
        label="Priority"
        value={priority}
        onChange={(p) => {
          setPriority(p);
          if (p !== 'PRIORITY') setReason('NONE');
        }}
        options={[
          { value: 'NORMAL', label: 'Normal' },
          { value: 'PRIORITY', label: 'Priority' },
          { value: 'EMERGENCY', label: 'Emergency' },
        ]}
      />
      {priority === 'PRIORITY' && (
        <div>
          <Choices<PriorityReason> label="Why priority?" value={reason} onChange={setReason} columns={4} options={REASONS.map((r) => ({ value: r, label: PRIORITY_REASON_LABEL[r] }))} />
          {reasonError && (
            <p className="mt-1 text-sm font-semibold text-red" role="alert">
              {reasonError}
            </p>
          )}
        </div>
      )}
      {priority === 'EMERGENCY' && <p className="rounded-xl bg-red-bg p-3 font-semibold text-red">Emergency goes to the front of the line. Tell the doctor now if needed.</p>}

      <div className="flex justify-end">
        <button type="submit" className="btn-primary min-w-[200px] text-lg" disabled={register.isPending}>
          {register.isPending ? <Loader2 size={20} className="animate-spin" /> : <UserPlus size={20} />} Register
        </button>
      </div>
    </form>
  );
}

function useDepartments() {
  return useQuery({ queryKey: ['departments'], queryFn: api.departments }).data;
}

function RegisterResultCard({ result, hospitalName, onNext }: { result: RegisterResult; hospitalName: string; onNext: () => void }) {
  const departments = useDepartments();
  const dept = departments?.find((d) => d.id === result.ticket.departmentId);
  const printable = useMemo(
    () => ({
      number: result.ticket.number,
      displayName: result.ticket.displayName,
      departmentNameRw: dept?.nameRw ?? '',
      departmentNameEn: dept?.nameEn ?? result.ticket.departmentCode,
      hospitalName,
      joinedAt: result.ticket.joinedAt,
      patientUrl: result.patientUrl,
      peopleAhead: result.peopleAhead,
    }),
    [result, dept, hospitalName],
  );
  return (
    <section className="card animate-fadein overflow-hidden border-2 border-green" aria-live="polite">
      <div className="bg-mint p-5 text-center">
        <p className="text-sm font-bold uppercase tracking-wide text-green-ink">New ticket</p>
        <p className="ticket-number text-ticket-md">{result.ticket.number}</p>
        <p className="font-bold">
          {result.ticket.displayName} · {dept?.nameEn}
        </p>
      </div>
      <div className="grid grid-cols-2 divide-x divide-line border-y border-line text-center">
        <div className="p-3">
          <Users size={18} className="mx-auto text-navy" aria-hidden />
          <p className="font-heading text-2xl font-black">{result.peopleAhead}</p>
          <p className="text-xs text-muted">ahead</p>
        </div>
        <div className="p-3">
          <Clock size={18} className="mx-auto text-navy" aria-hidden />
          <p className="font-heading text-2xl font-black">{result.estimateMinutes === null ? '-' : `${result.estimateMinutes} min`}</p>
          <p className="text-xs text-muted">{result.estimateMinutes === null ? 'no one serving' : 'estimated wait'}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 p-4">
        <button className="btn-navy w-full" onClick={() => window.print()}>
          <Printer size={20} aria-hidden /> Print ticket
        </button>
        <a className="btn-secondary w-full" href={result.patientUrl} target="_blank" rel="noreferrer">
          Open patient page
        </a>
        <button className="btn-secondary w-full" onClick={onNext}>
          Done
        </button>
        {result.ticket.phone ? <p className="text-center text-sm text-muted">An SMS with the link was sent.</p> : <p className="text-center text-sm text-muted">No phone: give the printed ticket.</p>}
      </div>
      <div className="border-t border-line bg-bg p-3">
        <p className="label text-center">Print preview</p>
        <div className="origin-top scale-90">
          <PrintTicket t={printable} />
        </div>
      </div>
      <Printable>
        <PrintTicket t={printable} />
      </Printable>
    </section>
  );
}

function LastTicketHint() {
  return (
    <div className="card bg-sky p-5">
      <p className="font-bold text-navy">After registering</p>
      <p className="text-muted">The ticket number appears here with a print button. The patient follows their place with the QR code or the SMS link.</p>
    </div>
  );
}

function DepartmentsAtAGlance({ departments }: { departments: DepartmentSummary[] }) {
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-black text-navy">Departments now</h2>
        <Link to="/staff/queue" className="text-sm font-bold text-navy underline">
          Queue board
        </Link>
      </div>
      <ul className="divide-y divide-line">
        {departments.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate font-bold">{d.nameEn}</p>
              <p className="text-sm text-muted">
                {d.availableStaff} serving · {d.nowServing ? `now ${d.nowServing}` : 'no one called'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-heading text-xl font-black text-ink" title="Waiting">
                {d.waitingCount}
              </span>
              <OpenChip open={d.isOpen} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
