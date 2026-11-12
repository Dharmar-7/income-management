# Release checklist

Every push to `main` does three things on its own: CI runs (type-check, tests,
lint), Render redeploys the backend (`backend/**`), and EAS builds a new APK
(`apps/mobile/**`). So "push" means "release". Go through this list first.

## 1. Before committing

```bash
npm run check
```

That runs, in order: mobile type-check → mobile lint → backend type-check →
backend tests. All four must pass. (CI runs the same things; this just finds
problems before the build minutes are spent.)

## 2. Before pushing — try it on the phone

Automated checks cannot tell you a button crashes. For any change to a
screen, open that screen in the dev build and tap through the change once:

- the happy path (do the thing)
- one failure path (no network, bad input, permission denied)

If it touched the backend, call the endpoint once against the local API
(`cd backend/api && npm run start:dev`, then the app pointed at
`http://<your-pc-ip>:4000`).

## 3. Push

- A user-facing change gets a `CHANGELOG` entry in `apps/mobile/lib/appGuide.ts`.
- Check the Actions tab: **CI** green, then **Mobile build** green.
- Install the new APK from the EAS link and run the same tap-through once more.

## 4. If something is wrong after release

- Backend: Render → service → **Rollback** to the previous deploy.
- Mobile: re-install the previous APK from the EAS build list; then fix forward.

---

## Build profiles (`apps/mobile/eas.json`)

| Profile      | Use                              | Clerk key                                   |
|--------------|----------------------------------|---------------------------------------------|
| `preview`    | day-to-day APKs (what CI builds) | `pk_test_…` hard-coded in `eas.json`         |
| `production` | the APK you keep on your phone   | from the EAS **production** environment      |

### Switching to the Clerk production instance

The app currently signs in against Clerk's **development** instance
(`pk_test_…`). Development instances cap users, have weaker session
security, and can be reset by Clerk. Do this once:

1. Clerk dashboard → your app → **Configure → Instances → Create production
   instance**. Enable Google sign-in on it (same as the dev instance).
2. Copy its **Publishable key** (`pk_live_…`) and **Secret key** (`sk_live_…`).
3. EAS: `expo.dev` → project → **Environment variables** → environment
   **production** → add `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = pk_live_…`.
4. Render → backend → **Environment** → set `CLERK_SECRET_KEY = sk_live_…`
   (and `CLERK_JWT_KEY` to the new instance's PEM if it was set before).
   Save → Render redeploys.
5. Build: `cd apps/mobile && eas build -p android --profile production`.
   Install it and sign in again (accounts do not carry over between instances;
   your data is keyed by the Clerk user id, so re-link by signing in with the
   same Google account — if the backend created a new user row, say so and we
   migrate the rows).
6. Once the production build works, the backend only accepts the live
   instance, so move the `preview` profile to the live key too: put the key in
   the EAS **preview** environment and delete the `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
   line from the `preview` profile in `eas.json`.

### Moving the database next to the API (speed)

Every request currently crosses regions between Render and Neon, which costs
about a second per database round-trip. Fix once:

1. Render → backend service → **Settings → Region**: note it (e.g. Oregon /
   Frankfurt / Singapore).
2. Neon → project → **Settings**: note its region (currently AWS us-east-1).
3. Pick whichever is cheaper to move. Usually the API: create a new Render
   service in the Neon region (same repo, same env vars, same deploy hook),
   update `EXPO_PUBLIC_API_URL` in `eas.json` + the keep-alive workflow, and
   delete the old service. Moving Neon instead means creating a project in the
   new region and restoring from the latest `db-backup.yml` dump.
