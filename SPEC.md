# Umurongo - Claude Code MVP Prompt

> Repo note: in this repo `apps/web` lives in `Umurongo_frontend/` and `apps/api` lives in `Umurongo_backend/`. The logo is `2.png` (copied to `Umurongo_frontend/public/logo.png`). Prototype: https://plugin-penny-80613556.figma.site/

## 1. Product
Umurongo ("the line" in Kinyarwanda) is a hospital queue and visit-preparation system for Rwanda. Tagline: Know your place. Know your next step.

Problem. At hospitals such as Masaka Hospital (Kicukiro, Kigali), patients lose time twice: they wait for hours without knowing if the doctor they need is available or when their turn will come, and at reception many are sent back because Mutuelle is unpaid, the referral (transfer) letter is missing, or the ID or insurance card is forgotten.

Solution. Patients take their place in line from a phone, follow their live position, complete a Ready Check (ID, insurance, referral letter) while waiting, get called to the right room, and are guided through every next step (lab, cashier, pharmacy) until the visit is done. Staff run everything from a web dashboard on laptops. A waiting-room TV shows who is called.

Goal of this MVP. A working, deployed product for a hackathon pitch on 29–30 October 2026: judges open a public link (no sign-in for the patient side), join a queue on their phones, and watch it move live when a doctor clicks "Call next" on a laptop.

## 2. Users (MVP)
| Role | Device | Can do |
|---|---|---|
| Patient | Phone browser (mobile-first PWA) | Join a queue, follow live position, Ready Check, check in, see next steps, rate the visit |
| Receptionist | Laptop | Register walk-ins, check patients in, confirm Ready Check, confirm priority, reorder with a reason, change a doctor's status |
| Doctor | Laptop/tablet | Set own status, call next, start, finish, refer, send to cashier, no-show |
| Cashier | Laptop | Call next payer, record insurance share and method, mark paid, print receipt |
| (Device) Waiting-room TV | TV browser | Read-only: now calling, next tickets, doctor status |

Lab technicians and pharmacists use the same "My queue" screen as doctors (role DOCTOR, with their counter as the room), so Laboratory and Pharmacy queues work without extra screens.

Hospital admin and multi-hospital management are out of scope (seed data instead), but every table carries hospitalId so they can be added later.

## 3. Tech stack (required)
- Monorepo with npm workspaces: apps/web (React), apps/api (Node.js), packages/shared (TypeScript types and queue rules).
- Frontend: React 18 + TypeScript + Vite + React Router + Tailwind CSS + TanStack Query + socket.io-client + lucide-react icons. Mobile-first PWA (manifest + service worker via vite-plugin-pwa).
- Backend: Node.js 20 + Express + TypeScript + Socket.IO + Zod validation + JWT auth (jsonwebtoken, bcrypt).
- Database: PostgreSQL 16 with Prisma ORM, migrations and a seed script.
- Tests: Vitest for the queue rules in packages/shared and API route tests with Supertest.
- Local DB: docker-compose.yml with a postgres:16 service; .env.example with DATABASE_URL, JWT_SECRET, CORS_ORIGIN, SMS_MODE=simulate.
- Deploy: API + PostgreSQL on Render (or Railway); web on Vercel (or Netlify). Write DEPLOY.md with exact steps.
- Do not add other frameworks. Keep dependencies minimal.

## 4. Design system
Brand colours (put them in tailwind.config as named colours): navy #25476E, navy-dark #25406D, green #4DB282, green-ink #23784F, mint #E4F5EC, sky #E8F1FA, orange #E8792B (only the one main action per screen), ink #1D2630, muted #5F6B78, line #DCE5EE, bg #F4F8FC. Status: Available = green; In consultation / On break = amber #B9770E on #FDF1DC; In surgery / Away = red #C9423E on #FBE9E8; Off duty = grey #7D8894 on #EEF1F4. Chips always show dot + text. Fonts (Google Fonts): Nunito 800–900 for headings and ticket numbers, Nunito Sans for body. Cards: radius 16px, 1px border, no heavy shadows. Ticket numbers are large and green. Minimum body 15px; touch targets 44px. No browser alert/confirm; use in-app dialogs and toasts. Languages: patient app in Kinyarwanda (default) and English with a switch (simple i18n.ts dictionary). Staff UI in English. TV bilingual.

## 5. Data model (Prisma)
Create these models (camelCase fields, id as cuid, createdAt/updatedAt on all):

