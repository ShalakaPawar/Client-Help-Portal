import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ApiErrorBody, ErrorCode } from '@chp/shared';
import { AppException } from './app-exception';

/**
 * Every error leaves the API in one shape: { statusCode, code, message, requestId }.
 * Unexpected errors are logged with the request id and returned as a generic 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return; // socket errors are handled by the gateway
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const body = this.toBody(exception);
    body.requestId = req.id ? String(req.id) : undefined;

    if (body.statusCode >= 500) {
      this.logger.error(
        { err: exception, requestId: body.requestId, path: req.url },
        exception instanceof Error ? exception.message : 'Unhandled error',
      );
    }
    if (!res.headersSent) res.status(body.statusCode).json(body);
  }

  toBody(exception: unknown): ApiErrorBody {
    if (exception instanceof AppException) {
      return { statusCode: exception.status, code: exception.code, message: exception.message };
    }
    if (exception instanceof ThrottlerException) {
      return {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: ErrorCode.RATE_LIMITED,
        message: 'Too many attempts. Please wait a minute and try again.',
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse() as { message?: string | string[] } | string;
      const raw = typeof response === 'string' ? response : response.message;
      const details = Array.isArray(raw) ? raw : undefined;
      const message = Array.isArray(raw) ? 'Some fields are invalid' : raw || exception.message;
      return { statusCode: status, code: this.codeForStatus(status), message, details };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') {
        return { statusCode: 404, code: ErrorCode.NOT_FOUND, message: 'Resource not found' };
      }
      if (exception.code === 'P2002') {
        return { statusCode: 409, code: ErrorCode.INVALID_STATE, message: 'This conflicts with existing data' };
      }
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Something went wrong. Please try again.',
    };
  }

  private codeForStatus(status: number): ErrorCode {
    switch (status) {
      case 400:
        return ErrorCode.VALIDATION_FAILED;
      case 401:
        return ErrorCode.UNAUTHENTICATED;
      case 403:
        return ErrorCode.FORBIDDEN_ROLE;
      case 404:
        return ErrorCode.NOT_FOUND;
      case 409:
        return ErrorCode.INVALID_STATE;
      case 429:
        return ErrorCode.RATE_LIMITED;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }
}
