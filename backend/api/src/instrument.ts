import * as Sentry from '@sentry/nestjs';

// Error monitoring — inert unless SENTRY_DSN is set (Render → Environment).
// Must be imported before anything else in main.ts so Sentry can hook the
// runtime before Nest and Prisma load.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'production',
    // 10% of requests get performance traces — plenty for a personal app,
    // and stays far inside Sentry's free quota.
    tracesSampleRate: 0.1,
  });
}
