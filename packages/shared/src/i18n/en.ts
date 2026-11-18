// English strings for everything patients see: ticket page, TV, printed ticket and SMS.
// Staff screens are English only and keep their copy in the components.
// rw.ts must provide every key in this file (enforced by the Messages type).
import type { StaffStatus, TicketStatus } from '../types';

export interface SmsVars {
  number: string;
  ahead?: number;
  wait?: string;
  room?: string;
  dept?: string;
  link?: string;
  hospital?: string;
  day?: string;
  time?: string;
}

export const en = {
  langName: 'English',
  tagline: 'Know your place. Know your next step.',

  sms: {
    waitMinutes: (n: number) => `about ${n} min`,
    waitNoStaff: 'no doctor available right now',
    JOINED: (v: SmsVars) => `Umurongo: Ticket ${v.number}. ${v.ahead} ahead of you, ${v.wait}. Follow your place: ${v.link}`,
    GET_READY: (v: SmsVars) => `Umurongo: Get ready! ${v.number}: ${v.ahead} ahead of you. Please stay near ${v.dept}.`,
    CALLED: (v: SmsVars) => `Umurongo: It is your turn! ${v.number}, please go to ${v.room} now.`,
    NEXT_STEP: (v: SmsVars) => `Umurongo: Next step: ${v.dept}, ticket ${v.number}. Where to go: ${v.link}`,
    WAIT_CHANGED: (v: SmsVars) => `Umurongo: ${v.number}: your waiting time has changed, ${v.wait}.`,
    FEEDBACK: (v: SmsVars) => `Umurongo: Thank you for visiting ${v.hospital}. Were you satisfied with the service? Reply 1 = yes, 2 = no.`,
    DAY_CLOSED: (v: SmsVars) => `Umurongo: ${v.dept} has closed for today and ticket ${v.number} has ended. We open again ${v.day} at ${v.time}.`,
    FEEDBACK_THANKS: 'Umurongo: Thank you for your answer.',
  },

  days: { today: 'today', tomorrow: 'tomorrow' },

  common: {
    notFound: 'Page not found',
    home: 'Home',
    errorTitle: 'Something went wrong',
    errorText: 'Please reload the page.',
    backToStart: 'Back to start',
    haveTicket: 'Have a ticket? Scan the QR code printed on it.',
  },

  ticket: {
    yourTicket: 'Your ticket',
    peopleAhead: (n: number) => (n === 0 ? 'No one ahead of you' : n === 1 ? '1 person ahead of you' : `${n} people ahead of you`),
    ahead: 'people ahead of you',
    minutes: 'minutes',
    imGoing: "OK, I'm going",
    estimatedWait: 'Estimated wait',
    aboutMinutes: (n: number) => `About ${n} min`,
    noDoctor: 'No doctor available right now',
    staffAvailable: (available: number, onDuty: number, doctors: boolean) =>
      `${available} of ${onDuty} ${doctors ? (onDuty === 1 ? 'doctor' : 'doctors') : 'staff'} available`,
    noStaffOnDuty: 'No one is on duty right now',
    turnSoon: 'Your turn is coming soon. Please stay close.',
    status: {
      WAITING: 'You are in line',
      CHECKED_IN: 'You are in line',
      CALLED: "It's your turn!",
      IN_CONSULTATION: 'You are being seen',
      DONE: 'Your visit is complete',
      REFERRED: 'Your next step',
      NO_SHOW: 'Your ticket has ended',
      CANCELLED: 'Your ticket was cancelled',
      CLOSED: 'This service has closed for today',
    } satisfies Record<TicketStatus, string>,
    goToRoom: (room: string) => `Please go to ${room}`,
    calledBy: (name: string) => `${name} is waiting for you`,
    inRoom: (room: string) => `In ${room}`,
    tapForAlerts: 'Tap to turn on sound and vibration',
    alertsOn: 'Sound and vibration are on',
    doneText: 'Thank you for coming. Get well soon.',
    referredText: 'You have a new ticket for your next step.',
    openNextTicket: 'Open my new ticket',
    noShowText: 'You were called but did not come. Please ask at reception.',
    cancelledText: 'Please ask at reception if you still need to be seen.',
    closedText: 'Please come back when the service opens again.',
    whatToBring: 'What to bring',
    journeyTitle: 'Your visit',
    journey: { RECEPTION: 'Reception', CONSULTATION: 'Consultation', NEXT_STEPS: 'Lab, cashier, pharmacy', DONE: 'Done' },
    offline: 'Showing last known position. SMS alerts are still on.',
    offlineNoSms: 'Showing last known position. Reconnecting...',
    smsOn: 'We will also send you an SMS.',
    smsOff: 'No SMS for this ticket. Keep this page open.',
    updated: (time: string) => `Updated ${time}`,
    notFoundTitle: 'Ticket not found',
    notFoundText: 'Check that the link is complete, or ask at reception.',
    loadError: 'Could not load your ticket. Check your connection.',
    retry: 'Try again',
    loading: 'Loading...',
    keepOpen: 'Keep this page open. It updates by itself.',
  },

  tv: {
    nowCalling: 'Now calling',
    live: 'Live',
    reconnecting: 'Reconnecting...',
    room: 'Room',
    lastCalls: 'Last calls',
    next: 'Next',
    waiting: (n: number) => `${n} waiting`,
    noCalls: 'No one has been called yet',
    nobodyWaiting: 'No one waiting',
    staffTitle: 'Doctors and staff',
    turnOnSound: 'Turn on sound',
    soundOn: 'Sound on',
    messages: [
      'Follow your place on your phone: scan the QR code on your ticket.',
      'Gave your phone number? We will send you an SMS when it is your turn.',
      'Waiting times are estimates. Emergencies are always seen first.',
      'Bring what you need: the list is on your ticket page.',
      'Need help? Please ask at reception.',
    ],
  },

  staffStatus: {
    AVAILABLE: 'Available',
    IN_CONSULTATION: 'In consultation',
    IN_SURGERY: 'In surgery',
    ON_BREAK: 'On break',
    AWAY: 'Away',
    OFF_DUTY: 'Off duty',
  } satisfies Record<StaffStatus, string>,

  print: {
    ticket: 'Ticket',
    scan: 'Scan to follow your place in line',
    tvAndSms: 'Watch the TV screen. We also send an SMS if you gave a phone number.',
    keep: 'Keep this ticket until the end of your visit.',
  },
};

export type Messages = typeof en;
