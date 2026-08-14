import * as crypto from 'crypto';

// The OAuth `state` round-trips through Google and comes back to an
// unauthenticated callback, so it MUST be tamper-proof: otherwise an attacker
// could forge a state naming a victim's user id and link their own Google
// account to that victim (account-linking CSRF). We HMAC-sign a small payload
// { uid, iat } and verify the signature + freshness on the callback.

const MAX_AGE_MS = 10 * 60 * 1000; // a consent flow shouldn't take >10 min
const CLOCK_SKEW_MS = 60 * 1000;

export function signState(uid: string, secret: string, now: number): string {
  const payload = Buffer.from(JSON.stringify({ uid, iat: now })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

// Returns the verified uid, or throws if the state is forged, malformed, or stale.
export function verifyState(
  state: string,
  secret: string,
  now: number,
  maxAgeMs: number = MAX_AGE_MS,
): string {
  const [payload, sig] = (state ?? '').split('.');
  if (!payload || !sig) throw new Error('Malformed OAuth state');

  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Invalid OAuth state signature');
  }

  let parsed: { uid?: unknown; iat?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Bad OAuth state payload');
  }

  if (typeof parsed.uid !== 'string' || !parsed.uid || typeof parsed.iat !== 'number') {
    throw new Error('Bad OAuth state payload');
  }
  if (now - parsed.iat > maxAgeMs || parsed.iat - now > CLOCK_SKEW_MS) {
    throw new Error('OAuth state expired');
  }
  return parsed.uid;
}
