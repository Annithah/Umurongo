// The patient's ticket, as a pure view of the data (TicketPage loads the data and keeps it live).
// Mobile first: designed at 390 px, Kinyarwanda by default.
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bell, BellRing, Check, CheckCircle2, ClipboardList, Clock, MapPin, Users, WifiOff } from 'lucide-react';
import { GET_READY_AHEAD, type JourneyStep, type PublicTicketView } from '@umurongo/shared';
import { useI18n } from '../lib/i18n';
import { clock } from '../lib/format';
import { chime, unlockAudio, vibrate } from '../lib/chime';

export interface TicketViewProps {
  ticket: PublicTicketView;
  /** false while the phone is offline or the live connection is down. */
  online: boolean;
  /** When the data was last loaded. */
  updatedAt: Date;
  onOpenNext?: (token: string) => void;
}

export default function TicketView({ ticket, online, updatedAt, onOpenNext }: TicketViewProps) {
  const { t, lang, setLang, pick } = useI18n();
  const alerts = useCallAlerts(ticket.status === 'CALLED');
  const [overlayClosed, setOverlayClosed] = useState(false);
  const showOverlay = ticket.status === 'CALLED' && !overlayClosed;

  return (
    <div className="min-h-screen bg-bg pb-10">
      <header className="sticky top-0 z-20 bg-navy text-white">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <img src="/favicon-64.png" alt="" width={32} height={32} className="rounded-lg bg-white" />
            <div className="min-w-0">
              <p className="font-heading text-lg font-black leading-tight">Umurongo</p>
              <p className="truncate text-xs text-white/80">{ticket.hospital.name}</p>
            </div>
          </div>
          <button
            className="min-h-touch rounded-xl border border-white/30 px-3 text-sm font-bold"
            onClick={() => setLang(lang === 'RW' ? 'EN' : 'RW')}
            lang={lang === 'RW' ? 'en' : 'rw'}
          >
            {lang === 'RW' ? 'English' : 'Ikinyarwanda'}
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 pt-4">
        {!online && (
          <div className="flex items-start gap-3 rounded-card border border-amber/40 bg-amber-bg p-3 text-amber" role="status">
            <WifiOff size={20} className="mt-0.5 shrink-0" aria-hidden />
            <p className="font-semibold">{ticket.smsEnabled ? t.ticket.offline : t.ticket.offlineNoSms}</p>
          </div>
        )}

        <section className="card p-5" aria-labelledby="ticket-number">
          <p className="text-sm font-bold uppercase tracking-wide text-muted">{t.ticket.yourTicket}</p>
          <p id="ticket-number" className="ticket-number mt-1 text-ticket-sm sm:text-ticket-md">
            {ticket.number}
          </p>
          <p className="mt-2 text-lg font-bold text-navy">{pick(ticket.department, 'name')}</p>
          <p className="flex items-center gap-1.5 text-muted">
            <MapPin size={16} aria-hidden /> {pick(ticket.department, 'location')}
          </p>
          <p className="mt-1 text-muted">{ticket.displayName}</p>
        </section>

        <StatusSection ticket={ticket} alertsOn={alerts.on} onEnableAlerts={alerts.enable} onOpenNext={onOpenNext} />

        {['WAITING', 'CHECKED_IN', 'CALLED', 'IN_CONSULTATION'].includes(ticket.status) && <WhatToBring ticket={ticket} />}

        <Journey steps={ticket.journey} />

        <footer className="px-1 text-center text-sm text-muted">
          <p>{ticket.smsEnabled ? t.ticket.smsOn : t.ticket.smsOff}</p>
          <p className="mt-1">
            {t.ticket.keepOpen} {t.ticket.updated(clock(updatedAt))}
          </p>
          <p className="mt-3 font-heading font-black text-navy">{t.tagline}</p>
        </footer>
      </main>

      {showOverlay && <CalledOverlay ticket={ticket} alertsOn={alerts.on} onEnableAlerts={alerts.enable} onClose={() => setOverlayClosed(true)} />}
    </div>
  );
}

// ─── Status ─────────────────────────────────────────────────────────────────

