-- Move email webhooks to the selected shared Supabase project.
-- Historical migrations are unchanged; deploy the Edge Functions in this project too.

create or replace function private.send_registration_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://jwznteirgsnebvtswppu.supabase.co/functions/v1/registration-email',
    body := jsonb_build_object('registration_id', new.id,
      'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'registration_email_webhook')),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 10000
  );
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
      url := 'https://jwznteirgsnebvtswppu.supabase.co/functions/v1/welcome-email',
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
