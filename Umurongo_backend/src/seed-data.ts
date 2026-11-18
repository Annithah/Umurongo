import bcrypt from 'bcrypt';
import type { DepartmentKind, Prisma, PrismaClient, StaffRole, StaffStatus, TicketStatus } from '@prisma/client';
import { addDays, formatTicketNumber, isDueForDailyClose, kigaliDate, kigaliMidnight } from '@umurongo/shared';
import { kigaliTimeToday, kigaliToday } from './time';
import { randomToken } from './tokens';

// Demo data for Masaka Hospital (Kicukiro). Every name and phone number is invented.
// Used by `npm run db:seed`, the API tests and POST /api/dev/reset.

export const HOSPITAL_ID = 'masaka';
export const DEMO_PASSWORD = 'demo1234';

type SeedDept = {
  code: string;
  kind: DepartmentKind;
  nameEn: string;
  nameRw: string;
  avgMinutes: number | null;
  isOpen?: boolean;
  opensAt?: string;
  closesAt?: string;
  locationEn: string;
  locationRw: string;
  requirementsEn: string[];
  requirementsRw: string[];
  showOnTv?: boolean;
};

// Kinyarwanda here is demo data entered "by the hospital", not UI copy. NEEDS NATIVE CHECK.
const DEPARTMENTS: SeedDept[] = [
  {
    code: 'OPD', kind: 'CONSULTATION', nameEn: 'General consultation', nameRw: 'Isuzumwa rusange', avgMinutes: 12,
    locationEn: 'Ground floor, Wing A', locationRw: 'Hasi, inyubako A',
    requirementsEn: ['Mutuelle de Sante or insurance card', 'Your ID card (indangamuntu)', 'Transfer letter from your health centre', 'Your health booklet (carnet) if you have one', 'The medicines you take now'],
    requirementsRw: ["Ikarita ya Mituweli cyangwa y'ubwishingizi", 'Indangamuntu yawe', "Urupapuro rwa transfert ruvuye ku kigo nderabuzima", "Agatabo k'ubuzima (carnet) niba ugafite", 'Imiti ufata ubu'],
  },
  {
    code: 'PED', kind: 'CONSULTATION', nameEn: 'Paediatrics', nameRw: "Ubuvuzi bw'abana", avgMinutes: 15,
    locationEn: 'First floor, Wing B', locationRw: 'Igorofa rya mbere, inyubako B',
    requirementsEn: ["The child's health booklet and vaccination card", "Parent's Mutuelle or insurance card", 'Transfer letter from the health centre'],
    requirementsRw: ["Agatabo k'ubuzima n'ikarita y'inkingo by'umwana", "Ikarita ya Mituweli y'umubyeyi", "Urupapuro rwa transfert"],
  },
  {
    code: 'MAT', kind: 'CONSULTATION', nameEn: 'Maternity', nameRw: "Serivisi y'ababyeyi", avgMinutes: 20, closesAt: '24:00', opensAt: '00:00',
    locationEn: 'Maternity block', locationRw: "Inyubako y'ababyeyi",
    requirementsEn: ['Your antenatal care card', 'Mutuelle or insurance card', 'Transfer letter if you have one'],
    requirementsRw: ["Ikarita yo kwipimisha inda", "Ikarita ya Mituweli cyangwa y'ubwishingizi", 'Urupapuro rwa transfert niba urufite'],
  },
  {
    code: 'LAB', kind: 'LAB', nameEn: 'Laboratory', nameRw: 'Laboratwari', avgMinutes: 6,
    locationEn: 'Ground floor, left of reception', locationRw: "Hasi, ibumoso bw'aho bakirira",
    requirementsEn: ['The lab request form from your doctor', 'Your ticket'],
    requirementsRw: ["Urupapuro rw'ibizamini muganga yaguhaye", 'Itike yawe'],
  },
  {
    code: 'CSH', kind: 'CASHIER', nameEn: 'Cashier', nameRw: 'Kwishyura', avgMinutes: 3,
    locationEn: 'Cashier windows 1 and 2, main hall', locationRw: "Amadirisha 1 na 2, mu cyumba kinini",
    requirementsEn: ['Your insurance card', 'Cash or Mobile Money for your share'],
    requirementsRw: ["Ikarita y'ubwishingizi", "Amafaranga cyangwa Mobile Money y'umugabane wawe"],
  },
  {
    code: 'PHA', kind: 'PHARMACY', nameEn: 'Pharmacy', nameRw: 'Farumasi', avgMinutes: 4,
    locationEn: 'Main entrance, right side', locationRw: 'Ku bwinjiriro bukuru, iburyo',
    requirementsEn: ['The prescription from your doctor', 'Your receipt from the cashier'],
    requirementsRw: ['Urupapuro rw\'imiti muganga yanditse', "Inyemezabwishyu y'aho wishyuriye"],
  },
  {
    code: 'IMG', kind: 'IMAGING', nameEn: 'Imaging (X-ray, ultrasound)', nameRw: 'Radiyo na echographie', avgMinutes: 10, showOnTv: false,
    locationEn: 'Ground floor, Wing C', locationRw: 'Hasi, inyubako C',
    requirementsEn: ['The imaging request from your doctor', 'Earlier X-ray films if you have them'],
    requirementsRw: ["Urupapuro muganga yaguhaye", 'Amafoto ya radiyo ya mbere niba uyafite'],
  },
  {
    code: 'DEN', kind: 'CONSULTATION', nameEn: 'Dental', nameRw: "Ubuvuzi bw'amenyo", avgMinutes: 15, isOpen: false, showOnTv: false,
    locationEn: 'First floor, Wing A', locationRw: 'Igorofa rya mbere, inyubako A',
    requirementsEn: ['Mutuelle or insurance card', 'Transfer letter'],
    requirementsRw: ['Ikarita ya Mituweli', 'Urupapuro rwa transfert'],
  },
];

