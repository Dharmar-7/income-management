import * as Sentry from '@sentry/nextjs';

// Browser-side Sentry — inert unless NEXT_PUBLIC_SENTRY_DSN is set.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}

// Instruments client-side route changes.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
