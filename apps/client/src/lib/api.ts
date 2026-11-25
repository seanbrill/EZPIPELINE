import API_URL from '../config/api';

/** An API call that failed, with the server's own words when it sent some. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Fired on window when the server says the session is over. AuthContext listens. */
export const SIGNED_OUT = 'ezp:signed-out';

/**
 * fetch for /api: adds the session token, sends and parses JSON, and turns a
 * non-2xx into an ApiError carrying the server's `error` text. Every v1 page
 * repeated this by hand, and most of them swallowed the failure.
 */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; token?: string } = {}): Promise<T> {
  // A token passed in wins: sign-in's restricted setup token is not the session's.
  const token = init.token ?? localStorage.getItem('token');
  const res = await fetch(`${API_URL}/api${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    // The session's own sign-in ran out (not a restricted token passed in):
    // the shell signs out and shows the sign-in page, rather than every
    // panel reporting "not allowed".
    if (res.status === 401 && !init.token && data && typeof data === 'object'
      && ['session_expired', 'not_signed_in'].includes(String((data as { error?: unknown }).error))) {
      window.dispatchEvent(new Event(SIGNED_OUT));
    }
    // { error: "snake_case_code", message: "A sentence." } is the server's shape
    // (docs/development.md): the sentence is for people. Older routes put the
    // sentence in `error` and send no message.
    const d = (data && typeof data === 'object' ? data : {}) as { error?: unknown; message?: unknown };
    const msg = typeof d.message === 'string' && d.message ? d.message
      : typeof d.error === 'string' ? d.error
      : res.status === 401 || res.status === 403 ? 'You are not allowed to do that.' : `The server answered ${res.status}.`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}
