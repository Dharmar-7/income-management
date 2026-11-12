// Same apiFetch pattern as the web app — adds the Bearer token automatically.
// The only difference: API_URL comes from EXPO_PUBLIC_API_URL instead of NEXT_PUBLIC_API_URL.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

// A non-2xx response. `status` and `body` let callers branch on specific
// server replies (e.g. 422 + body.needsPassword for an encrypted PDF) without
// hand-rolling fetch.
export class ApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  // For a FormData body (file uploads) the runtime must set Content-Type
  // itself, with the multipart boundary — forcing JSON would break the upload.
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const message = (body as { message?: string | string[] })?.message;
    throw new ApiError(
      Array.isArray(message) ? message.join(', ') : message || 'API error',
      res.status,
      body,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