function StatusSection({
  ticket,
  alertsOn,
  onEnableAlerts,
  onOpenNext,
}: {
  ticket: PublicTicketView;
  alertsOn: boolean;
  onEnableAlerts: () => void;
  onOpenNext?: (token: string) => void;
}) {
  const { t, pick } = useI18n();
  const waiting = ticket.status === 'WAITING' || ticket.status === 'CHECKED_IN';

  if (waiting) {
    const soon = ticket.peopleAhead <= GET_READY_AHEAD;
    const doctors = ticket.department.kind === 'CONSULTATION';
    return (
      <section className="card overflow-hidden" aria-label={t.ticket.status[ticket.status]} data-state="waiting">
        <div className="p-5">
          <h2 className="text-xl font-black text-navy">{t.ticket.status[ticket.status]}</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-sky p-3">
              <Users size={20} className="text-navy" aria-hidden />
              <p className="mt-1 font-heading text-4xl font-black text-ink">{ticket.peopleAhead}</p>
              <p className="text-sm font-semibold text-muted">{t.ticket.ahead}</p>
            </div>
            <div className="rounded-xl bg-sky p-3">
              <Clock size={20} className="text-navy" aria-hidden />
              {ticket.estimateMinutes === null ? (
                <p className="mt-1 font-bold text-amber">{t.ticket.noDoctor}</p>
              ) : (
                <>
                  <p className="mt-1 font-heading text-4xl font-black text-ink">{ticket.estimateMinutes}</p>
                  <p className="text-sm font-semibold text-muted">{t.ticket.minutes}</p>
                </>
              )}
            </div>
          </div>
          <p className="sr-only">
            {t.ticket.peopleAhead(ticket.peopleAhead)}. {ticket.estimateMinutes === null ? t.ticket.noDoctor : t.ticket.aboutMinutes(ticket.estimateMinutes)}.
          </p>

          <div className="mt-4" aria-hidden>
            <div className="h-3 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-green transition-all duration-700" style={{ width: `${Math.max(4, Math.round(ticket.progress * 100))}%` }} />
            </div>
          </div>

          <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-muted">
            <span className={`h-2.5 w-2.5 rounded-full ${ticket.staff.available > 0 ? 'bg-green' : 'bg-amber'}`} aria-hidden />
            {ticket.staff.onDuty === 0 ? t.ticket.noStaffOnDuty : t.ticket.staffAvailable(ticket.staff.available, ticket.staff.onDuty, doctors)}
          </p>
        </div>
        {soon && <p className="border-t border-green/30 bg-mint px-5 py-3 font-bold text-green-ink">{t.ticket.turnSoon}</p>}
        <AlertsButton on={alertsOn} onEnable={onEnableAlerts} />
      </section>
    );
  }

  if (ticket.status === 'CALLED') {
    return (
      <section className="card border-2 border-green bg-mint p-5" data-state="called">
        <h2 className="text-2xl font-black text-green-ink">{t.ticket.status.CALLED}</h2>
        {ticket.room && <p className="mt-1 text-xl font-bold text-ink">{t.ticket.goToRoom(ticket.room)}</p>}
        {ticket.staffName && <p className="text-muted">{t.ticket.calledBy(ticket.staffName)}</p>}
        <AlertsButton on={alertsOn} onEnable={onEnableAlerts} inline />
      </section>
    );
  }

  if (ticket.status === 'IN_CONSULTATION') {
    return (
      <section className="card p-5" data-state="in-consultation">
        <h2 className="text-xl font-black text-navy">{t.ticket.status.IN_CONSULTATION}</h2>
        {ticket.room && <p className="mt-1 text-lg font-semibold">{t.ticket.inRoom(ticket.room)}</p>}
        {ticket.staffName && <p className="text-muted">{ticket.staffName}</p>}
      </section>
    );
  }

  if (ticket.status === 'REFERRED') {
    const next = ticket.nextTicket;
    return (
      <section className="card border-2 border-navy/20 p-5" data-state="referred">
        <h2 className="text-xl font-black text-navy">{t.ticket.status.REFERRED}</h2>
        <p className="mt-1 text-muted">{t.ticket.referredText}</p>
        {next && (
          <>
            <div className="mt-4 rounded-xl bg-sky p-4">
              <p className="ticket-number text-5xl">{next.number}</p>
              <p className="mt-1 text-lg font-bold text-navy">{pick(next, 'name')}</p>
              <p className="flex items-center gap-1.5 text-muted">
                <MapPin size={16} aria-hidden /> {pick(next, 'location')}
              </p>
            </div>
            <button className="btn-primary mt-4 w-full" onClick={() => onOpenNext?.(next.token)}>
              {t.ticket.openNextTicket} <ArrowRight size={20} aria-hidden />
            </button>
          </>
        )}
      </section>
    );
  }

  if (ticket.status === 'DONE') {
    return (
      <section className="card p-5 text-center" data-state="done">
        <CheckCircle2 size={48} className="mx-auto text-green" aria-hidden />
        <h2 className="mt-2 text-2xl font-black text-green-ink">{t.ticket.status.DONE}</h2>
        <p className="mt-1 text-muted">{t.ticket.doneText}</p>
      </section>
    );
  }

  // NO_SHOW, CANCELLED, CLOSED
  const text = ticket.status === 'NO_SHOW' ? t.ticket.noShowText : ticket.status === 'CLOSED' ? t.ticket.closedText : t.ticket.cancelledText;
  return (
    <section className="card bg-grey-bg p-5" data-state="ended">
      <h2 className="text-xl font-black text-ink">{t.ticket.status[ticket.status]}</h2>
      <p className="mt-1 text-muted">{text}</p>
    </section>
  );
}

