import { Injectable } from '@nestjs/common';
import { CallDto, HistoryDetailDto, Paginated } from '@chp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../common/scope.service';
import { AppException } from '../common/app-exception';
import { callInclude, toCallDto, toSummaryDto, toTranscriptDto } from '../common/mappers';
import type { AuthUser } from '../common/auth.decorators';

const PAGE_SIZE = 20;

@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  /** Past calls (ended or missed), newest first, cursor-paginated by call id. */
  async list(user: AuthUser, cursor?: string): Promise<Paginated<CallDto>> {
    const rows = await this.prisma.call.findMany({
      where: { ...this.scope.callWhere(user), status: { in: ['ENDED', 'MISSED'] } },
      include: callInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, PAGE_SIZE).map(toCallDto);
    return { items, nextCursor: rows.length > PAGE_SIZE ? items[items.length - 1].id : null };
  }

  async detail(user: AuthUser, callId: string): Promise<HistoryDetailDto> {
    const call = await this.prisma.call.findFirst({
      where: { id: callId, ...this.scope.callWhere(user) },
      include: { ...callInclude, recording: { include: { transcript: true, summary: true } } },
    });
    if (!call) throw AppException.notFound('Call');
    return {
      call: toCallDto(call),
      requestStatus: call.request.status,
      transcript: call.recording?.transcript ? toTranscriptDto(call.recording.transcript.segments) : null,
      summary: call.recording?.summary ? toSummaryDto(call.recording.summary) : null,
    };
  }
}
