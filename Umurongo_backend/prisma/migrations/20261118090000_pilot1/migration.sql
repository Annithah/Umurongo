-- Pilot 1 data model.
-- Removes patient accounts, Ready Check (National ID, card photos), payments and in-app
-- notifications, which are out of scope for pilot 1, and adds rooms, settings, an SMS
-- outbox, a general audit log and job runs.
--
-- The previous model only ever held invented demo data, and its rows cannot be mapped to the
-- new one (tickets had no display name or link token), so the demo data is cleared first.
-- Run `npm run db:seed` afterwards.
TRUNCATE TABLE "Notification", "TicketEvent", "Payment", "CallLog", "ReadyCheck", "Ticket", "Visit", "Patient", "Staff", "Department", "Hospital" CASCADE;

-- CreateEnum
CREATE TYPE "DepartmentKind" AS ENUM ('CONSULTATION', 'LAB', 'CASHIER', 'PHARMACY', 'IMAGING', 'OTHER');

-- CreateEnum
CREATE TYPE "PriorityReason" AS ENUM ('NONE', 'PREGNANT', 'ELDERLY', 'DISABILITY', 'CHILD_UNDER_5');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('SIMULATED', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "FeedbackAnswer" AS ENUM ('YES', 'NO');

-- AlterEnum
BEGIN;
CREATE TYPE "Channel_new" AS ENUM ('WALK_IN', 'NEXT_STEP');
ALTER TABLE "public"."Ticket" ALTER COLUMN "channel" DROP DEFAULT;
ALTER TABLE "Ticket" ALTER COLUMN "channel" TYPE "Channel_new" USING ("channel"::text::"Channel_new");
ALTER TYPE "Channel" RENAME TO "Channel_old";
ALTER TYPE "Channel_new" RENAME TO "Channel";
DROP TYPE "public"."Channel_old";
ALTER TABLE "Ticket" ALTER COLUMN "channel" SET DEFAULT 'WALK_IN';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "StaffRole_new" AS ENUM ('RECEPTIONIST', 'CLINICIAN', 'COUNTER', 'HOSPITAL_ADMIN');
ALTER TABLE "Staff" ALTER COLUMN "role" TYPE "StaffRole_new" USING ("role"::text::"StaffRole_new");
ALTER TYPE "StaffRole" RENAME TO "StaffRole_old";
ALTER TYPE "StaffRole_new" RENAME TO "StaffRole";
DROP TYPE "public"."StaffRole_old";
COMMIT;

-- AlterEnum
ALTER TYPE "StaffStatus" ADD VALUE 'IN_CONSULTATION';

-- AlterEnum
ALTER TYPE "TicketStatus" ADD VALUE 'CLOSED';

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_patientId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_ticketId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_cashierId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_ticketId_fkey";

-- DropForeignKey
ALTER TABLE "ReadyCheck" DROP CONSTRAINT "ReadyCheck_confirmedById_fkey";

-- DropForeignKey
ALTER TABLE "ReadyCheck" DROP CONSTRAINT "ReadyCheck_visitId_fkey";

-- DropForeignKey
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_patientId_fkey";

-- DropForeignKey
ALTER TABLE "TicketEvent" DROP CONSTRAINT "TicketEvent_byStaffId_fkey";

-- DropForeignKey
ALTER TABLE "TicketEvent" DROP CONSTRAINT "TicketEvent_ticketId_fkey";

-- DropForeignKey
ALTER TABLE "Visit" DROP CONSTRAINT "Visit_patientId_fkey";

-- DropIndex
DROP INDEX "Ticket_patientId_idx";

-- AlterTable
ALTER TABLE "CallLog" DROP COLUMN "createdAt",
DROP COLUMN "updatedAt";

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "closesAt" TEXT NOT NULL DEFAULT '19:00',
ADD COLUMN     "kind" "DepartmentKind" NOT NULL DEFAULT 'CONSULTATION',
ADD COLUMN     "lastClosedOn" TEXT,
ADD COLUMN     "opensAt" TEXT NOT NULL DEFAULT '07:00',
ADD COLUMN     "requirementsEn" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "requirementsRw" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "showOnTv" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "avgMinutes" DROP NOT NULL,
ALTER COLUMN "locationEn" SET DEFAULT '',
ALTER COLUMN "locationRw" SET DEFAULT '';

-- AlterTable
ALTER TABLE "Hospital" DROP COLUMN "openingHours",
ADD COLUMN     "defaultConsultMinutes" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "feedbackSmsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "getReadyAhead" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "graceMinutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "retentionDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "smsSenderId" TEXT NOT NULL DEFAULT 'UMURONGO';

-- AlterTable
ALTER TABLE "Staff" DROP COLUMN "room",
ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "inviteExpiresAt" TIMESTAMP(3),
ADD COLUMN     "inviteTokenHash" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "roomId" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL,
ALTER COLUMN "title" SET DEFAULT '',
ALTER COLUMN "status" SET DEFAULT 'OFF_DUTY';

-- AlterTable
ALTER TABLE "Ticket" DROP COLUMN "patientId",
DROP COLUMN "priorityRequest",
DROP COLUMN "walkInName",
DROP COLUMN "walkInPhone",
ADD COLUMN     "aheadAtJoin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "displayName" TEXT NOT NULL,
ADD COLUMN     "language" "Language" NOT NULL DEFAULT 'RW',
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phoneRemovedAt" TIMESTAMP(3),
ADD COLUMN     "priorityReason" "PriorityReason" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "publicToken" TEXT NOT NULL,
ALTER COLUMN "channel" SET DEFAULT 'WALK_IN',
ALTER COLUMN "status" SET DEFAULT 'CHECKED_IN';

-- AlterTable
ALTER TABLE "Visit" DROP COLUMN "comment",
DROP COLUMN "patientId",
DROP COLUMN "rating",
ADD COLUMN     "feedbackAnswer" "FeedbackAnswer",
ADD COLUMN     "feedbackAt" TIMESTAMP(3),
ADD COLUMN     "feedbackRequestedAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "Notification";

-- DropTable
DROP TABLE "Patient";

-- DropTable
DROP TABLE "Payment";

-- DropTable
DROP TABLE "ReadyCheck";

-- DropTable
DROP TABLE "TicketEvent";

-- DropEnum
DROP TYPE "InsuranceType";

-- DropEnum
DROP TYPE "MutuelleStatus";

-- DropEnum
DROP TYPE "NotificationChannel";

-- DropEnum
DROP TYPE "NotificationKind";

-- DropEnum
DROP TYPE "PaymentMethod";

-- DropEnum
DROP TYPE "PriorityRequest";

-- DropEnum
DROP TYPE "Referral";

-- DropEnum
DROP TYPE "VisitReason";

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "departmentId" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "ticketId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "reason" TEXT,
    "detail" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "ticketId" TEXT,
    "to" TEXT,
    "language" "Language" NOT NULL,
    "template" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "SmsStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundSms" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT,
    "from" TEXT,
    "text" TEXT NOT NULL,
    "visitId" TEXT,
    "answer" "FeedbackAnswer",
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundSms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN,
    "summary" JSONB,
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Room_hospitalId_name_key" ON "Room"("hospitalId", "name");

-- CreateIndex
CREATE INDEX "AuditLog_hospitalId_at_idx" ON "AuditLog"("hospitalId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_ticketId_idx" ON "AuditLog"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "SmsMessage_providerMessageId_key" ON "SmsMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "SmsMessage_status_nextAttemptAt_idx" ON "SmsMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "SmsMessage_to_idx" ON "SmsMessage"("to");

-- CreateIndex
CREATE INDEX "JobRun_job_startedAt_idx" ON "JobRun"("job", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_inviteTokenHash_key" ON "Staff"("inviteTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_publicToken_key" ON "Ticket"("publicToken");

-- CreateIndex
CREATE INDEX "Ticket_hospitalId_joinedAt_idx" ON "Ticket"("hospitalId", "joinedAt");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

