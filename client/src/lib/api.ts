let csrfToken = '';

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export function getCsrfToken(): string {
  return csrfToken;
}

type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query): string {
  const base = path.startsWith('/api') ? path : `/api${path}`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

async function parseError(response: Response): Promise<never> {
  let payload: { error?: string; details?: unknown } = {};
  try {
    payload = await response.json();
  } catch {
    /* bukan JSON */
  }
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }
  throw new ApiError(response.status, payload.error ?? `Permintaan gagal (${response.status}).`, payload.details);
}

async function request<T>(method: string, path: string, options: { body?: unknown; query?: Query; formData?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (!['GET', 'HEAD'].includes(method) && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  const response = await fetch(buildUrl(path, options.query), {
    method,
    headers,
    body,
    credentials: 'include',
  });
  if (!response.ok) return parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  delete: <T>(path: string, query?: Query) => request<T>('DELETE', path, { query }),
  upload: <T>(path: string, formData: FormData) => request<T>('POST', path, { formData }),
};

function filenameFromHeader(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = header.match(/filename="?([^"]+)"?/);
  return match?.[1] ?? fallback;
}

export async function downloadFile(path: string, query?: Query, fallbackName = 'unduhan'): Promise<void> {
  const response = await fetch(buildUrl(path, query), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: '*/*' },
  });
  if (!response.ok) return parseError(response);
  const blob = await response.blob();
  const filename = filenameFromHeader(response.headers.get('content-disposition'), fallbackName);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