function AlertsButton({ on, onEnable, inline = false }: { on: boolean; onEnable: () => void; inline?: boolean }) {
  const { t } = useI18n();
  if (on) {
    return (
      <p className={`flex items-center gap-2 text-sm font-semibold text-green-ink ${inline ? 'mt-3' : 'border-t border-line px-5 py-3'}`}>
        <BellRing size={18} aria-hidden /> {t.ticket.alertsOn}
      </p>
    );
  }
  return (
    <button className={`flex min-h-touch w-full items-center gap-2 text-left font-bold text-navy hover:bg-sky ${inline ? 'mt-3 rounded-xl border border-line bg-white px-3' : 'border-t border-line px-5 py-3'}`} onClick={onEnable}>
      <Bell size={18} aria-hidden /> {t.ticket.tapForAlerts}
    </button>
  );
}

// ─── Called: full screen ────────────────────────────────────────────────────

function CalledOverlay({ ticket, alertsOn, onEnableAlerts, onClose }: { ticket: PublicTicketView; alertsOn: boolean; onEnableAlerts: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-green p-6 text-center text-white" role="alertdialog" aria-modal="true" aria-labelledby="called-title">
      <div className="relative">
        <span className="absolute inset-0 animate-ring rounded-full bg-white/40" aria-hidden />
        <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-white text-green">
          <BellRing size={40} aria-hidden />
        </span>
      </div>
      <h2 id="called-title" className="text-3xl font-black">
        {t.ticket.status.CALLED}
      </h2>
      <p className="font-heading text-ticket-md font-black tabular-nums">{ticket.number}</p>
      {ticket.room && <p className="text-2xl font-black">{t.ticket.goToRoom(ticket.room)}</p>}
      {ticket.staffName && <p className="text-lg text-white/90">{t.ticket.calledBy(ticket.staffName)}</p>}
      {!alertsOn && (
        <button className="btn mt-2 border-2 border-white bg-transparent text-white" onClick={onEnableAlerts}>
          <Bell size={20} aria-hidden /> {t.ticket.tapForAlerts}
        </button>
      )}
      <button ref={closeRef} className="btn mt-2 bg-white px-8 text-green-ink" onClick={onClose}>
        <Check size={20} aria-hidden /> {t.ticket.imGoing}
      </button>
    </div>
  );
}

/**
 * Sound and vibration for the call. Browsers allow sound only after a tap, so the patient can
 * turn alerts on while waiting; when the call comes, the chime repeats a few times.
 */
function useCallAlerts(called: boolean) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!called || !on) return;
    let count = 0;
    const ring = () => {
      chime();
      vibrate();
      count++;
    };
    ring();
    const timer = setInterval(() => (count < 4 ? ring() : clearInterval(timer)), 12_000);
    return () => clearInterval(timer);
  }, [called, on]);
  return {
    on,
    enable: async () => {
      const ok = await unlockAudio();
      vibrate([80]);
      setOn(true);
      if (ok && called) chime();
    },
  };
}

// ─── What to bring ──────────────────────────────────────────────────────────

function WhatToBring({ ticket }: { ticket: PublicTicketView }) {
  const { t, lang } = useI18n();
  const items = lang === 'RW' ? ticket.department.requirementsRw : ticket.department.requirementsEn;
  if (!items.length) return null;
  return (
    <section className="card bg-sky p-5" aria-labelledby="bring-title">
      <h2 id="bring-title" className="flex items-center gap-2 text-lg font-black text-navy">
        <ClipboardList size={20} aria-hidden /> {t.ticket.whatToBring}
      </h2>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <Check size={18} className="mt-0.5 shrink-0 text-green-ink" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Journey ────────────────────────────────────────────────────────────────

function Journey({ steps }: { steps: JourneyStep[] }) {
  const { t, pick } = useI18n();
  return (
    <section className="card p-5" aria-labelledby="journey-title">
      <h2 id="journey-title" className="text-lg font-black text-navy">
        {t.ticket.journeyTitle}
      </h2>
      <ol className="mt-4">
        {steps.map((s, i) => (
          <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0" aria-current={s.state === 'current' ? 'step' : undefined}>
            {i < steps.length - 1 && <span className={`absolute left-[13px] top-7 h-[calc(100%-20px)] w-0.5 ${s.state === 'done' ? 'bg-green' : 'bg-line'}`} aria-hidden />}
            <span
              className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${
                s.state === 'done' ? 'border-green bg-green text-white' : s.state === 'current' ? 'border-green bg-mint' : 'border-line bg-white'
              }`}
              aria-hidden
            >
              {s.state === 'done' ? <Check size={16} /> : s.state === 'current' ? <span className="h-2.5 w-2.5 rounded-full bg-green" /> : null}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={`font-bold ${s.state === 'current' ? 'text-green-ink' : s.state === 'done' ? 'text-ink' : 'text-muted'}`}>{t.ticket.journey[s.key]}</p>
              {s.tickets.length > 0 && (
                <p className="text-sm text-muted">{s.tickets.map((x) => `${x.number} ${pick(x, 'name')}`).join(' · ')}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
