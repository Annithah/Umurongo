// Render tests for every patient ticket state (Kinyarwanda by default, English on request).
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildJourney, en, rw, type PublicTicketView, type TicketStatus } from '@umurongo/shared';
import { I18nProvider } from '../lib/i18n';
import TicketView from './TicketView';

function ticket(over: Partial<PublicTicketView> = {}): PublicTicketView {
  return {
    token: 'k3J9xQ2mZp7Lr0aW5bYc1d',
    number: 'OPD-024',
    status: 'CHECKED_IN',
    displayName: 'Aline',
    language: 'RW',
    hospital: { id: 'masaka', name: 'Masaka Hospital' },
    department: {
      id: 'dept-opd',
      code: 'OPD',
      kind: 'CONSULTATION',
      nameEn: 'General consultation',
      nameRw: 'Isuzumwa rusange',
      locationEn: 'Ground floor, Wing A',
      locationRw: 'Hasi, inyubako A',
      requirementsEn: ['Insurance card', 'Transfer letter'],
      requirementsRw: ["Ikarita y'ubwishingizi", 'Urupapuro rwa transfert'],
    },
    peopleAhead: 4,
    estimateMinutes: 28,
    progress: 0.2,
    staff: { available: 2, onDuty: 3 },
    room: null,
    staffName: null,
    calledAt: null,
    nextTicket: null,
    journey: buildJourney([{ number: 'OPD-024', kind: 'CONSULTATION', nameEn: 'General consultation', nameRw: 'Isuzumwa rusange', status: 'CHECKED_IN', joinedAt: '2026-11-18T06:00:00Z' }], false),
    smsEnabled: true,
    visitFinishedAt: null,
    serverTime: '2026-11-18T06:30:00Z',
    ...over,
  };
}

function show(t: PublicTicketView, opts: { online?: boolean; onOpenNext?: (token: string) => void } = {}) {
  return render(
    <I18nProvider>
      <TicketView ticket={t} online={opts.online ?? true} updatedAt={new Date('2026-11-18T06:30:00Z')} onOpenNext={opts.onOpenNext} />
    </I18nProvider>,
  );
}

const state = () => document.querySelector('[data-state]')?.getAttribute('data-state');

