-- Security hardening (2026-11-02).
--
-- 1. Only the owner's account is active. The first account ever created is the admin; any
--    account created after it starts INACTIVE (no access to any data) until the admin turns
--    it on. Before, a new account started active as a viewer and could read customers,
--    prices and quotations.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_first boolean;
begin
  perform pg_advisory_xact_lock(hashtext('public.profiles.first_admin'));
  v_first := not exists (select 1 from public.profiles);

  insert into public.profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(left(trim(new.raw_user_meta_data ->> 'full_name'), 120), ''),
    case when v_first then 'admin'::public.app_role else 'viewer'::public.app_role end,
    v_first
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

-- 2. Trigger functions run only as triggers: nobody may call them through the API
--    (/rest/v1/rpc/...). Triggers keep working; EXECUTE is only checked when calling directly.
revoke execute on function public.assign_quote_no() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_email_change() from public, anon, authenticated;
revoke execute on function public.protect_profile() from public, anon, authenticated;
revoke execute on function public.set_audit_fields() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- (can_edit, is_admin, is_active_user, current_app_role and can_modify_quotation stay
-- callable by signed-in users: the table rules use them, and they only answer about the caller.)
