// Routes Clerk's network calls through our own /__clerk proxy.
//
// Why: the production Clerk instance is tied to a Vercel subdomain, so its
// Frontend API host (decoded from the pk_live_ key) is
// "clerk.<our-domain>" — a hostname that doesn't exist and we can't add DNS
// for. The website handles this with ClerkProvider's proxyUrl, but on native
// @clerk/clerk-expo builds its Clerk client without any proxy option, so it
// always calls the key's own host. This shim rewrites those calls instead.
//
// Import this FIRST in app/_layout.tsx so it is in place before Clerk makes any
// request. It does nothing for dev (pk_test_) keys.

const key = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
const PROXY_URL =
  process.env.EXPO_PUBLIC_CLERK_PROXY_URL ?? 'https://velora-personal-assistant.vercel.app/__clerk';

function frontendApiOrigin(pk: string): string | null {
  try {
    // pk_live_<base64 of "<host>$">
    const host = atob(pk.split('_')[2] ?? '').replace(/\$$/, '');
    return host.includes('.') ? `https://${host}` : null;
  } catch {
    return null;
  }
}

const fapiOrigin = key.startsWith('pk_live_') ? frontendApiOrigin(key) : null;

if (fapiOrigin) {
  const realFetch = globalThis.fetch;
  const rewrite = (url: string) =>
    url.startsWith(fapiOrigin) ? PROXY_URL.replace(/\/$/, '') + url.slice(fapiOrigin.length) : url;

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') return realFetch(rewrite(input), init);
    if (input instanceof URL) return realFetch(rewrite(input.toString()), init);
    // A Request object: only rebuild it when it targets Clerk.
    const req = input as Request;
    if (req?.url?.startsWith(fapiOrigin)) return realFetch(new Request(rewrite(req.url), req), init);
    return realFetch(input, init);
  }) as typeof fetch;
}

export {};
