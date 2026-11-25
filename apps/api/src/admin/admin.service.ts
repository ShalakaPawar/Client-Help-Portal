import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AdminClientDto, AdminConsultantDto, ErrorCode, Role } from '@chp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/app-exception';

/**
 * Account management for the admin: consultants, the default consultant for new signups,
 * and which consultant each client is assigned to. The admin has no access to requests,
 * calls, recordings or history.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async consultants(): Promise<AdminConsultantDto[]> {
    const rows = await this.prisma.user.findMany({
      where: { role: Role.CONSULTANT },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, isDefaultConsultant: true, _count: { select: { clients: true } } },
    });
    return rows.map((c) => ({ id: c.id, name: c.name, email: c.email, isDefault: c.isDefaultConsultant, clientCount: c._count.clients }));
  }

  async createConsultant(name: string, email: string, password: string): Promise<AdminConsultantDto> {
    try {
      const c = await this.prisma.user.create({
        data: { name: name.trim(), email: email.toLowerCase().trim(), passwordHash: await bcrypt.hash(password, 10), role: Role.CONSULTANT },
      });
      return { id: c.id, name: c.name, email: c.email, isDefault: false, clientCount: 0 };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppException(ErrorCode.EMAIL_IN_USE, HttpStatus.CONFLICT, 'An account with this email already exists');
      }
      throw err;
    }
  }

  /** New client signups are assigned to this consultant. Exactly one default at a time. */
  async setDefaultConsultant(consultantId: string) {
    await this.findConsultant(consultantId);
    await this.prisma.$transaction([
      this.prisma.user.updateMany({ where: { isDefaultConsultant: true }, data: { isDefaultConsultant: false } }),
      this.prisma.user.update({ where: { id: consultantId }, data: { isDefaultConsultant: true } }),
    ]);
    return this.consultants();
  }

  async clients(): Promise<AdminClientDto[]> {
    const rows = await this.prisma.user.findMany({
      where: { role: Role.CLIENT },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, createdAt: true, consultant: { select: { id: true, name: true } } },
    });
    return rows.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }));
  }

  /**
   * Assign (or unassign) a client's consultant. Their OPEN requests move to the new consultant;
   * requests with a call in progress or already finished keep their original consultant.
   */
  async assignConsultant(clientId: string, consultantId: string | null): Promise<AdminClientDto> {
    const client = await this.prisma.user.findFirst({ where: { id: clientId, role: Role.CLIENT } });
    if (!client) throw AppException.notFound('Client');
    if (consultantId) await this.findConsultant(consultantId);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: clientId }, data: { consultantId } }),
      ...(consultantId
        ? [this.prisma.helpRequest.updateMany({ where: { clientId, status: 'OPEN' }, data: { consultantId } })]
        : []),
    ]);
    return (await this.clients()).find((c) => c.id === clientId)!;
  }

  private async findConsultant(id: string) {
    const c = await this.prisma.user.findFirst({ where: { id, role: Role.CONSULTANT } });
    if (!c) throw AppException.notFound('Consultant');
    return c;
  }
}
