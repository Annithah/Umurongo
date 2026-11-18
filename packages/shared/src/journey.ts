// The patient's visit as a four-step timeline:
//   Reception -> Consultation -> Lab / Cashier / Pharmacy -> Done
import type { DepartmentKind, JourneyStep, JourneyStepKey, TicketStatus } from './types';
import { ACTIVE_TICKET_STATUSES } from './types';

export interface JourneyTicket {
  number: string;
  kind: DepartmentKind;
  nameEn: string;
  nameRw: string;
  status: TicketStatus;
  joinedAt: Date | string;
}

const KEYS: JourneyStepKey[] = ['RECEPTION', 'CONSULTATION', 'NEXT_STEPS', 'DONE'];

/** Rule: consultation and other clinical departments are step 2; lab, cashier, pharmacy and imaging are step 3. */
export function journeyGroup(kind: DepartmentKind): 1 | 2 {
  return kind === 'CONSULTATION' || kind === 'OTHER' ? 1 : 2;
}

export function buildJourney(tickets: JourneyTicket[], visitFinished: boolean): JourneyStep[] {
  const sorted = [...tickets].sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());
  const active = [...sorted].reverse().find((t) => ACTIVE_TICKET_STATUSES.includes(t.status));
  const last = sorted[sorted.length - 1];

  let current: number;
  if (visitFinished && !active) current = 3;
  else if (active) current = journeyGroup(active.kind);
  else current = last ? journeyGroup(last.kind) : 0;

  return KEYS.map((key, index) => ({
    key,
    state: index < current ? 'done' : index === current ? 'current' : 'upcoming',
    tickets:
      index === 1 || index === 2
        ? sorted
            .filter((t) => journeyGroup(t.kind) === index)
            .map((t) => ({ number: t.number, nameEn: t.nameEn, nameRw: t.nameRw, status: t.status }))
        : [],
  }));
}
