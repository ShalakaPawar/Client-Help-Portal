import { ErrorCode } from '@chp/shared';

/**
 * Provider failures are split into:
 *  - retryable (rate limits, 5xx, timeouts): BullMQ retries with backoff
 *  - permanent (bad key, bad input, missing key): fail now with a clear reason
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly code: ErrorCode = ErrorCode.INTERNAL_ERROR,
  ) {
    super(message);
  }

  static notConfigured(provider: string, envVar: string) {
    return new ProviderError(`${provider} is not configured: add ${envVar} to apps/api/.env`, false, ErrorCode.PROVIDER_NOT_CONFIGURED);
  }

  static fromHttpStatus(provider: string, status: number, detail: string) {
    if (status === 401 || status === 403) {
      return new ProviderError(`${provider} rejected the API key (${status})`, false, ErrorCode.PROVIDER_AUTH_FAILED);
    }
    const retryable = status === 408 || status === 429 || status >= 500;
    return new ProviderError(`${provider} error ${status}: ${detail}`.slice(0, 500), retryable);
  }
}
