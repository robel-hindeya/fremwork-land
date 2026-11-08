# Admin email composer

Open **Admin → Email users**. Choose **One person**, **Selected people**, or **All contacts**. The contact list combines registered user profiles, waitlist contacts, and event attendees, with case-insensitive email deduplication. Existing waitlist checkboxes also offer **Email selected**, and each desktop waitlist row has an **Email** action.

Enter a subject and select **HTML email** or **Plain text**. Paste HTML source or import an `.html` / `.htm` file up to 100 KB. HTML preview uses a sandboxed iframe with scripts, forms, and external network resources blocked. External images are therefore not visible in the preview. Original HTML is sent to the provider without inserting it into the admin page DOM.

Click **Review email** to inspect the exact recipient addresses and content, then explicitly confirm **Send to N contacts**. All contacts means the current reviewed contact-list snapshot. Each address receives a separate message so other recipients' addresses are not exposed. A send supports up to 1,000 unique contacts; larger lists must be split explicitly.

## Server requirements

- Deploy the landing repository's existing NestJS website API (`apps/api`) and set the frontend's `NEXT_PUBLIC_API_URL` to it. This operation never falls back to browser-side sending or another transport.
- Configure API `RESEND_API_KEY`, a verified `EMAIL_FROM`, `FREMWORK_SUPABASE_URL`, `FREMWORK_SUPABASE_SECRET_KEY`, and allowed frontend origins through `WEB_URL`.
- Apply the new migration `supabase/migrations/20261109090000_admin_email_campaigns.sql` without resetting or seeding production. The existing corrective UUID-role migration is also required for the prior launch fixes.
- Sending fails closed if contacts cannot be read, the provider is not configured, a recipient is outside the current known contact list, or the audit claim cannot be written.

## API and retry behavior

- `GET /admin/emails/recipients`: deduplicated contacts; paginates all three source tables instead of silently truncating at Supabase's default row limit.
- `POST /admin/emails`: `{ requestId, emails, subject, format: "html" | "text", body }`.
- `GET /admin/emails/:requestId`: status of a send request.

All routes use `SupabaseAuthGuard` followed by the database-role `AdminGuard`. The audit table has RLS enabled and no browser grants. Email API calls use the existing bearer-token authentication; provider and Supabase privileged keys stay on the server.

A unique request ID is claimed in the database before contacting Resend. The stored content hash binds the subject, message format/body, and exact recipients to that ID. Concurrent or repeated requests cannot create another send for the same ID. Resend batches are limited to 100 separate messages with stable provider idempotency keys. Failed or interrupted sends are not automatically replayed. The client can retry the same immutable request or check its status after an uncertain network failure. A send stuck in `sending`, or a failed/uncertain batch, needs provider-log inspection before starting another message.

**Accepted** means the provider confirmed acceptance, not inbox delivery. If an API/provider connection fails, some messages may already have been accepted; the UI reports this uncertainty instead of claiming delivery or retrying a different transport. The audit records request ID, initiating admin UUID, recipient addresses/count, subject, content hash, acceptance count, status, and error state; it does not store the HTML body.

## Verification

`pnpm typecheck`, `pnpm test`, and `pnpm build`. Tests use test contacts and mocked provider calls; no real email is sent. Live migration application, authenticated production sending, and inbox delivery remain unverified until the service configuration and deployment blockers are resolved.

Local verification on 2026-11-09: typechecks and both application builds passed; 2 existing auth tests and 8 new email tests passed. Chromium exercised individual/selected/all sends, raw HTML, `.html` upload, plain text, review/edit, and sandboxed preview at 1440px and 390px with all service calls mocked. Screenshots: `/tmp/fremwork-admin-email-1440.png` and `/tmp/fremwork-admin-email-390.png`. The running built NestJS API rejected all three unauthenticated email endpoints with HTTP 401. No real emails were sent and the migration was not applied to production.
