# Production deployment: Supabase (Free) + Vercel

Audit and preparation done on 2026-11-10. This is the runbook; `.env.example` lists every variable.

## Architecture

| Part | Where | Vercel Root Directory |
| --- | --- | --- |
| Website (Next.js 15) | Vercel project `fremwork-land` (Git-connected, `main` auto-deploys to production) | repo root (uses root `vercel.json`) or `apps/web` |
| Website API (NestJS 11), optional | Separate Vercel project | `apps/api` |
| Database, Auth, Edge Functions | Supabase project (Free plan) | — |

Without the API the website still works: public pages and admin reads/writes go straight to Supabase through RLS-protected policies and functions. Sending invites (waitlist and team) and admin email **require** the API, because only it holds the secret key. Those buttons now say so instead of pretending to succeed.

## 1. Choose the Supabase project (decision needed)

Three projects are involved:

| Ref | What it is |
| --- | --- |
| `jwznteirgsnebvtswppu` | What the code defaults to since commit d8e78d5. Its schema had **not** been applied (docs/SUPABASE_PROJECT.md). Not visible to the Supabase account connected during this audit. |
| `gwdrtfcqqnvhwolbjkab` | The original project. Holds the real data (profiles, waitlist, registrations, visitors) and both Edge Functions. Missing the last 4 migrations, including the invite security fix. |
| `nvwvpsnmanmzhritdeok` ("Fremwork-agent") | Empty. |

Whichever is production, the Vercel `NEXT_PUBLIC_SUPABASE_URL` / key and the API's `FREMWORK_SUPABASE_URL` / secret key must all point to it.

## 2. Database setup

### A. New, empty project
1. Supabase → SQL Editor → paste `supabase/setup/full-setup.sql` → Run (once).
2. Then run, with your project ref:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url', 'Base URL for Edge Function webhooks');
   ```
3. Skip `supabase/seed.sql` in production (sample data).

### B. Existing project (keeps its data)
Apply only the missing files from `supabase/migrations/`, oldest first. Compare with Dashboard → Database → Migrations, or with `supabase migration list` after `supabase link --project-ref <ref>`. For `gwdrtfcqqnvhwolbjkab` the missing ones are:

1. `20261108120000_uuid_role_authorization.sql`: **security fix**. Live, a team invite grants admin at sign-up before the email is confirmed.
2. `20261109090000_admin_email_campaigns.sql`
3. `20261109120000_supabase_project_endpoints.sql`
4. `20261110090000_production_hardening.sql`

Then run the `vault.create_secret(... 'project_url' ...)` statement above. All four are additive: they create or replace functions, policies and indexes, and add one table. They delete no rows and drop no tables or columns. Alternative: `supabase db push` after linking.

### B2. Shared with the Fremwork AI workspace
The workspace repository (`fremwork-work`) uses the same database and adds three migrations:
`20261107090000_app_ledger.sql`, `20261107091000_invite_role_after_confirmation.sql` and
`20261108110000_embed_admin_owner.sql`. Apply the files from **both** repositories in timestamp order.
`20261108110000_embed_admin_owner.sql` grants owner by email; `20261108120000_uuid_role_authorization.sql`
(in both repositories) replaces those functions, so it must run after it. Never apply the embed file last.
Verified on a local Supabase stack on 2026-11-10: the combined set applies cleanly and leaves no email-based admin rule.

### C. Make yourself owner
After signing up and confirming your email, edit the email in `scripts/grant-admin.sql`, or run:
```sql
update public.profiles set role = 'owner' where id = (select id from auth.users where lower(email) = lower('<you>') and email_confirmed_at is not null);
```

### D. Auth settings (Dashboard → Authentication)
- **Sign In / Providers → Email**: keep *Confirm email* ON. The invite role protection depends on it.
- **URL Configuration** (required for Google sign-in; wrong values send people to `http://localhost:3000/?code=…`):
  - **Site URL**: `https://www.fremwork.com` (never localhost in a production project). Supabase falls back to it when a return URL is not allowed, and email templates build their links from it.
  - **Redirect URLs**, one per line:
    ```
    https://www.fremwork.com/**
    https://fremwork.com/**
    https://fremwork-land.onrender.com/**
    http://localhost:3000/**
    ```
  - The site always asks Supabase to return to the domain the visitor is on (`<that domain>/auth/callback`), because the sign-in's PKCE cookie lives there. Every domain people sign in from must be in this list.
  - Google Cloud Console → OAuth client → Authorized redirect URIs: only `https://<project-ref>.supabase.co/auth/v1/callback`. Google returns to Supabase, never directly to the site.
- **Emails → Templates**: paste `supabase/templates/confirmation.html`, `invite.html` and `recovery.html`.
- **Google provider**: enable it and add the client ID/secret if you use Google sign-in. The Google console redirect is `https://<ref>.supabase.co/auth/v1/callback`.
- **Attack Protection**: turn on *Leaked password protection* if your plan offers it (the Supabase advisor flagged it).
- Free-plan email limits: Supabase's built-in SMTP sends only a few auth emails per hour. For real traffic, set custom SMTP (for example Resend) under **Emails → SMTP Settings**.

### E. Edge Functions (Free plan includes them)
```bash
supabase functions deploy registration-email --no-verify-jwt
supabase functions deploy welcome-email --no-verify-jwt
```
Secrets (Edge Functions → Secrets): `RESEND_API_KEY` (required), optional `EMAIL_FROM`, `WELCOME_EMAIL_FROM`, `SITE_URL`, `APP_URL`, `EVENT_TIMEZONE`, `EVENT_TZ_LABEL`. Redeploy `registration-email` after this change: it now claims the confirmation atomically, so the API and the function never both send it.

### F. Free-plan fit
- Uses only Postgres, Auth, Vault, pg_net and Edge Functions, all on the Free plan. No branching, PITR, or paid add-ons.
- 500 MB database: anonymous visit tracking is now capped at 60 new visitor rows per IP per hour.
- Free projects pause after 7 days without traffic. Restore them from the dashboard.

## 3. Vercel

### Website (`fremwork-land`)
- Framework: Next.js. Install `pnpm install`, Build `pnpm --filter @fremwork/web build` (root `vercel.json`), Node from `engines` = 22.x.
- Environment variables (Production and Preview):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `NEXT_PUBLIC_SITE_URL`
  - `NEXT_PUBLIC_APP_URL`
  - `NEXT_PUBLIC_API_URL` (if the API is deployed)

  These are baked in at build time, so **redeploy after changing them**.
- Never add the secret/service-role key to this project.

### API (optional, second Vercel project)
- Root Directory `apps/api`. Build is `vercel-build` (`nest build`). All routes rewrite to `api/index.js`, which now bundles the email template explicitly.
- Variables: `FREMWORK_SUPABASE_URL`, `FREMWORK_SUPABASE_SECRET_KEY`, `WEB_URL`, `RESEND_API_KEY`, `EMAIL_FROM`.
- Check `https://<api-domain>/health`. It should return `{"ok":true}`.

## 4. Post-deploy smoke test (manual, needs real accounts)
1. Sign up with a new email → confirmation email → link lands on `/auth/confirm` → handed to the workspace.
2. Log in, log out, refresh: the session persists.
3. As owner: `/admin` loads; publish an event; register for it from a private window; check in; export CSV.
4. Make a non-admin account: `/admin` sends it to `/open-app`.
5. Supabase → Advisors: no RLS errors.
