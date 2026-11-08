-- Correct the email-based privilege bypass without rewriting applied history.
-- Existing owners remain attached to their profile UUID. No email grants ongoing privileges.
create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles
    where id = (select auth.uid()) and role in ('owner', 'admin'));
$$;
revoke execute on function private.is_admin() from public;
grant execute on function private.is_admin() to anon, authenticated;

-- A team invite used to grant its role the moment someone signed up with that address,
-- before they proved they own it. The role now waits for a confirmed email.
-- This only protects invites while "Confirm email" is on in Supabase Auth.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare invited public.app_role;
begin
  if new.email_confirmed_at is not null then
    select role into invited from public.team_invites
    where lower(email) = lower(new.email) and accepted_at is null;
  end if;
  if invited is not null then
    update public.team_invites set accepted_at = now()
      where lower(email) = lower(new.email) and accepted_at is null;
  end if;
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), coalesce(invited, 'member'));
  return new;
end;
$$;

create or replace function public.handle_user_confirmed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare invited public.app_role;
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.waitlist_entries set status = 'active' where lower(email) = lower(new.email);
    select role into invited from public.team_invites
    where lower(email) = lower(new.email) and accepted_at is null;
    if invited is not null then
      update public.profiles set role = invited where id = new.id;
      update public.team_invites set accepted_at = now() where lower(email) = lower(new.email) and accepted_at is null;
    end if;
  end if;
  return new;
end;
$$;
