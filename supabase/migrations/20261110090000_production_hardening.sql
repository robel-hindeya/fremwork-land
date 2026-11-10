-- Production hardening for the Supabase FREE plan. Additive and safe to run on a database
-- that already has every earlier migration: it deletes no rows, drops no tables or columns.
--
-- 1. Email webhooks read this project's URL from Vault instead of a hard-coded project ref,
--    and a webhook problem can never block a registration.
-- 2. Anonymous visit tracking is capped per IP, so a script cannot fill the 500 MB free database.
-- 3. Indexes for unindexed foreign keys and case-insensitive email lookups.
-- 4. Admin event policies split per action (one permissive SELECT policy per role).

-- 1. Webhook URL --------------------------------------------------------------------------
-- After applying, store the project URL once (SQL Editor):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url', 'Base URL for Edge Function webhooks');
-- Until then the previous default (jwznteirgsnebvtswppu) is used.
create or replace function private.edge_function_url(p_name text)
returns text language sql stable security definer set search_path = '' as $$
  select rtrim(coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1),
    'https://jwznteirgsnebvtswppu.supabase.co'), '/') || '/functions/v1/' || p_name;
$$;
revoke execute on function private.edge_function_url(text) from public, anon, authenticated;

create or replace function private.send_registration_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- An email problem must never block a registration.
  begin
    perform net.http_post(
      url := private.edge_function_url('registration-email'),
      body := jsonb_build_object('registration_id', new.id,
        'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'registration_email_webhook')),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'registration email not queued: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke execute on function private.send_registration_email() from public, anon, authenticated;

create or replace function private.send_welcome_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is null or (tg_op = 'UPDATE' and old.email_confirmed_at is not null) then
    return new;
  end if;
  -- An email problem must never block a sign-up.
  begin
    perform net.http_post(
      url := private.edge_function_url('welcome-email'),
      body := jsonb_build_object('user_id', new.id,
        'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'registration_email_webhook')),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'welcome email not queued: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke execute on function private.send_welcome_email() from public, anon, authenticated;

-- 2. Visit tracking cap ------------------------------------------------------------------
-- Same behaviour as 20261031100000_site_visitors_no_ip_merge.sql, plus: at most 60 new visitor
-- rows per IP address per hour. Known visitors are still updated normally.
create or replace function public.track_visit(
  p_browser_id uuid, p_path text default null, p_referrer text default null,
  p_country text default null, p_region text default null, p_city text default null, p_source text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  h json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  v_ip text := nullif(trim(split_part(coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', h->>'x-forwarded-for', ''), ',', 1)), '');
  v_ua text := left(h->>'user-agent', 400);
  v_country text := upper(coalesce(nullif(h->>'cf-ipcountry', ''), nullif(left(p_country, 2), '')));
  v_region text := nullif(left(p_region, 80), '');
  v_city text := nullif(left(p_city, 80), '');
  v_uid uuid := auth.uid();
  v_email text := lower(nullif(auth.jwt()->>'email', ''));
  v_path text := left(p_path, 300);
  v_id bigint;
begin
  if v_ua ~* '(bot|crawl|spider|slurp|preview|headless|lighthouse|monitor)' then return; end if;
  if v_country in ('XX', 'T1') then v_country := null; end if;

  if v_email is not null then
    select id into v_id from public.site_visitors where lower(email) = v_email order by first_seen limit 1;
  end if;
  if v_id is null and p_browser_id is not null then
    select id into v_id from public.site_visitors
     where browser_id = p_browser_id and (email is null or v_email is null or lower(email) = v_email)
     order by first_seen limit 1;
  end if;

  if v_id is null then
    if v_ip is not null and (select count(*) from public.site_visitors
        where ip = v_ip and first_seen > now() - interval '1 hour') >= 60 then
      return;
    end if;
    insert into public.site_visitors (email, user_id, browser_id, ip, user_agent, referrer, source, first_path, last_path, country, region, city)
    values (v_email, v_uid, p_browser_id, v_ip, v_ua, left(nullif(p_referrer, ''), 300), left(nullif(p_source, ''), 80),
            v_path, v_path, v_country, v_region, v_city);
  else
    update public.site_visitors set
      visits     = visits + case when last_seen < now() - interval '30 minutes' then 1 else 0 end,
      last_seen  = now(),
      last_path  = coalesce(v_path, last_path),
      email      = coalesce(email, v_email),
      user_id    = coalesce(user_id, v_uid),
      browser_id = coalesce(browser_id, p_browser_id),
      ip         = coalesce(v_ip, ip),
      user_agent = coalesce(v_ua, user_agent),
      country    = coalesce(v_country, country),
      region     = case when v_city is not null or v_region is not null then v_region else region end,
      city       = coalesce(v_city, city)
    where id = v_id;
  end if;
end;
$$;
revoke execute on function public.track_visit(uuid, text, text, text, text, text, text) from public;
grant execute on function public.track_visit(uuid, text, text, text, text, text, text) to anon, authenticated;

-- 3. Indexes -------------------------------------------------------------------------------
create index if not exists site_visitors_user_id_idx on public.site_visitors (user_id);
create index if not exists site_visitors_ip_first_seen_idx on public.site_visitors (ip, first_seen desc);
create index if not exists admin_email_campaigns_created_by_idx on public.admin_email_campaigns (created_by);
create index if not exists event_registrations_email_idx on public.event_registrations (lower(email));
create index if not exists profiles_email_idx on public.profiles (lower(email));

-- 4. Admin event policies ---------------------------------------------------------------------
-- "admins write events" was FOR ALL, which added a second permissive SELECT policy next to
-- "anyone reads published events". Admins already read every event through that policy.
drop policy if exists "admins write events" on public.events;
-- Safe to run twice (for example when pasted into the SQL Editor again).
drop policy if exists "admins insert events" on public.events;
drop policy if exists "admins update events" on public.events;
drop policy if exists "admins delete events" on public.events;
create policy "admins insert events" on public.events for insert to authenticated
  with check ((select private.is_admin()));
create policy "admins update events" on public.events for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins delete events" on public.events for delete to authenticated
  using ((select private.is_admin()));
