-- Welcome email through Resend when a new account's email is confirmed.
-- Fires on insert when confirmation is off or for Google sign-in, and on update when confirmation is on.
-- Accounts that are already confirmed never fire, so existing users get nothing.
alter table public.profiles add column if not exists welcome_sent_at timestamptz;

create or replace function private.send_welcome_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is null or (tg_op = 'UPDATE' and old.email_confirmed_at is not null) then
    return new;
  end if;
  -- An email problem must never block a sign-up.
  begin
    perform net.http_post(
      url := 'https://gwdrtfcqqnvhwolbjkab.supabase.co/functions/v1/welcome-email',
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

create trigger on_auth_user_welcome_email after insert or update of email_confirmed_at on auth.users
  for each row execute function private.send_welcome_email();
