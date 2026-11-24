import { Injectable } from '@nestjs/common';
import { HelpRequestDto, RequestStatus, SocketEvent } from '@chp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../common/scope.service';
import { AppException } from '../common/app-exception';
import { requestInclude, toRequestDto } from '../common/mappers';
import { RealtimeService } from '../realtime/realtime.service';
import type { AuthUser } from '../common/auth.decorators';

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly realtime: RealtimeService,
  ) {}

  async create(client: AuthUser, title: string, description: string): Promise<HelpRequestDto> {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: client.id } });
    if (!me.consultantId) throw AppException.invalidState('You have no consultant assigned yet');

    const created = await this.prisma.helpRequest.create({
      data: { clientId: me.id, consultantId: me.consultantId, title: title.trim(), description: description.trim() },
      include: requestInclude,
    });
    const dto = toRequestDto(created);
    this.realtime.emitTo(dto.consultant.id, SocketEvent.REQUEST_CREATED, dto);
    return dto;
  }

  async list(user: AuthUser, status?: RequestStatus): Promise<HelpRequestDto[]> {
    const rows = await this.prisma.helpRequest.findMany({
      where: { ...this.scope.requestWhere(user), ...(status ? { status } : {}) },
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toRequestDto);
  }

  async get(user: AuthUser, id: string): Promise<HelpRequestDto> {
    const row = await this.prisma.helpRequest.findFirst({
      where: { id, ...this.scope.requestWhere(user) },
      include: requestInclude,
    });
    if (!row) throw AppException.notFound('Request');
    return toRequestDto(row);
  }

  cancel(client: AuthUser, id: string) {
    return this.transition(client, id, [RequestStatus.OPEN], RequestStatus.CANCELLED, 'Only open requests can be cancelled');
  }

  resolve(consultant: AuthUser, id: string) {
    return this.transition(
      consultant,
      id,
      [RequestStatus.OPEN],
      RequestStatus.RESOLVED,
      'Only open requests can be marked resolved (end the call first)',
    );
  }

  reopen(consultant: AuthUser, id: string) {
    return this.transition(consultant, id, [RequestStatus.RESOLVED], RequestStatus.OPEN, 'Only resolved requests can be reopened');
  }

  /** Change status only if the request is yours and currently in one of `from`. */
  private async transition(user: AuthUser, id: string, from: RequestStatus[], to: RequestStatus, errorMessage: string) {
    await this.get(user, id); // 404 if not yours
    const { count } = await this.prisma.helpRequest.updateMany({
      where: { id, ...this.scope.requestWhere(user), status: { in: from } },
      data: { status: to },
    });
    if (count === 0) throw AppException.invalidState(errorMessage);
    const dto = await this.get(user, id);
    this.notifyUpdated(dto);
    return dto;
  }

  notifyUpdated(dto: HelpRequestDto) {
    this.realtime.emitTo([dto.client.id, dto.consultant.id], SocketEvent.REQUEST_UPDATED, dto);
  }

  async notifyUpdatedById(id: string) {
    const row = await this.prisma.helpRequest.findUnique({ where: { id }, include: requestInclude });
    if (row) this.notifyUpdated(toRequestDto(row));
  }
}