- Hospital { name, district, address, openingHours }
- Department { hospitalId, code (OPD/PED/MAT/LAB/CSH/PHA/IMG/DEN), nameEn, nameRw, prefix, avgMinutes, isOpen, locationEn, locationRw, dailyCounter, counterDate }
- Staff { hospitalId, departmentId?, fullName, email (unique), passwordHash, role enum(RECEPTIONIST, DOCTOR, CASHIER), title, room, status enum(AVAILABLE, ON_BREAK, IN_SURGERY, AWAY, OFF_DUTY), backAt? }
- Patient { phone (unique), name?, preferredLanguage enum(RW, EN) }
- Ticket { hospitalId, departmentId, patientId?, walkInName?, walkInPhone?, number (e.g. "OPD-024"), priority enum(NORMAL, PRIORITY, EMERGENCY), priorityRequest enum(NONE, PREGNANT, ELDERLY, DISABILITY, CHILD_UNDER_5), channel enum(APP, SMS, WALK_IN), status enum(WAITING, CHECKED_IN, CALLED, IN_CONSULTATION, DONE, REFERRED, NO_SHOW, CANCELLED), preferredStaffId?, staffId?, parentTicketId?, visitId, note?, sortKey (Float, starts as join time ms), joinedAt, checkedInAt?, calledAt?, startedAt?, finishedAt? }
- Visit { patientId?, startedAt, finishedAt?, rating?, comment? } - groups the tickets of one hospital visit.
- ReadyCheck { visitId (unique), fullName, dateOfBirth, nationalId (store encrypted with AES-256-GCM using DATA_KEY env var), insuranceType enum(MUTUELLE, RSSB, MMI, PRIVATE, NONE), memberNumber?, mutuelleStatus enum(PAID, NOT_SURE, NOT_PAID, NA), cardPhotoUrl?, referral enum(YES, NO, EMERGENCY), referralPhotoUrl?, reason enum(FEVER, FOLLOW_UP, PREGNANCY, SICK_CHILD, OTHER), consentAt, confirmedById?, confirmedAt? } with a computed status READY / NEEDS_ATTENTION / NOT_STARTED.
- Payment { ticketId, cashierId, insuranceType, patientShareRwf (Int), method enum(CASH, MTN_MOMO, AIRTEL_MONEY, CARD), receiptNumber (unique, "R-00001"), paidAt }
- TicketEvent { ticketId, type, byStaffId?, reason?, at } - audit log for every status change, reorder and priority change.
- Notification { ticketId, patientId?, kind enum(JOINED, GET_READY, CALLED, STATUS_CHANGED, REFERRED, PAY, DONE), textEn, textRw, channel enum(IN_APP, SMS), sentAt }
- CallLog { hospitalId, ticketNumber, room, staffName, at } - feeds the TV.

Photos in the MVP: store as small compressed data URLs or in /uploads on the API; delete photos when a visit closes.

## 6. Queue rules (put in packages/shared/queue.ts, unit-test them)
- Ticket number = department prefix + daily counter, 3 digits; counter resets each day.
- Order within a department: EMERGENCY, then PRIORITY, then sortKey ascending.
- Only CHECKED_IN tickets can be called. "Call next" for a doctor picks the first checked-in ticket of their department whose preferredStaffId is empty or equals that doctor.
- Estimated wait (minutes) = max(2, round((peopleAhead + 0.6) * avgMinutes / availableStaffCount)); if no staff is AVAILABLE, return null ("No doctor available right now").
- "Get ready" notification once when peopleAhead <= 3.
- A patient may hold only one active ticket per department.
- Refer: current ticket → REFERRED; new ticket in the target department, same visit, same priority, status CHECKED_IN, parentTicketId set.
- Send to cashier: same as refer with target CSH; after payment, the cashier chooses "Send to pharmacy" (new PHA ticket) or "Close visit".
- Reorder: swap sortKey with the neighbour of the same priority; requires a reason; write a TicketEvent.
- Status change of a doctor: notify patients waiting in that department with the new estimate.
- Priority requested by a patient is only a request until a receptionist confirms or declines it.
- Cancel: WAITING or CHECKED_IN → CANCELLED.
- Grace rule (simple version): if a CALLED ticket is not started in 10 minutes, reception can mark NO_SHOW or "Call again".

## 7. API (REST under /api, JSON, Zod-validated)
Public / patient (patient token issued after phone + 6-digit code; SMS_MODE=simulate accepts any 6 digits and logs the "SMS" to the console and to a /api/dev/sms-log endpoint):

