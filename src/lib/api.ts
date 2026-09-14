/**
 * The single fetch wrapper behind every TanStack Query `queryFn` and
 * `mutationFn`.
 *
 * Query treats a resolved promise as success, so a bare `fetch` reports a 500
 * as data and every list silently renders empty. This throws instead, and
 * attaches `status` — which is what `getQueryClient`'s retry policy reads to
 * decide that a 401 or 404 is not worth asking about twice.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers:
      init?.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json', ...init?.headers }
        : init?.headers,
  });

  if (!res.ok) {
    // The error body is best-effort: some routes answer with plain text.
    let body: unknown = null;
    const text = await res.text().catch(() => '');
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const message =
      (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : null) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** JSON body helper, so call sites do not repeat JSON.stringify everywhere. */
export function jsonBody(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', data?: unknown): RequestInit {
  return { method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) };
}