const ROOMS: { name: string; dept: string | null }[] = [
  { name: 'Room 3', dept: 'OPD' },
  { name: 'Room 4', dept: 'OPD' },
  { name: 'Room 5', dept: 'OPD' },
  { name: 'Room 6', dept: 'OPD' },
  { name: 'Room 7', dept: 'PED' },
  { name: 'Room 9', dept: 'MAT' },
  { name: 'Lab counter 1', dept: 'LAB' },
  { name: 'Cashier window 1', dept: 'CSH' },
  { name: 'Pharmacy window 2', dept: 'PHA' },
  { name: 'Imaging room', dept: 'IMG' },
];

type SeedStaff = { key: string; fullName: string; email: string; role: StaffRole; dept: string | null; room: string | null; title: string; status: StaffStatus; backAt?: Date };

export const STAFF: SeedStaff[] = [
  { key: 'admin', fullName: 'Dr. Jeanne Mukamazimpaka', email: 'admin@masaka.demo', role: 'HOSPITAL_ADMIN', dept: null, room: null, title: 'Medical director', status: 'AVAILABLE' },
  { key: 'mutoni', fullName: 'Josiane Mutoni', email: 'reception@masaka.demo', role: 'RECEPTIONIST', dept: null, room: null, title: 'Receptionist', status: 'AVAILABLE' },
  { key: 'uwase', fullName: 'Dr. Claudine Uwase', email: 'claudine@masaka.demo', role: 'CLINICIAN', dept: 'OPD', room: 'Room 3', title: 'General practitioner', status: 'IN_CONSULTATION' },
  { key: 'habimana', fullName: 'Dr. Eric Habimana', email: 'eric@masaka.demo', role: 'CLINICIAN', dept: 'OPD', room: 'Room 5', title: 'General practitioner', status: 'IN_CONSULTATION' },
  { key: 'mukamana', fullName: 'Dr. Grace Mukamana', email: 'grace@masaka.demo', role: 'CLINICIAN', dept: 'OPD', room: 'Room 6', title: 'Surgeon', status: 'IN_SURGERY' },
  { key: 'niyonzima', fullName: 'Dr. Jean Bosco Niyonzima', email: 'jeanbosco@masaka.demo', role: 'CLINICIAN', dept: 'OPD', room: 'Room 4', title: 'General practitioner', status: 'OFF_DUTY' },
  { key: 'ingabire', fullName: 'Dr. Alice Ingabire', email: 'alice@masaka.demo', role: 'CLINICIAN', dept: 'PED', room: 'Room 7', title: 'Paediatrician', status: 'AVAILABLE' },
  { key: 'mugisha', fullName: 'Dr. Patrick Mugisha', email: 'patrick@masaka.demo', role: 'CLINICIAN', dept: 'MAT', room: 'Room 9', title: 'Obstetrician', status: 'AVAILABLE' },
  { key: 'uwera', fullName: 'Diane Uwera', email: 'diane@masaka.demo', role: 'COUNTER', dept: 'LAB', room: 'Lab counter 1', title: 'Lab technician', status: 'AVAILABLE' },
  { key: 'habineza', fullName: 'Aimable Habineza', email: 'cashier@masaka.demo', role: 'COUNTER', dept: 'CSH', room: 'Cashier window 1', title: 'Cashier', status: 'AVAILABLE' },
  { key: 'nkurunziza', fullName: 'Samuel Nkurunziza', email: 'samuel@masaka.demo', role: 'COUNTER', dept: 'PHA', room: 'Pharmacy window 2', title: 'Pharmacist', status: 'AVAILABLE' },
];

