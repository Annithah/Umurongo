# Umurongo

**Know your place. Know your next step.** · *Menya umwanya wawe. Menya aho ukurikira.*

A patient-flow layer for hospital outpatient departments in Rwanda. Patients see their live place in
line, the estimated wait, whether doctors are available, what to bring, and their next step (lab,
cashier, pharmacy). Staff run the queue from laptops. A waiting-room TV shows who is called.
It works beside e-Ubuzima and **never stores medical data**. Pilot 1 stores no National ID and no photos.

| Screen | URL | Who |
|---|---|---|
| Patient ticket page | `/t/<token>` (QR code or SMS link) | Patients. No login, Kinyarwanda by default |
| Staff | `/staff` | Reception, clinicians, lab, cashier, pharmacy, hospital admin |
| Waiting-room TV | `/tv` | Read-only, bilingual, 1920x1080 |

## Demo accounts (password `demo1234`, invented data)

| Email | Role | Lands on |
|---|---|---|
| reception@masaka.demo | Reception (Josiane Mutoni) | Reception desk |
| claudine@masaka.demo | Clinician, OPD Room 3 | My queue |
| eric@masaka.demo | Clinician, OPD Room 5 | My queue |
| diane@masaka.demo | Counter: Laboratory | My queue |
| cashier@masaka.demo | Counter: Cashier | My queue |
| samuel@masaka.demo | Counter: Pharmacy | My queue |
| admin@masaka.demo | Hospital admin | Analytics |

## Run it locally

Requirements: Node 20+, PostgreSQL 16+.

```bash
npm install
cp Umurongo_backend/.env.example Umurongo_backend/.env     # then set DATABASE_URL, TEST_DATABASE_URL, JWT_SECRET
cp Umurongo_frontend/.env.example Umurongo_frontend/.env
npm run db:migrate                                            # creates the tables
npm run db:seed                                               # Masaka Hospital + 29 days of invented history
npm run dev                                                   # API on :4000, web on :5173
```

**Local database on Windows.** This machine uses a private PostgreSQL 18 cluster in
`%LOCALAPPDATA%\umurongo-pg` on port 5433 (the system PostgreSQL password was unknown).
Start it with `npm run db:start` after a reboot and stop it with `npm run db:stop`.
With Docker instead: `npm run db:up` (port 5432).

A phone on the same Wi-Fi can open `http://<your-computer-ip>:5173`.

## Tests

```bash
npm test             # shared rules, API (Supertest, real database), web components (Vitest + Testing Library)
npm run test:e2e     # Playwright: reception -> patient phone -> doctor -> TV (first time: npx playwright install chromium)
```

The API and end-to-end tests re-seed the database in `TEST_DATABASE_URL`. If no database is reachable
the API suite **fails** with a clear message; set `SKIP_DB_TESTS=1` to skip it on purpose.

## How it fits together

```
packages/shared/        The rules, used by API and web alike
  src/queue.ts          ordering, call next, estimates, grace period, get-ready, progress
  src/messages.ts       SMS templates, GSM-7 checks, 160-character limit
  src/i18n/rw.ts        ALL Kinyarwanda text (marked "needs native check"); en.ts mirrors it
  src/journey.ts        Reception > Consultation > Lab/Cashier/Pharmacy > Done
  src/analytics.ts      medians, percentiles, per-hour, no-show rate, CSV (formula-safe)
  src/time.ts           Kigali time, opening hours, daily close
  src/phone.ts          Rwandan mobile numbers, display-name rule
Umurongo_backend/       Express + Prisma (PostgreSQL) + Socket.IO
  src/services/         queue.ts (every state change), views.ts (API shapes), analytics, audit
  src/routes/           auth, staff (reception + my queue), public (ticket, TV), admin, sms, dev
  src/sms/              SmsProvider interface; simulate, Africa's Talking, generic HTTP; outbox with retries
  src/jobs/             SMS outbox, daily close, retention; scheduler with a PostgreSQL lock; CLI
  test/                 Supertest suites (queue, privacy, roles, SMS, admin, jobs, realtime)
Umurongo_frontend/      React 18 + Vite + Tailwind + TanStack Query, PWA
  src/patient/          ticket page (TicketView is pure and tested state by state)
  src/tv/               waiting-room TV
  src/staff/            reception, queue board, team, my queue, analytics, SMS panel, admin/*
  src/theme/tokens.js   the only place colours are defined (Tailwind and the QR code use it)
e2e/                    Playwright end-to-end test
```

Live updates: the API emits `queue:update`, `ticket:update`, `call:new`, `staff:status` and
`sms:changed` to rooms. Screens refetch and show **Live** or **Reconnecting...**. After a reconnect
every screen refetches, and the TV announces a call it missed only if it is recent.

## Privacy

- **No medical data.** Patients are a display name (first name or initials) and a ticket.
- **Phone numbers** are optional, for SMS only. Only reception (and admins) receive them from the API.
  Clinicians, counters, the TV and the patient page never do (tested). The retention job removes them
  after 30 days (configurable), from tickets, the SMS outbox and inbound SMS.
- **Patient links** use a random 128-bit token. Staff invite tokens are stored hashed.
- **Staff sessions** last 8 hours and live in the browser tab only (sessionStorage). Every request
  re-checks the account, so deactivating someone signs them out at once.
- Every input is validated with Zod; every staff route checks the role; sign-in is rate-limited per IP
  and per account; every queue action and admin change is in the audit log with who and why.
- All demo data is invented.

Deployment: see [DEPLOY.md](DEPLOY.md).
