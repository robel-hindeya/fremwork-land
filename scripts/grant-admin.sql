-- Target project: jwznteirgsnebvtswppu (the new shared Supabase project).
-- Run once in the shared Fremwork Supabase project's SQL Editor as an authorized administrator.
-- This provisions a verified account by UUID; it adds no email-based authorization rule.
-- If the account does not exist or has not confirmed email, this transaction changes nothing.
begin;

do $$
declare
  target_id uuid;
begin
  select id into target_id
  from auth.users
  where lower(email) = 'edomiyastesfaye321@gmail.com'
    and email_confirmed_at is not null;

  if target_id is null then
    raise exception 'No confirmed account exists for edomiyastesfaye321@gmail.com. Register and confirm the account first.';
  end if;

  -- Also repair a missing profile for this confirmed account.
  insert into public.profiles as profile (id, email, full_name, role)
  select id, email,
    coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', ''),
    'admin'::public.app_role
  from auth.users where id = target_id
  on conflict (id) do update
  set role = case when profile.role = 'owner' then profile.role else 'admin'::public.app_role end;

end;
$$;

select p.id, p.email, p.role
from public.profiles p
join auth.users u on u.id = p.id
where lower(u.email) = 'edomiyastesfaye321@gmail.com'
  and u.email_confirmed_at is not null;

commit;