describe('patient ticket page', () => {
  it('waiting: big number, people ahead, estimate, staff available, what to bring, journey (Kinyarwanda)', () => {
    show(ticket());
    expect(state()).toBe('waiting');
    expect(screen.getByText('OPD-024')).toHaveClass('ticket-number');
    expect(screen.getByText(rw.ticket.status.CHECKED_IN)).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();
    expect(screen.getByText(rw.ticket.staffAvailable(2, 3, true))).toBeInTheDocument();
    expect(screen.getByText(rw.ticket.whatToBring)).toBeInTheDocument();
    expect(screen.getByText("Ikarita y'ubwishingizi")).toBeInTheDocument();
    expect(screen.getByText(rw.ticket.journey.CONSULTATION).closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByText(rw.ticket.turnSoon)).not.toBeInTheDocument();
  });

  it('waiting with no doctor available says so instead of a number', () => {
    show(ticket({ estimateMinutes: null, staff: { available: 0, onDuty: 2 } }));
    expect(screen.getByText(rw.ticket.noDoctor)).toBeInTheDocument();
    expect(screen.queryByText('28')).not.toBeInTheDocument();
  });

  it('waiting near the front: "turn coming soon"', () => {
    show(ticket({ peopleAhead: 2, progress: 0.6 }));
    expect(screen.getByText(rw.ticket.turnSoon)).toBeInTheDocument();
  });

  it('called: full screen with the room, and a way to turn on sound', async () => {
    const user = userEvent.setup();
    show(ticket({ status: 'CALLED', room: 'Room 3', staffName: 'Dr. Claudine Uwase', calledAt: '2026-11-18T06:40:00Z', progress: 1 }));
    const overlay = screen.getByRole('alertdialog');
    expect(within(overlay).getByText(rw.ticket.status.CALLED)).toBeInTheDocument();
    expect(within(overlay).getByText('OPD-024')).toBeInTheDocument();
    expect(within(overlay).getByText(rw.ticket.goToRoom('Room 3'))).toBeInTheDocument();
    expect(within(overlay).getByRole('button', { name: rw.ticket.tapForAlerts })).toBeInTheDocument();
    await user.click(within(overlay).getByRole('button', { name: rw.ticket.imGoing }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(state()).toBe('called');
    expect(screen.getByText(rw.ticket.goToRoom('Room 3'))).toBeInTheDocument();
  });

  it('in consultation: shows the room', () => {
    show(ticket({ status: 'IN_CONSULTATION', room: 'Room 3', staffName: 'Dr. Claudine Uwase', progress: 1 }));
    expect(state()).toBe('in-consultation');
    expect(screen.getByText(rw.ticket.inRoom('Room 3'))).toBeInTheDocument();
  });

  it('referred: shows the new ticket and opens it', async () => {
    const user = userEvent.setup();
    const onOpenNext = vi.fn();
    show(
      ticket({
        status: 'REFERRED',
        progress: 1,
        nextTicket: { token: 'NEXTxQ2mZp7Lr0aW5bYc1d', number: 'LAB-004', nameEn: 'Laboratory', nameRw: 'Laboratwari', locationEn: 'Left of reception', locationRw: "Ibumoso bw'aho bakirira" },
        journey: buildJourney(
          [
            { number: 'OPD-024', kind: 'CONSULTATION', nameEn: 'OPD', nameRw: 'OPD', status: 'REFERRED', joinedAt: '2026-11-18T06:00:00Z' },
            { number: 'LAB-004', kind: 'LAB', nameEn: 'Laboratory', nameRw: 'Laboratwari', status: 'CHECKED_IN', joinedAt: '2026-11-18T07:00:00Z' },
          ],
          false,
        ),
      }),
      { onOpenNext },
    );
    expect(state()).toBe('referred');
    expect(screen.getByText('LAB-004')).toBeInTheDocument();
    expect(screen.getByText('Laboratwari', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText(rw.ticket.journey.NEXT_STEPS).closest('li')).toHaveAttribute('aria-current', 'step');
    await user.click(screen.getByRole('button', { name: new RegExp(rw.ticket.openNextTicket) }));
    expect(onOpenNext).toHaveBeenCalledWith('NEXTxQ2mZp7Lr0aW5bYc1d');
  });

  it('done: visit complete, no "what to bring"', () => {
    show(ticket({ status: 'DONE', progress: 1, visitFinishedAt: '2026-11-18T08:00:00Z', journey: buildJourney([{ number: 'OPD-024', kind: 'CONSULTATION', nameEn: 'OPD', nameRw: 'OPD', status: 'DONE', joinedAt: '2026-11-18T06:00:00Z' }], true) }));
    expect(state()).toBe('done');
    expect(screen.getByText(rw.ticket.status.DONE)).toBeInTheDocument();
    expect(screen.queryByText(rw.ticket.whatToBring)).not.toBeInTheDocument();
    expect(screen.getByText(rw.ticket.journey.DONE).closest('li')).toHaveAttribute('aria-current', 'step');
  });

  it.each<[TicketStatus, string]>([
    ['NO_SHOW', rw.ticket.noShowText],
    ['CANCELLED', rw.ticket.cancelledText],
    ['CLOSED', rw.ticket.closedText],
  ])('%s: explains what happened', (status, text) => {
    show(ticket({ status }));
    expect(state()).toBe('ended');
    expect(screen.getByText(rw.ticket.status[status])).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('offline: shows the last known position with the SMS notice', () => {
    show(ticket(), { online: false });
    expect(screen.getByRole('status')).toHaveTextContent(rw.ticket.offline);
    expect(screen.getByText('OPD-024')).toBeInTheDocument();
  });

  it('offline without a phone number does not promise SMS', () => {
    show(ticket({ smsEnabled: false }), { online: false });
    expect(screen.getByRole('status')).toHaveTextContent(rw.ticket.offlineNoSms);
  });

  it('switches to English', async () => {
    const user = userEvent.setup();
    show(ticket());
    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByText(en.ticket.status.CHECKED_IN)).toBeInTheDocument();
    expect(screen.getByText('General consultation')).toBeInTheDocument();
    expect(screen.getByText('Insurance card')).toBeInTheDocument();
    expect(window.localStorage.getItem('umurongo.lang')).toBe('EN');
  });

  it('English offline text matches the spec', () => {
    window.localStorage.setItem('umurongo.lang', 'EN');
    show(ticket(), { online: false });
    expect(screen.getByRole('status')).toHaveTextContent('Showing last known position. SMS alerts are still on.');
  });
});
