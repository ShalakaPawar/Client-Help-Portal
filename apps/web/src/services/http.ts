import type { ApiErrorBody, ErrorCode } from '@chp/shared';

/** Every failed API call becomes an ApiError with the server's stable code and message. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    public readonly requestId?: string,
    public readonly details?: string[],
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'chp.token';

/** sessionStorage = one login per browser tab/window (two windows can be two users). */
export const tokenStore = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (t: string) => sessionStorage.setItem(TOKEN_KEY, t),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

let onUnauthenticated: (() => void) | null = null;
export function setUnauthenticatedHandler(fn: () => void) {
  onUnauthenticated = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Is it running?');
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  let err: Partial<ApiErrorBody> = {};
  try {
    err = await res.json();
  } catch {
    /* not JSON */
  }
  const apiError = new ApiError(
    res.status,
    (err.code as ErrorCode) ?? 'INTERNAL_ERROR',
    err.message ?? `Request failed (${res.status})`,
    err.requestId,
    err.details,
  );
  if (apiError.code === 'UNAUTHENTICATED' && onUnauthenticated) onUnauthenticated();
  throw apiError;
}

export const http = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
};

/** A readable message for any error (used by toasts). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.details?.length ? `${err.message}: ${err.details.join(', ')}` : err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
