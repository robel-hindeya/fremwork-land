-- Durable send claims prevent duplicate admin submissions across API instances.
create table public.admin_email_campaigns (
  id uuid primary key,
  created_by uuid not null references auth.users(id),
  subject text not null,
  content_hash text not null,
  recipients jsonb not null,
  recipient_count integer not null check (recipient_count between 1 and 1000),
  accepted_count integer not null default 0 check (accepted_count >= 0 and accepted_count <= recipient_count),
  status text not null check (status in ('sending', 'completed', 'failed')),
  error_code text,
  created_at timestamptz not null default now()
);
alter table public.admin_email_campaigns enable row level security;
revoke all on public.admin_email_campaigns from public, anon, authenticated;
grant select, insert, update on public.admin_email_campaigns to service_role;
-- No browser writes or public policies: the role-checked API owns this audit table.
