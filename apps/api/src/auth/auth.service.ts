import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ErrorCode, LoginResponse, Role, UserDto } from '@chp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/app-exception';
import type { JwtPayload } from '../common/guards';

const BCRYPT_COST = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    // Same error for "no such user" and "wrong password" so emails can't be probed.
    const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !ok) {
      throw new AppException(ErrorCode.INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED, 'Email or password is wrong');
    }
    return this.session(user);
  }

  /**
   * Self-service signup creates CLIENT accounts only (consultants and admins are created by an admin).
   * The new client is assigned to the default consultant, if the admin has set one;
   * otherwise they wait until an admin assigns a consultant.
   */
  async signup(name: string, email: string, password: string): Promise<LoginResponse> {
    const defaultConsultant = await this.prisma.user.findFirst({
      where: { role: Role.CONSULTANT, isDefaultConsultant: true },
      select: { id: true },
    });
    try {
      const user = await this.prisma.user.create({
        data: {
          name: name.trim(),
          email: email.toLowerCase().trim(),
          passwordHash: await bcrypt.hash(password, BCRYPT_COST),
          role: Role.CLIENT,
          consultantId: defaultConsultant?.id ?? null,
        },
      });
      return this.session(user);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppException(ErrorCode.EMAIL_IN_USE, HttpStatus.CONFLICT, 'An account with this email already exists');
      }
      throw err;
    }
  }

  async me(userId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppException.notFound('User');
    return this.toDto(user);
  }

  private async session(user: User): Promise<LoginResponse> {
    const payload: JwtPayload = { sub: user.id, email: user.email, name: user.name, role: user.role };
    return { accessToken: await this.jwt.signAsync(payload), user: await this.toDto(user) };
  }

  /** Clients also get their assigned consultant (null = waiting for an admin). */
  private async toDto(user: User): Promise<UserDto> {
    const dto: UserDto = { id: user.id, email: user.email, name: user.name, role: user.role };
    if (user.role === Role.CLIENT) {
      dto.consultant = user.consultantId
        ? await this.prisma.user.findUnique({ where: { id: user.consultantId }, select: { id: true, name: true } })
        : null;
    }
    return dto;
  }
}
