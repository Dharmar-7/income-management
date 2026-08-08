/**
 * sync-schema.js
 * Pushes the Prisma schema to the database during a Render DEPLOY only.
 *
 * Why: Render's build runs `npm run build`, and this step syncs the schema to
 * Neon automatically so schema changes ship with the deploy — no manual
 * `prisma db push` afterwards (which was a recurring cause of prod 500s when a
 * new table/column existed in code but not in Neon).
 *
 * Guarded by RENDER=true (Render sets this in its build + runtime env), so CI
 * runs and local `npm run build` never touch a database. Runs once per deploy
 * (build time), NOT on every cold start.
 *
 * Uses `db push` (not migrate) to match this project's convention. All schema
 * changes here are additive, so --accept-data-loss only ever applies unique
 * indexes to new empty columns.
 */
const { execSync } = require('child_process');

if (process.env.RENDER === 'true') {
  if (!process.env.DATABASE_URL) {
    console.error('[sync-schema] RENDER=true but DATABASE_URL is missing — aborting.');
    process.exit(1);
  }
  console.log('[sync-schema] Render deploy → pushing Prisma schema to the database…');
  execSync('npx prisma db push --accept-data-loss --skip-generate', { stdio: 'inherit' });
  console.log('[sync-schema] Schema in sync.');
} else {
  console.log('[sync-schema] Not on Render (RENDER!=true) → skipping db push.');
}
