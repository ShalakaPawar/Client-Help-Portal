import { Prisma } from '@prisma/client';
import type {
  CallDto,
  HelpRequestDto,
  RecordingSummaryDto,
  SummaryDto,
  TranscriptSegmentDto,
  UserDto,
} from '@chp/shared';

/** Prisma includes that the mappers below expect. Keep them next to the mappers. */
export const requestInclude = {
  client: { select: { id: true, name: true } },
  consultant: { select: { id: true, name: true } },
  calls: { where: { status: { in: ['WAITING', 'ACTIVE'] } }, select: { id: true }, take: 1 },
} satisfies Prisma.HelpRequestInclude;

export const callInclude = {
  client: { select: { id: true, name: true } },
  consultant: { select: { id: true, name: true } },
  request: { select: { title: true, status: true } },
  recording: true,
} satisfies Prisma.CallInclude;

type RequestRow = Prisma.HelpRequestGetPayload<{ include: typeof requestInclude }>;
type CallRow = Prisma.CallGetPayload<{ include: typeof callInclude }>;

export function toUserDto(u: { id: string; email: string; name: string; role: UserDto['role'] }): UserDto {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

export function toRequestDto(r: RequestRow): HelpRequestDto {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    client: r.client,
    consultant: r.consultant,
    activeCallId: r.calls[0]?.id ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toRecordingSummary(rec: CallRow['recording']): RecordingSummaryDto | null {
  if (!rec) return null;
  return {
    id: rec.id,
    status: rec.status,
    processingStatus: rec.processingStatus,
    partial: rec.partial,
    durationMs: rec.durationMs,
    lastError: rec.lastError,
  };
}

export function toCallDto(c: CallRow): CallDto {
  return {
    id: c.id,
    requestId: c.requestId,
    requestTitle: c.request.title,
    status: c.status,
    consent: c.consent,
    client: c.client,
    consultant: c.consultant,
    startedAt: c.startedAt?.toISOString() ?? null,
    endedAt: c.endedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    recording: toRecordingSummary(c.recording),
  };
}

export function toSummaryDto(s: {
  overview: string;
  issuesDiscussed: Prisma.JsonValue;
  resolution: string | null;
  actionItems: Prisma.JsonValue;
  outcome: SummaryDto['outcome'];
  model: string;
}): SummaryDto {
  return {
    overview: s.overview,
    issuesDiscussed: (s.issuesDiscussed as string[]) ?? [],
    resolution: s.resolution,
    actionItems: (s.actionItems as unknown as SummaryDto['actionItems']) ?? [],
    outcome: s.outcome,
    model: s.model,
  };
}

export function toTranscriptDto(segments: Prisma.JsonValue): TranscriptSegmentDto[] {
  return (segments as unknown as TranscriptSegmentDto[]) ?? [];
}