const FIRST_NAMES = ['Aline', 'Jean', 'Marie', 'Eric', 'Claudine', 'Patrick', 'Diane', 'Samuel', 'Grace', 'Olivier', 'Divine', 'Kevin', 'Esther', 'Moses', 'Ange', 'Fabrice', 'Joy', 'Yves', 'Solange', 'Emmanuel', 'J. B.', 'A. M.', 'C. N.', 'P. K.'];

/** Small deterministic PRNG so the seeded history is the same on every run. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60_000;

export async function seedDemo(prisma: PrismaClient, opts: { historyDays?: number } = {}) {
  const historyDays = opts.historyDays ?? 29;
  const now = Date.now();
  const rand = mulberry32(20261118);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

  // Wipe everything so the seed can be re-run any time.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "SmsMessage", "InboundSms", "CallLog", "Ticket", "Visit", "Staff", "Room", "Department", "Hospital", "JobRun" CASCADE',
  );

  const hospital = await prisma.hospital.create({
    data: { id: HOSPITAL_ID, name: 'Masaka Hospital', district: 'Kicukiro', address: 'Masaka, Kicukiro, Kigali', smsSenderId: 'MASAKA HOSP' },
  });

  const today = kigaliToday();
  const dept: Record<string, { id: string; prefix: string; kind: DepartmentKind }> = {};
  for (const [i, d] of DEPARTMENTS.entries()) {
    dept[d.code] = await prisma.department.create({
      data: {
        id: `dept-${d.code.toLowerCase()}`,
        hospitalId: hospital.id,
        code: d.code,
        kind: d.kind,
        nameEn: d.nameEn,
        nameRw: d.nameRw,
        prefix: d.code,
        avgMinutes: d.avgMinutes,
        isOpen: d.isOpen ?? true,
        opensAt: d.opensAt ?? '07:00',
        closesAt: d.closesAt ?? '19:00',
        // Seeded after closing time (an evening demo): count today as already closed, so the
        // daily-close job does not empty the demo queue straight away.
        lastClosedOn: isDueForDailyClose(d.closesAt ?? '19:00', d.opensAt ?? '07:00', null) ? kigaliDate() : addDays(kigaliDate(), -1),
        locationEn: d.locationEn,
        locationRw: d.locationRw,
        requirementsEn: d.requirementsEn.join('\n'),
        requirementsRw: d.requirementsRw.join('\n'),
        showOnTv: d.showOnTv ?? true,
        sortOrder: i * 10,
        dailyCounter: 0,
        counterDate: today,
      },
    });
  }

  const room: Record<string, string> = {};
  for (const r of ROOMS) {
    room[r.name] = (await prisma.room.create({ data: { hospitalId: hospital.id, name: r.name, departmentId: r.dept ? dept[r.dept].id : null } })).id;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const staff: Record<string, { id: string; fullName: string; room: string | null }> = {};
  for (const s of STAFF) {
    const created = await prisma.staff.create({
      data: {
        id: `staff-${s.key}`,
        hospitalId: hospital.id,
        departmentId: s.dept ? dept[s.dept].id : null,
        roomId: s.room ? room[s.room] : null,
        fullName: s.fullName,
        email: s.email,
        passwordHash,
        role: s.role,
        title: s.title,
        status: s.status,
        backAt: s.key === 'mukamana' ? kigaliTimeToday(14, 0) : null,
      },
    });
    staff[s.key] = { id: created.id, fullName: created.fullName, room: s.room };
  }

  // ─── History: earlier days, for analytics ───────────────────────────────
  const visits: Prisma.VisitCreateManyInput[] = [];
  const levels: Prisma.TicketCreateManyInput[][] = [[], [], [], []];
  const servers: Record<string, string[]> = {
    OPD: [staff.uwase.id, staff.habimana.id, staff.niyonzima.id],
    PED: [staff.ingabire.id],
    MAT: [staff.mugisha.id],
    LAB: [staff.uwera.id],
    CSH: [staff.habineza.id],
    PHA: [staff.nkurunziza.id],
  };
  for (let d = historyDays; d >= 1; d--) {
    const date = addDays(kigaliDate(), -d);
    const midnight = kigaliMidnight(date).getTime();
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const busy = weekday === 1 ? 1.25 : weekday === 0 ? 0.55 : weekday === 6 ? 0.7 : 1;
    const counters: Record<string, number> = {};
    const next = (code: string) => (counters[code] = (counters[code] ?? 0) + 1);

    const arrivals: { code: string; at: number }[] = [];
    for (const [code, base] of [['OPD', 46], ['PED', 12], ['MAT', 7]] as const) {
      const n = Math.round(base * busy * (0.85 + rand() * 0.3));
      for (let i = 0; i < n; i++) {
        // Morning peak: most patients arrive 07:00 to 11:00.
        const hour = rand() < 0.65 ? 7 + rand() * 4 : 11 + rand() * 6;
        arrivals.push({ code, at: midnight + hour * 60 * MIN });
      }
    }
    arrivals.sort((a, b) => a.at - b.at);

    for (const a of arrivals) {
      const visitId = `hv-${date}-${visits.length}`;
      const hasPhone = rand() < 0.55;
      const h = (a.at - midnight) / 3_600_000;
      const peak = h < 11 ? 1.6 : 0.8;
      let t = a.at;
      const chain: { code: string; level: number }[] = [{ code: a.code, level: 0 }];
      if (rand() < 0.55) {
        chain.push({ code: 'LAB', level: 1 });
        chain.push({ code: 'CSH', level: 2 });
        chain.push({ code: 'PHA', level: 3 });
      } else if (rand() < 0.6) {
        chain.push({ code: 'PHA', level: 1 });
      }
      let parentId: string | null = null;
      let finishedAt = t;
      let ended = false;
      for (const [i, step] of chain.entries()) {
        const avg = { OPD: 12, PED: 15, MAT: 20, LAB: 6, CSH: 3, PHA: 4 }[step.code] ?? 10;
        const wait = (step.level === 0 ? 18 : 6) * peak * (0.4 + rand() * 1.4);
        const noShow = step.level === 0 && rand() < 0.04;
        const calledAt = t + wait * MIN;
        const service = avg * (0.6 + rand() * 0.9);
        const last = i === chain.length - 1 || noShow;
        const status: TicketStatus = noShow ? 'NO_SHOW' : last ? 'DONE' : 'REFERRED';
        const ticketId = `ht-${date}-${step.code}-${next(step.code)}`;
        const finish = noShow ? calledAt + 11 * MIN : calledAt + (1 + service) * MIN;
        levels[step.level].push({
          id: ticketId,
          hospitalId: hospital.id,
          departmentId: dept[step.code].id,
          visitId,
          publicToken: randomToken(),
          number: formatTicketNumber(dept[step.code].prefix, counters[step.code]),
          displayName: pick(FIRST_NAMES),
          phone: null, // older than the retention period in real life is removed; the demo history has none
          phoneRemovedAt: hasPhone ? new Date(finish) : null,
          language: rand() < 0.85 ? 'RW' : 'EN',
          priority: rand() < 0.1 ? 'PRIORITY' : 'NORMAL',
          channel: step.level === 0 ? 'WALK_IN' : 'NEXT_STEP',
          status,
          staffId: pick(servers[step.code]),
          parentTicketId: parentId,
          sortKey: t,
          joinedAt: new Date(t),
          checkedInAt: new Date(t),
          calledAt: new Date(calledAt),
          startedAt: noShow ? null : new Date(calledAt + MIN),
          finishedAt: new Date(finish),
        });
        parentId = ticketId;
        finishedAt = finish;
        t = finish + 2 * MIN;
        if (noShow) {
          ended = true;
          break;
        }
      }
      const asked = hasPhone && !ended;
      const answered = asked && rand() < 0.68;
      visits.push({
        id: visitId,
        hospitalId: hospital.id,
        startedAt: new Date(a.at),
        finishedAt: new Date(finishedAt),
        feedbackRequestedAt: asked ? new Date(finishedAt) : null,
        feedbackAnswer: answered ? (rand() < 0.83 ? 'YES' : 'NO') : null,
        feedbackAt: answered ? new Date(finishedAt + 20 * MIN) : null,
      });
    }
  }
  await prisma.visit.createMany({ data: visits });
  for (const level of levels) if (level.length) await prisma.ticket.createMany({ data: level });

  // ─── Today: a live morning at Masaka ────────────────────────────────────
  const counters: Record<string, number> = {};
  async function ticket(opts: {
    dept: string;
    num: number;
    name: string;
    status: TicketStatus;
    minutesAgo: number;
    phone?: string;
    priority?: 'NORMAL' | 'PRIORITY' | 'EMERGENCY';
    priorityReason?: 'NONE' | 'PREGNANT' | 'ELDERLY' | 'DISABILITY' | 'CHILD_UNDER_5';
    staffKey?: string;
    visitId?: string;
    parentTicketId?: string;
    aheadAtJoin?: number;
  }) {
    const joinedAt = new Date(now - opts.minutesAgo * MIN);
    const visitId = opts.visitId ?? (await prisma.visit.create({ data: { hospitalId: hospital.id, startedAt: joinedAt } })).id;
    const past = (m: number) => new Date(joinedAt.getTime() + m * MIN);
    const called = ['CALLED', 'IN_CONSULTATION', 'DONE', 'REFERRED'].includes(opts.status);
    const started = ['IN_CONSULTATION', 'DONE', 'REFERRED'].includes(opts.status);
    const finished = ['DONE', 'REFERRED'].includes(opts.status);
    counters[opts.dept] = Math.max(counters[opts.dept] ?? 0, opts.num);
    return prisma.ticket.create({
      data: {
        hospitalId: hospital.id,
        departmentId: dept[opts.dept].id,
        visitId,
        publicToken: randomToken(),
        number: formatTicketNumber(dept[opts.dept].prefix, opts.num),
        displayName: opts.name,
        phone: opts.phone ?? null,
        language: 'RW',
        priority: opts.priority ?? 'NORMAL',
        priorityReason: opts.priorityReason ?? 'NONE',
        channel: opts.parentTicketId ? 'NEXT_STEP' : 'WALK_IN',
        status: opts.status,
        staffId: opts.staffKey ? staff[opts.staffKey].id : null,
        parentTicketId: opts.parentTicketId ?? null,
        sortKey: joinedAt.getTime(),
        aheadAtJoin: opts.aheadAtJoin ?? 0,
        joinedAt,
        checkedInAt: joinedAt,
        calledAt: called ? past(Math.min(opts.minutesAgo - 4, 40)) : null,
        startedAt: started ? past(Math.min(opts.minutesAgo - 3, 41)) : null,
        finishedAt: finished ? past(Math.min(opts.minutesAgo - 1, 55)) : null,
      },
    });
  }

  // OPD: 010-017 earlier this morning, 018-019 in consultation, 020-023 waiting (022 elderly priority).
  const early = ['Jean', 'Marie', 'Esther', 'C. N.', 'Patrick', 'Ange', 'Yves', 'Solange'];
  const doneOpd = [];
  for (let i = 0; i < 8; i++) {
    doneOpd.push(await ticket({ dept: 'OPD', num: 10 + i, name: early[i], status: i < 4 ? 'REFERRED' : 'DONE', minutesAgo: 240 - i * 18, staffKey: i % 2 ? 'habimana' : 'uwase' }));
  }
  for (const t of doneOpd.slice(4)) await prisma.visit.update({ where: { id: t.visitId }, data: { finishedAt: t.finishedAt } });
  await ticket({ dept: 'OPD', num: 18, name: 'Fabrice', status: 'IN_CONSULTATION', minutesAgo: 70, staffKey: 'uwase' });
  await ticket({ dept: 'OPD', num: 19, name: 'Divine', status: 'IN_CONSULTATION', minutesAgo: 62, staffKey: 'habimana' });
  await ticket({ dept: 'OPD', num: 20, name: 'Olivier', status: 'CHECKED_IN', minutesAgo: 50, phone: '+250788100020', aheadAtJoin: 5 });
  await ticket({ dept: 'OPD', num: 21, name: 'Joy', status: 'CHECKED_IN', minutesAgo: 41, aheadAtJoin: 5 });
  await ticket({ dept: 'OPD', num: 22, name: 'G. K.', status: 'CHECKED_IN', minutesAgo: 33, priority: 'PRIORITY', priorityReason: 'ELDERLY', phone: '+250722100022', aheadAtJoin: 0 });
  await ticket({ dept: 'OPD', num: 23, name: 'Moses', status: 'CHECKED_IN', minutesAgo: 20, phone: '+250733100023', aheadAtJoin: 4 });

  // Paediatrics and maternity.
  for (const [i, name] of ['Keza', 'Ishimwe', 'Gisa'].entries()) {
    await ticket({ dept: 'PED', num: i + 1, name, status: 'CHECKED_IN', minutesAgo: 45 - i * 9, priority: 'PRIORITY', priorityReason: 'CHILD_UNDER_5', aheadAtJoin: i });
  }
  await ticket({ dept: 'MAT', num: 1, name: 'Esperance', status: 'CHECKED_IN', minutesAgo: 38 });
  await ticket({ dept: 'MAT', num: 2, name: 'Uwineza', status: 'CHECKED_IN', minutesAgo: 25, priority: 'PRIORITY', priorityReason: 'PREGNANT', aheadAtJoin: 0 });

  // LAB, CSH and PHA continue visits referred from OPD earlier today.
  const [r1, r2, r3, r4] = doneOpd;
  const lab1 = await ticket({ dept: 'LAB', num: 1, name: early[0], status: 'REFERRED', minutesAgo: 200, staffKey: 'uwera', visitId: r1.visitId, parentTicketId: r1.id });
  await ticket({ dept: 'LAB', num: 2, name: early[1], status: 'CHECKED_IN', minutesAgo: 30, visitId: r2.visitId, parentTicketId: r2.id, aheadAtJoin: 0 });
  await ticket({ dept: 'LAB', num: 3, name: early[2], status: 'CHECKED_IN', minutesAgo: 22, visitId: r3.visitId, parentTicketId: r3.id, aheadAtJoin: 1 });
  const csh1 = await ticket({ dept: 'CSH', num: 1, name: early[0], status: 'REFERRED', minutesAgo: 150, staffKey: 'habineza', visitId: r1.visitId, parentTicketId: lab1.id });
  await ticket({ dept: 'CSH', num: 2, name: early[3], status: 'CHECKED_IN', minutesAgo: 12, visitId: r4.visitId, parentTicketId: r4.id });
  await ticket({ dept: 'PHA', num: 1, name: early[0], status: 'CHECKED_IN', minutesAgo: 15, visitId: r1.visitId, parentTicketId: csh1.id });

  // Save today's counters so the next OPD ticket is OPD-024.
  for (const [code, n] of Object.entries(counters)) {
    await prisma.department.update({ where: { id: dept[code].id }, data: { dailyCounter: n } });
  }

  await prisma.callLog.createMany({
    data: [
      { hospitalId: hospital.id, ticketNumber: 'LAB-001', room: 'Lab counter 1', staffName: 'Diane Uwera', at: new Date(now - 190 * MIN) },
      { hospitalId: hospital.id, ticketNumber: 'CSH-001', room: 'Cashier window 1', staffName: 'Aimable Habineza', at: new Date(now - 140 * MIN) },
      { hospitalId: hospital.id, ticketNumber: 'OPD-018', room: 'Room 3', staffName: 'Dr. Claudine Uwase', at: new Date(now - 34 * MIN) },
      { hospitalId: hospital.id, ticketNumber: 'OPD-019', room: 'Room 5', staffName: 'Dr. Eric Habimana', at: new Date(now - 26 * MIN) },
    ],
  });

  return { hospitalId: hospital.id, historyTickets: levels.flat().length };
}