- POST /auth/patient/request-code {phone} · POST /auth/patient/verify {phone, code} → patient JWT
- GET /hospital (hospital, departments with waiting counts, open state, estimated wait for a new patient)
- GET /departments/:id/staff (name, title, room, status, backAt)
- POST /tickets {departmentId, preferredStaffId?, forName?, priorityRequest} · GET /me/tickets · GET /tickets/:id (with peopleAhead, estimate, queue preview, visit steps)
- POST /tickets/:id/check-in · POST /tickets/:id/cancel
- PUT /visits/:id/ready-check · GET /visits/:id/ready-check
- POST /visits/:id/feedback {rating, comment}
- GET /me/notifications

Staff (email + password → JWT with role; middleware checks role):

- POST /auth/staff/login
- Reception: POST /walk-ins, GET /queues?departmentId=, POST /tickets/:id/check-in, POST /tickets/:id/priority {priority}, POST /tickets/:id/priority-request {decision}, POST /tickets/:id/reorder {direction, reason}, POST /ready-checks/:visitId/confirm, GET /arrivals, GET /search?q=
- Doctor: PATCH /staff/me/status {status}, POST /staff/me/call-next, POST /staff/me/start, POST /staff/me/finish, POST /staff/me/refer {departmentCode, note}, POST /staff/me/send-to-cashier, POST /staff/me/no-show, GET /staff/me/queue
- Reception may change any doctor's status: PATCH /staff/:id/status
- Cashier: GET /cashier/queue, POST /cashier/call-next, POST /cashier/pay {ticketId, insuranceType, patientShareRwf, method, next: "PHARMACY" | "CLOSE"}, GET /cashier/summary
- TV (public, read-only): GET /tv (last 4 calls, next 5 tickets for OPD, LAB, CSH, PHA, staff statuses)
- Dev only (NODE_ENV!==production or DEMO_MODE=true): POST /dev/advance (every AVAILABLE staff finishes and calls next; the seeded demo journey OPD → LAB → CSH → PHA → DONE; random walk-ins), POST /dev/reset (re-seed).

## 8. Real-time (Socket.IO)
Rooms: hospital:<id>, department:<id>, ticket:<id>, patient:<id>, tv:<hospitalId>. Server emits after every change: queue:updated {departmentId}, ticket:updated {ticket}, staff:status {staffId, status}, call:new {ticketNumber, room, staffName}, notification:new {notification}. Clients refetch with TanStack Query on these events. Reconnect automatically; show a small "Live" / "Reconnecting…" indicator.

## 9. Screens
Patient app (/ mobile-first): Splash → Language → Onboarding (3 slides) → Phone → Code → Home (greeting, active ticket card, quick actions "Join a queue" / "Check doctors", nearby hospital, doctors available now) → Hospital (departments with chips) → Department (stat tiles, now serving, doctor cards) → Join queue (department, preferred doctor, for me / someone else, priority request, "You will be number N") → Live ticket (huge green number, people ahead, estimate, vertical queue line, Ready Check card, "I have arrived", QR code, visit steps, cancel with in-app confirm) → Ready Check (5 steps + consent, status Ready / Needs attention) → Your turn (full-screen green overlay, room, "I'm on my way", vibration with navigator.vibrate when available) → Next step (Lab, Cashier, Pharmacy with location) → Visit complete (times, stars, comment) → My tickets, Notifications, Profile (language, SMS toggle, privacy note, sign out). Bottom nav: Home · My tickets · Hospitals · Profile.

Staff dashboard (/staff): Login page (split navy panel + form). Layout: navy sidebar (logo, hospital box, menu by role, user card + sign out), top bar (title, date, live clock, search). Pages: Reception desk (walk-in form, printable ticket via window.print() on a print stylesheet, arrivals list, Ready Check to confirm, priority requests), Queue board (department tabs, ordered list, priority select, reorder with reason, rooms with "Call next"), Overview (KPI tiles, department cards, alerts, doctor status table), My queue (doctor), Payments (cashier, receipt preview + print).

TV (/tv): 16:9 full-screen layout: navy top band with clock, "Turahamagara / Now calling" huge green number + room + staff, last 3 calls, "Abakurikira / Next" lists for OPD, LAB, CSH, PHA, bottom band with doctor status chips and rotating bilingual messages; "Turn sound on" button (Web Audio two-tone chime on call:new); flash animation on a new call.

Demo bar (only when VITE_DEMO_MODE=true): a thin navy bar on /demo showing the phone frame (patient app in an iframe of /) next to the staff dashboard, plus buttons "Advance queue", "Auto-play" (every 9 s) and "Reset demo".

