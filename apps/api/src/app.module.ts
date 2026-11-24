import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { ValidationPipe } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { ConfigModule } from './config/config.module';
import { APP_CONFIG, AppConfig } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { InfraModule } from './infra.module';
import { QueueModule } from './queue/queue.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AuthModule } from './auth/auth.module';
import { RequestsModule } from './requests/requests.module';
import { CallsModule } from './calls/calls.module';
import { RecordingsModule } from './recordings/recordings.module';
import { ProcessingModule } from './processing/processing.module';
import { HistoryModule } from './history/history.module';
import { HealthController } from './health/health.controller';

const isTest = process.env.NODE_ENV === 'test';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: isTest ? 'silent' : process.env.LOG_LEVEL || 'info',
        genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        // Media URLs carry a token in the path; don't write it to logs.
        serializers: { req: (req) => ({ id: req.id, method: req.method, url: String(req.url).replace(/\/media\/[^/?]+/, '/media/***') }) },
        autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
        transport: !isTest && process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      },
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.JWT_SECRET,
        signOptions: { expiresIn: config.JWT_EXPIRES_IN as `${number}h` },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => [{ name: 'login', ttl: 60_000, limit: config.LOGIN_RATE_LIMIT_PER_MINUTE }],
    }),
    PrismaModule,
    CommonModule,
    InfraModule,
    QueueModule,
    RealtimeModule,
    AuthModule,
    RequestsModule,
    CallsModule,
    RecordingsModule,
    HistoryModule,
    ...(isTest ? [] : [ProcessingModule]),
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    },
  ],
})
export class AppModule {}
