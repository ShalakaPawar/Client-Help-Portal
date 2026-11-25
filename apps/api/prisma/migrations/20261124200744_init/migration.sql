-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CONSULTANT', 'CLIENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('OPEN', 'IN_CALL', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('WAITING', 'ACTIVE', 'ENDED', 'MISSED');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'GRANTED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('PENDING_CONSENT', 'NONE', 'STARTING', 'RECORDING', 'STOPPING', 'FINALIZING', 'AVAILABLE', 'FAILED');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'TRANSCRIBING', 'SUMMARIZING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "EgressKind" AS ENUM ('COMPOSITE', 'VOICE');

-- CreateEnum
CREATE TYPE "EgressStatus" AS ENUM ('STARTING', 'ACTIVE', 'ENDED', 'FAILED');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('RESOLVED', 'UNRESOLVED', 'UNCLEAR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isDefaultConsultant" BOOLEAN NOT NULL DEFAULT false,
    "consultantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "consultantId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "consultantId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'WAITING',
    "consent" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "consentAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "status" "RecordingStatus" NOT NULL DEFAULT 'STARTING',
    "compositeStartedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingEgress" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "kind" "EgressKind" NOT NULL,
    "role" "Role",
    "trackSid" TEXT,
    "pieceNo" INTEGER NOT NULL DEFAULT 1,
    "egressId" TEXT NOT NULL,
    "status" "EgressStatus" NOT NULL DEFAULT 'STARTING',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "filePath" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordingEgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "recordingId" TEXT NOT NULL,
    "segments" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("recordingId")
);

-- CreateTable
CREATE TABLE "Summary" (
    "recordingId" TEXT NOT NULL,
    "overview" TEXT NOT NULL,
    "issuesDiscussed" JSONB NOT NULL,
    "resolution" TEXT,
    "actionItems" JSONB NOT NULL,
    "outcome" "Outcome" NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Summary_pkey" PRIMARY KEY ("recordingId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "HelpRequest_consultantId_status_createdAt_idx" ON "HelpRequest"("consultantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "HelpRequest_clientId_createdAt_idx" ON "HelpRequest"("clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Call_roomName_key" ON "Call"("roomName");

-- CreateIndex
CREATE INDEX "Call_clientId_createdAt_idx" ON "Call"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "Call_consultantId_createdAt_idx" ON "Call"("consultantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Recording_callId_key" ON "Recording"("callId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingEgress_egressId_key" ON "RecordingEgress"("egressId");

-- CreateIndex
CREATE INDEX "RecordingEgress_recordingId_idx" ON "RecordingEgress"("recordingId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingEgress_recordingId_trackSid_key" ON "RecordingEgress"("recordingId", "trackSid");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpRequest" ADD CONSTRAINT "HelpRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpRequest" ADD CONSTRAINT "HelpRequest_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HelpRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingEgress" ADD CONSTRAINT "RecordingEgress_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Summary" ADD CONSTRAINT "Summary_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Business rules Prisma cannot express in schema.prisma (partial unique indexes).
-- These are the real guarantee against races (two clicks on "Start call" at the same moment).
-- A consultant can be in only one live call:
CREATE UNIQUE INDEX "Call_one_live_call_per_consultant" ON "Call"("consultantId") WHERE "status" IN ('WAITING', 'ACTIVE');
-- A request can have only one live call:
CREATE UNIQUE INDEX "Call_one_live_call_per_request" ON "Call"("requestId") WHERE "status" IN ('WAITING', 'ACTIVE');
-- At most one default consultant (new clients are assigned to them on signup):
CREATE UNIQUE INDEX "User_one_default_consultant" ON "User"("isDefaultConsultant") WHERE "isDefaultConsultant" = true;