## 10. Seed data (prisma/seed.ts)
Masaka Hospital, Kicukiro. Departments: OPD 12 min (Ground floor, Wing A), PED 15, MAT 20, LAB 6 (ground floor left of reception), CSH 3 (Cashier windows 1–2), PHA 4 (main entrance right), IMG 10, DEN closed. Staff (password demo1234 for all): Dr. Claudine Uwase (OPD, Room 3, AVAILABLE, claudine@masaka.demo), Dr. Eric Habimana (OPD, Room 5, AVAILABLE), Dr. Grace Mukamana (OPD, Room 6, IN_SURGERY, back 14:00), Dr. Jean Bosco Niyonzima (OPD, OFF_DUTY), Dr. Alice Ingabire (PED, Room 7), Dr. Patrick Mugisha (MAT, Room 9), Diane Uwera (LAB, Lab counter 1), Samuel Nkurunziza (PHA, Pharmacy window 2), Aimable Habineza (CASHIER, Cashier window 1, cashier@masaka.demo), Josiane Mutoni (RECEPTIONIST, reception@masaka.demo). Tickets: OPD-010…017 DONE, OPD-018 and OPD-019 IN_CONSULTATION, OPD-020…022 CHECKED_IN (022 PRIORITY elderly), OPD-023 WAITING via SMS; PED 4 waiting; MAT 2 (one PRIORITY pregnant); LAB 2; CSH 1; PHA 2. Names as Rwandan initials ("J. Habyarimana"). Demo patient: Aline, +250 788 123 456. Invented data only; National IDs are fake (e.g. "1 1995 8 0000000 0 00").

## 11. Security and privacy (MVP level)
Hash staff passwords with bcrypt; JWT expiry 8 h staff / 30 days patient; role middleware on every staff route; patients can only read their own tickets and visit; encrypt National ID; doctors never receive Ready Check ID or insurance numbers; CORS limited to the web origin; rate-limit auth routes; validate every input with Zod; no secrets in the repo; .env.example only.

## 12. Milestones (build in this order, commit after each)
1. Foundation: monorepo, Docker PostgreSQL, Prisma schema + migration + seed, Express API skeleton with health check, React app with Tailwind tokens, fonts and routing. Run both with npm run dev.
2. Queue core: packages/shared/queue.ts with tests; patient auth (simulated SMS); join queue, live ticket, check-in, cancel; Socket.IO live updates.
3. Staff core: staff login; doctor "My queue" (status, call next, start, finish, refer, no-show); reception walk-ins, arrivals, check-in.
4. Visit flow: Ready Check (patient form + reception confirm), cashier payments and receipt, pharmacy step, visit complete + rating, notifications.
5. TV + overview: TV page with chime, queue board with reorder + audit, overview KPIs and alerts.
6. Polish + demo: Kinyarwanda/English, empty and error states, PWA manifest, /demo page with Advance / Auto-play / Reset, responsive checks at 390 px and 1366 px.
7. Deploy: Render (API + PostgreSQL) and Vercel (web), seed production demo data, DEPLOY.md, README with demo logins.

## 13. Acceptance test (the pitch demo must pass this)
- On a phone, open the public link, choose Kinyarwanda, sign in with any 6 digits, join OPD → ticket OPD-024, position shown, estimate shown.
- Complete Ready Check → ticket shows Ready. Tap "I have arrived".
- On a laptop, sign in as Dr. Uwase, click Call next until OPD-024 is called; the phone shows the green "It's your turn – Room 3" screen within 2 seconds and the TV flashes OPD-024.
- Doctor clicks Refer → Laboratory; the phone shows LAB-0xx with the location. Lab staff finishes and sends to cashier; cashier records Mutuelle share via MTN MoMo, prints receipt, sends to pharmacy; pharmacy finishes; the phone shows Visit complete with total time; rating saves.
- Reception registers a walk-in with Priority; it moves ahead correctly; reorder asks for a reason and appears in the audit log.
- Set Dr. Habimana to On break; waiting patients get a notification with the new estimate.
- All tests pass (npm test), no console errors, Lighthouse mobile score ≥ 85 on the patient app.

## 14. Working rules for you (Claude Code)
- Ask me before changing the stack or adding paid services.
- Keep code simple and readable for a junior team; comment the queue rules.
- After each milestone, give me: what changed, how to run it, what to click to test.
- If time is short, finish milestones 1–4 and 6 first; the demo must never break.
