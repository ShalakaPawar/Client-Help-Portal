import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ErrorCode, LoginResponse, UserDto } from '@chp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/app-exception';
import { toUserDto } from '../common/mappers';
import type { JwtPayload } from '../common/guards';

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
    const payload: JwtPayload = { sub: user.id, email: user.email, name: user.name, role: user.role };
    return { accessToken: await this.jwt.signAsync(payload), user: toUserDto(user) };
  }

  async me(userId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppException.notFound('User');
    return toUserDto(user);
  }

  /** Demo accounts for the one-click login buttons (local demo only). */
  async demoAccounts() {
    const users = await this.prisma.user.findMany({
      where: { email: { endsWith: '@demo.com' } },
      orderBy: [{ role: 'desc' }, { email: 'asc' }],
      select: { email: true, name: true, role: true },
    });
    return users;
  }
}
