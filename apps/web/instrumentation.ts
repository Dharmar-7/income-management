import * as Sentry from '@sentry/nextjs';

// Server-side Sentry — inert unless NEXT_PUBLIC_SENTRY_DSN is set (Vercel →
// Project → Settings → Environment Variables).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
    });
  }
}

// Reports errors from nested React Server Components.
export const onRequestError = Sentry.captureRequestError;
