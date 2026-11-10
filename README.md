# Fremwork

The Fremwork website, waitlist, events and admin, built from the Fremwork design canvas.

| Part | Stack | Folder |
| --- | --- | --- |
| Frontend | Next.js 15 (App Router, React 19) | `apps/web` |
| Backend | NestJS 11 REST API | `apps/api` |
| Database | Supabase Postgres, with migrations, RLS and seed data | `supabase/` |
| Auth | Supabase Auth: email + password, Google, invite links | web + API |

## Screens

All twelve artboards are covered. The phone artboards are the same pages at 390px wide.

| Route | Design artboard | What is live |
| --- | --- | --- |
| `/` | Homepage | Demo chat with the six assistants (canned replies, see `components/screens/home-content.ts`) |
| `/login` | Log in | Supabase password sign-in, SSO buttons, forgot password |
| `/waitlist` | Join the waitlist | Saves to `waitlist_entries` through the API. Respects the "Accept sign-ups" and "Ask for company" settings |
| `/events` | Events | Published events from the API, registration form, cancel, add-to-calendar (.ics) |
| `/admin` | Admin | Overview stats, waitlist (invite, bulk invite, CSV), events (create, publish), registrations (check-in, CSV), settings, team invites |
| any unknown URL | 404 | Fram looks around |
| `/set-password` | *(not in the design)* | Where invite and reset links land. Uses the Log in card styles |

## How it fits together

```
Browser ──(anon key)──▶ Supabase Auth          sign in, sessions, OAuth, invite + reset emails
   │
   └──(Bearer <access token>)──▶ NestJS API ──(service-role key)──▶ Supabase Postgres
```

- The browser only talks to Supabase for **auth**. All data goes through the API.
- The API checks every admin call: it verifies the token with Supabase, then needs `profiles.role` to be `owner` or `admin`.
- RLS is on for every table. The anon key can only read published events and the user's own profile, so a leaked anon key cannot read the waitlist. Event capacity is enforced by a database trigger.

## Run it locally

Needs Node 20+, pnpm, Docker and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
pnpm install
supabase start                 # local Postgres, Auth, Studio and a test inbox
supabase db reset              # runs migrations + seed.sql
supabase status                # copy the API URL, anon key and service_role key
```

Create the two env files from the examples:

```bash
cp apps/web/.env.example apps/web/.env.local   # NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
cp apps/api/.env.example apps/api/.env         # FREMWORK_SUPABASE_URL, FREMWORK_SUPABASE_SECRET_KEY
```

```bash
pnpm dev          # web on :3000, API on :4000
```

### Checks

```bash
pnpm typecheck
pnpm test         # unit tests + database/RLS tests (in-process Postgres, no Supabase needed)
pnpm build
```

### Make yourself the owner

1. Open Studio at http://127.0.0.1:54323 → Authentication → Add user, with your email and a password (tick "Auto confirm").
2. In the SQL editor run:
   ```sql
   update public.profiles set role = 'owner' where email = 'you@company.com';
   ```
3. Log in at http://localhost:3000/login and open **Open admin**.

From then on, invite teammates from Admin › Settings › Team. Invite emails show up in the local inbox at http://127.0.0.1:54324.

## Deploy

- **Database**: create a Supabase project, then `supabase link --project-ref <ref>` and `supabase db push`. Run `seed.sql` only if you want the sample data.
- **Auth settings** (Dashboard → Authentication):
  - URL configuration: set Site URL to your web domain and add `https://<domain>/auth/callback` and `https://<domain>/auth/confirm` to the redirect URLs.
  - Email templates: paste `supabase/templates/invite.html` into "Invite user" and `recovery.html` into "Reset password". Invite links need these to sign people in.
  - Providers: turn on Google and add its client ID. Locally, set them in `supabase/config.toml`.
- **API on Vercel** (a second Vercel project from the same repo):
  1. Vercel → Add New → Project → import `fremwork.com` again. Set **Root Directory** to `apps/api`. Vercel detects NestJS.
  2. Environment variables: `FREMWORK_SUPABASE_URL`, `FREMWORK_SUPABASE_SECRET_KEY` (server only), and `WEB_URL` = your site's URL(s), e.g. `https://fremwork.com,https://fremwork-com.vercel.app`. For email: `RESEND_API_KEY`, `EMAIL_FROM`. Optional: `ALLOW_VERCEL_PREVIEWS=true` (off unless exactly `true`). Full list: `.env.example`; step-by-step: `docs/PRODUCTION_DEPLOYMENT.md`.
  3. Deploy, then open `https://<api-domain>/health`. It should return `{"ok":true}`.
  Other hosts (Render, Railway, Fly) work too: build with `npm run build`, start with `node dist/main.js`.
- **Web on Vercel**: Root Directory `apps/web`. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` (the site's URL) and `NEXT_PUBLIC_API_URL` (the API's URL from step 3). `NEXT_PUBLIC_*` values are baked in at build time, so **redeploy the web project after changing them**.

If a form says "We could not reach Fremwork right now", the browser console shows the API URL it tried. Usually `NEXT_PUBLIC_API_URL` is missing, or the site's URL is not in the API's `WEB_URL`.

## API

| Method | Path | Who |
| --- | --- | --- |
| GET | `/health` | public |
| GET | `/settings/public` | public |
| POST | `/waitlist` | public, rate limited |
| GET | `/events` | public |
| POST | `/events/:id/registrations` | public, rate limited |
| DELETE | `/registrations/:id?token=` | holder of the cancel token |
| GET | `/me` | signed in |
| GET | `/admin/overview` | admin |
| GET / POST | `/admin/waitlist`, `/admin/waitlist/invite`, `/admin/waitlist/export` | admin |
| GET / POST / PATCH | `/admin/events`, `/admin/events/:id` | admin |
| GET / PATCH | `/admin/registrations`, `/admin/registrations/:id`, `/admin/registrations/export` | admin |
| GET / PUT | `/admin/settings` | admin |
| GET / POST | `/admin/team`, `/admin/team/invite` | admin |

## Still to do

- **Placeholders**: copy in `[BRACKETS]` comes straight from the design, for example `[YOUR METRIC]`, `[CITY]` and `[YOUR SUPPORT EMAIL]` on the 404 page. Replace these before launch.
- **Homepage chat** uses canned answers. To make it real, add a `/assistants/:id/messages` endpoint to the API that calls your model, and call it from `sendText` in `HomeScreen.tsx`.
- **Emails we send ourselves** (the waitlist welcome email and sign-up alerts) are logged by the API, not sent. Connect a provider such as Resend or Postmark in `waitlist.module.ts`. Auth emails (invites, resets) already go out through Supabase.
- **Event dates**: seeded events have `[DATE] · [TIME]` labels. Events created in admin with a date show it formatted, and the date also powers the .ics download.
- **Database types**: `pnpm db:types` writes typed Supabase definitions you can pass to `createClient<Database>()`.
