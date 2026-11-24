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
    return user.role === Role.CLIENT ? { clientId: user.id } : { consultantId: user.id };
  }

  callWhere(user: AuthUser): Prisma.CallWhereInput {
    return user.role === Role.CLIENT ? { clientId: user.id } : { consultantId: user.id };
  }

  recordingWhere(user: AuthUser): Prisma.RecordingWhereInput {
    return { call: this.callWhere(user) };
  }
}
