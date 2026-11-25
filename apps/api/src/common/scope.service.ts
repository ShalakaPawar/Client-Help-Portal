import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Role } from '@chp/shared';
import type { AuthUser } from './auth.decorators';

/**
 * The single place that decides "whose data can this user see".
 * Every read/write of requests and calls adds these filters to the database query
 * itself, so a missing check cannot leak data: a row that isn't yours is simply
 * not found (404).
 */
@Injectable()
export class ScopeService {
  requestWhere(user: AuthUser): Prisma.HelpRequestWhereInput {
    return this.byRole(user);
  }

  callWhere(user: AuthUser): Prisma.CallWhereInput {
    return this.byRole(user);
  }

  recordingWhere(user: AuthUser): Prisma.RecordingWhereInput {
    return { call: this.callWhere(user) };
  }

  /** Clients see their own rows, consultants their clients' rows, admins none (they only manage accounts). */
  private byRole(user: AuthUser): { clientId: string } | { consultantId: string } | { id: { in: string[] } } {
    if (user.role === Role.CLIENT) return { clientId: user.id };
    if (user.role === Role.CONSULTANT) return { consultantId: user.id };
    return { id: { in: [] } }; // matches nothing
  }
}
