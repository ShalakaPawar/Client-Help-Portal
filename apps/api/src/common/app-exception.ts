import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@chp/shared';

/** Domain error with a stable code. The global filter turns it into the API error shape. */
export class AppException extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: HttpStatus,
    message: string,
  ) {
    super(message);
  }

  static notFound(what = 'Resource') {
    return new AppException(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND, `${what} not found`);
  }

  static invalidState(message: string) {
    return new AppException(ErrorCode.INVALID_STATE, HttpStatus.CONFLICT, message);
  }

  static forbiddenRole(message: string) {
    return new AppException(ErrorCode.FORBIDDEN_ROLE, HttpStatus.FORBIDDEN, message);
  }

  static mediaUnavailable(cause?: unknown) {
    const detail = cause instanceof Error ? ` (${cause.message})` : '';
    return new AppException(
      ErrorCode.MEDIA_SERVER_UNAVAILABLE,
      HttpStatus.SERVICE_UNAVAILABLE,
      `The call service (LiveKit) is not reachable. Is Docker running?${detail}`,
    );
  }
}
