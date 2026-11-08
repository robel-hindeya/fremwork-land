# Fremwork launch execution — 2026-11-08

**Decision: NO-GO pending deployment access and live security verification.**

## Repositories and selected architecture

- Landing: `/home/hammerspacecraft/Work/Projects/fremwork-land`, initial `main` `e7a2adaafb3783ca284f4cc82dd0df4c85eee745`.
- Workspace: `/home/hammerspacecraft/Work/Projects/fremwork-work`, initial `main` `a1a38dcf69502ea8b96d9ac2a7f2504d13cfee51`.
- Both cloned cleanly from `robel-hindeya`, without overwriting existing work.
- Deploy landing `apps/web` to Vercel project `fremwork-land`; intended domain `fremwork.com`. pnpm 10.12.1, frozen pnpm lockfile, Node 22 target, Next.js 15.
- Deploy workspace `apps/web` to Vercel project `fremwork-work`; intended domain `app.fremwork.com`. npm lockfile, Next.js 16, Node 22 target. Its Next route handlers provide the production AI and ledger API. Use the app build command, rather than deploying every workspace.
- Workspace `apps/site` and `apps/site-api` duplicate the landing application; do not deploy them for this launch. Security defects in these copies were also corrected.
- Workspace `apps/api` is an older NestJS prototype with seeded in-memory finance data and unsafe workspace selection. Its production startup is now blocked. It must not be a production deployment target or the destination of `API_URL`.
- Landing `apps/api` is a separate NestJS website API, with its own Vercel adapter. A separate target is needed if using its privileged invitation/email features. Existing public/RLS fallback functions support much of the website without it; those functions and policies must be verified in the shared Supabase project. This fallback is existing behavior, rather than a new launch architecture.

## Implemented security and authentication changes

- Removed email-based admin privileges from guards, `/me`, routing, and the direct Supabase fallback. Roles come from `profiles` using the authenticated UUID. Admin page middleware denies members and fails closed on role lookup errors.
- Added `20261108120000_uuid_role_authorization.sql` in both repositories. It replaces the email-based DB function and triggers while preserving existing UUID-bound roles. Confirmed, unused invitations provision roles; accepted invitations cannot automatically grant privileges to a later recreated account. Existing migrations were not edited. **Corrective migration has NOT been applied to production.**
- Replaced session-token URL fragments with an HTTPS form POST to `/api/auth/session`. Exact origin allowlist, Supabase identity verification, refresh rotation, and identity-pair checking precede HttpOnly/SameSite cookies and a token-free 303 redirect. Landing forgets its project auth cookies without signing out the transferred session. Preview origins must be explicitly configured.
- Supabase Auth verifies workspace sessions, including revoked/expired tokens and projects using legacy signing algorithms. Unconfirmed identities are rejected. The workspace no longer labels every user an owner.
- Added CSRF origin validation for workspace mutations. Preserved refresh forwarding and logout cookie clearing. Old token-fragment callbacks erase the fragment and ask for login.
- Landing callbacks default to `/open-app` and accept only known local destinations. Email confirmation template uses a one-time token hash, avoiding implicit session tokens in links. OAuth continues to use the landing Supabase PKCE callback. Existing registration CTAs/design preserved; old waitlist links already redirect to signup.
- AI mutation tools removed from both prototype provider declarations, prototype dispatch, and the production tool registry. They remain disabled until server-side confirmation, audit logging, idempotency, and validated mutation workflows exist.
- Added tenant ID filters alongside user bearer tokens/RLS, bounded financial tool reads, manual ledger input validation, chat input bounds, provider/DB timeouts, bounded transient retries, limited conversation context, and safe provider errors. `GEMINI_MODEL` must be explicitly configured; no model availability is assumed.
- Existing unavailable states for integrations are retained. No production seed or financial test operations were run. Provider replies are currently request/response, not token streaming.

## Deployment access and configuration

Vercel MCP list calls returned no teams and no Fremwork projects. Both Git-connected project creation attempts failed with the exact API error:

> Vercel API request failed (400: bad_request). To link a GitHub repository, you need to install the GitHub integration first. Make sure there aren't any typos and that you have access to the repository if it's private.

Required access: install/authorize Vercel's GitHub integration in the connected Vercel account with access to `robel-hindeya/fremwork-land` and `robel-hindeya/fremwork-work`. Deployment steps stopped at that failure, as requested. No project ID, deployment URL, READY state, promotion, or domain transfer is claimed.

No Supabase management connector, configured Supabase credentials, Gemini credentials, or test-account credentials were available in the execution environment. Do not paste secret values into the report or commit them.

Required configuration (names only):

