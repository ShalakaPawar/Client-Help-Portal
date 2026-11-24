import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode, Role } from '@chp/shared';
import { AppException } from './app-exception';
import { AuthUser, IS_PUBLIC, ROLES } from './auth.decorators';

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: Role;
}

export function userFromPayload(p: JwtPayload): AuthUser {
  return { id: p.sub, email: p.email, name: p.name, role: p.role };
}

/** Global guard: every route needs a valid Bearer token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw this.unauthenticated('Please log in');
    try {
      req.user = userFromPayload(await this.jwt.verifyAsync<JwtPayload>(token));
      return true;
    } catch {
      throw this.unauthenticated('Your session has expired. Please log in again.');
    }
  }

  private unauthenticated(message: string) {
    return new AppException(ErrorCode.UNAUTHENTICATED, HttpStatus.UNAUTHORIZED, message);
  }
}

/** Global guard: enforces @Roles(...) when present. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (user && roles.includes(user.role)) return true;
    const who = roles.map((r) => r.toLowerCase() + 's').join(' or ');
    throw AppException.forbiddenRole(`Only ${who} can do this`);
  }
}
