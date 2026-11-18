// Status chips: always a dot AND text, never colour alone.
import type { ReactNode } from 'react';
import type { Priority, PriorityReason, StaffStatus, TicketStatus } from '@umurongo/shared';

type Tone = 'green' | 'amber' | 'red' | 'grey' | 'navy';

const TONE: Record<Tone, { chip: string; dot: string }> = {
  green: { chip: 'bg-mint text-green-ink', dot: 'bg-green' },
  amber: { chip: 'bg-amber-bg text-amber', dot: 'bg-amber' },
  red: { chip: 'bg-red-bg text-red', dot: 'bg-red' },
  grey: { chip: 'bg-grey-bg text-grey', dot: 'bg-grey' },
  navy: { chip: 'bg-sky text-navy', dot: 'bg-navy' },
};

export function Chip({ tone, children, large = false }: { tone: Tone; children: ReactNode; large?: boolean }) {
  const t = TONE[tone];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-bold ${large ? 'px-4 py-2 text-xl' : 'px-2.5 py-1 text-xs'} ${t.chip}`}>
      <span className={`rounded-full ${large ? 'h-3 w-3' : 'h-2 w-2'} ${t.dot}`} aria-hidden />
      {children}
    </span>
  );
}

export const STAFF_STATUS_LABEL: Record<StaffStatus, string> = {
  AVAILABLE: 'Available',
  IN_CONSULTATION: 'In consultation',
  IN_SURGERY: 'In surgery',
  ON_BREAK: 'On break',
  AWAY: 'Away',
  OFF_DUTY: 'Off duty',
};

/** Design system: Available green; Busy / In consultation amber; In surgery / Away red; Off duty grey. */
export const STAFF_STATUS_TONE: Record<StaffStatus, Tone> = {
  AVAILABLE: 'green',
  IN_CONSULTATION: 'amber',
  ON_BREAK: 'amber',
  IN_SURGERY: 'red',
  AWAY: 'red',
  OFF_DUTY: 'grey',
};

export function StaffStatusChip({ status, label, large }: { status: StaffStatus; label?: string; large?: boolean }) {
  return (
    <Chip tone={STAFF_STATUS_TONE[status]} large={large}>
      {label ?? STAFF_STATUS_LABEL[status]}
    </Chip>
  );
}

const TICKET: Record<TicketStatus, { label: string; tone: Tone }> = {
  WAITING: { label: 'Not arrived', tone: 'grey' },
  CHECKED_IN: { label: 'Waiting', tone: 'navy' },
  CALLED: { label: 'Called', tone: 'green' },
  IN_CONSULTATION: { label: 'In consultation', tone: 'amber' },
  DONE: { label: 'Done', tone: 'green' },
  REFERRED: { label: 'Next step', tone: 'navy' },
  NO_SHOW: { label: 'No-show', tone: 'red' },
  CANCELLED: { label: 'Cancelled', tone: 'grey' },
  CLOSED: { label: 'Closed', tone: 'grey' },
};

export function TicketStatusChip({ status }: { status: TicketStatus }) {
  return <Chip tone={TICKET[status].tone}>{TICKET[status].label}</Chip>;
}

export const PRIORITY_REASON_LABEL: Record<PriorityReason, string> = {
  NONE: 'None',
  PREGNANT: 'Pregnant',
  ELDERLY: 'Elderly 65+',
  DISABILITY: 'Disability',
  CHILD_UNDER_5: 'Child under 5',
};

export function PriorityChip({ priority, reason }: { priority: Priority; reason?: PriorityReason }) {
  if (priority === 'EMERGENCY') return <Chip tone="red">Emergency</Chip>;
  if (priority === 'PRIORITY') return <Chip tone="amber">Priority{reason && reason !== 'NONE' ? `: ${PRIORITY_REASON_LABEL[reason]}` : ''}</Chip>;
  return <Chip tone="grey">Normal</Chip>;
}

export function OpenChip({ open }: { open: boolean }) {
  return <Chip tone={open ? 'green' : 'grey'}>{open ? 'Open' : 'Closed'}</Chip>;
}