| Target | Required variables/settings |
| --- | --- |
| Landing web | `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or anon key); optional named overrides `NEXT_PUBLIC_FREMWORK_SUPABASE_URL`, `NEXT_PUBLIC_FREMWORK_SUPABASE_KEY`; `NEXT_PUBLIC_SITE_URL=https://fremwork.com`; `NEXT_PUBLIC_APP_URL=https://app.fremwork.com` |
| Workspace web | Same Supabase project via `FREMWORK_SUPABASE_URL` and `FREMWORK_SUPABASE_PUBLISHABLE_KEY`, or supported `SUPABASE_URL`/`SUPABASE_KEY`; **publishable key only**; `GEMINI_API_KEY` (or `GOOGLE_API_KEY`); explicitly available `GEMINI_MODEL`; `AI_DAILY_LIMIT`; `LANDING_URL=https://fremwork.com`; exact additional `AUTH_HANDOFF_ORIGINS` for www/preview origins if needed. Leave `API_URL` unset. |
| Optional landing API | `FREMWORK_SUPABASE_URL`, server-only `FREMWORK_SUPABASE_SECRET_KEY`, `WEB_URL`, email provider `RESEND_API_KEY` and `EMAIL_FROM`; landing `NEXT_PUBLIC_API_URL` must reference this deployment. |
| Supabase | Apply/reconcile migrations without reset/seed, verify the UUID-bound legitimate owner, enable email confirmation and Google provider, upload updated confirmation/recovery/invite templates, set site URL to landing, allow landing `/auth/callback` and `/auth/confirm` plus exact approved preview URLs. Google provider uses the shared project's Supabase provider callback. |

Preview requirements: configure both preview origins explicitly, test the entire pair, and deploy production without domain reassignment until live verification passes. Do not use wildcard Vercel origins for session transfers.

## Verification and release record

See the appended final verification record for commands, outcomes, commit/push results and the exact changed-file manifest. The workspace dependencies were verified in an exact source mirror under `/tmp/fremwork-work-check` after local npm extraction encountered ENOSPC. No source work was deleted. Local runtime was Node 26.8.1; deployment target Node 22 still needs preview verification.

The following remain **BLOCKED**, never PASSED: real signup and confirmation delivery, real Google OAuth, cross-deployment session transfer and refresh, authenticated live AI reply, production conversation persistence, two-account database/RLS tenant isolation, live admin role enforcement, live logout/revocation, Vercel readiness, and production desktop/mobile E2E. These require authorized deployment integration, service configuration, test accounts, and migration verification.

DNS and production domains have not been changed. Projects have not been transferred to Robel. No destructive DB commands were executed.

## Final local verification

| Check | Result |
| --- | --- |
| Landing frozen pnpm install | PASS |
| Landing `pnpm typecheck`, `pnpm build` (web and NestJS API) | PASS |
| Landing `pnpm test` | PASS, 2 regression tests |
| Workspace locked `npm ci --ignore-scripts`, in `/tmp` mirror | PASS after source-directory extraction failed with ENOSPC |
| Workspace `npm run typecheck` across all workspaces | PASS |
| Workspace `npm run build` across shared types, both APIs and both frontends | PASS; final changed targets rebuilt successfully |
| Workspace `npm test` | PASS, 10 regression tests |
| Chromium landing homepage/signup/login at 1440px and 390px | PASS, HTTP 200, no horizontal overflow or uncaught page errors; production Supabase traffic intercepted |
| Local workspace health/private page/unauthenticated chat API | PASS, 200 / 307 sign-in redirect / 401 |
| Local workspace cross-origin mutation and handoff | PASS, 403 for both |
| Existing lint | NOT CONFIGURED: no lint script/config; existing Next 15 lint skip was not introduced by this work |
| SQL migration execution and live RLS | BLOCKED, no authorized database management access |
| Live provider, signup/email/OAuth, persistence and deployment E2E | BLOCKED, integration/configuration/test accounts unavailable |

Browser evidence was saved under `/tmp/fremwork-{1440,390}-{home,signup,login}.png`. These are local smoke tests, not production verification. The regression tests use test doubles for service boundaries and never write real financial records.

GitHub `main` was fetched immediately before commit preparation. Neither remote had advanced. A workspace push dry-run succeeded. Commit and final push results are recorded separately after the actual operations; no push is inferred from the dry-run.

## Exact changed files in this repository

- `apps/api/.env.example`
- `apps/web/.env.example`
- `apps/web/app/auth/callback/route.ts`
- `apps/web/app/auth/confirm/route.ts`
- `apps/web/app/open-app/page.tsx`
- `apps/web/components/VisitTracker.tsx`
- `apps/web/components/screens/LoginScreen.tsx`
- `apps/web/lib/app-url.ts`
- `apps/web/lib/supabase/config.ts`
- `apps/web/lib/supabase/middleware.ts`
- `apps/web/next.config.ts`
- `docs/LAUNCH_EXECUTION.md`
- `package.json`
- `supabase/migrations/20261108120000_uuid_role_authorization.sql`
- `supabase/templates/confirmation.html`
- `tests/auth.test.cjs`
- `tests/register.cjs`
