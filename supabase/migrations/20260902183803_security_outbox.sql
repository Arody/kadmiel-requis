-- Remove role-directory exposure and make WhatsApp delivery recover from a
-- worker crash without duplicating normal retries.

drop policy if exists "Permitir lectura de user_roles para visualización" on public.user_roles;
drop policy if exists "Users can view their own roles" on public.user_roles;
drop policy if exists user_roles_select_self_or_super_admin on public.user_roles;
alter table public.user_roles enable row level security;
revoke all on public.user_roles from public, anon, authenticated;
grant select on public.user_roles to authenticated;

create policy user_roles_select_self_or_super_admin
on public.user_roles for select to authenticated
using (
  user_id = auth.uid()
  or public.has_role(auth.uid(), 'super_admin'::public.app_role)
);

alter table wp_data.message_outbox
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_token uuid,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists event_key uuid not null default coalesce(
    nullif(pg_catalog.current_setting('kadmiel.command_id', true), '')::uuid,
    gen_random_uuid()
  );

alter table wp_data.message_outbox
  add constraint message_outbox_event_delivery_key
    unique (event_type, ref_id, recipient_employee_id, event_key);

create index if not exists message_outbox_delivery_idx
  on wp_data.message_outbox(status, next_attempt_at, created_at)
  where status in ('pending', 'sending');

-- Keep the running VPS compatible during the rolling deploy. Legacy claims are
-- explicitly tokenless, so their acknowledgements cannot complete a v2 lease.
create or replace function public.wp_gw_claim_messages(p_limit integer default 10)
returns table(id uuid, to_phone text, body text)
language sql
security definer
set search_path = ''
as $function$
  with expired as (
    update wp_data.message_outbox
    set status = 'pending', claimed_at = null, claim_token = null,
        next_attempt_at = now() + interval '15 seconds'
    where status = 'sending'
      and coalesce(claimed_at, created_at) < now() - interval '5 minutes'
    returning id
  ), claimed as (
    select m.id
    from wp_data.message_outbox m
    where m.status = 'pending' and m.next_attempt_at <= now()
    order by m.created_at
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  update wp_data.message_outbox o
  set status = 'sending', attempts = o.attempts + 1,
      claimed_at = now(), claim_token = null
  from claimed
  where o.id = claimed.id
  returning o.id, o.to_phone, o.body;
$function$;

create or replace function public.wp_gw_mark_sent(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $function$
  update wp_data.message_outbox
  set status = 'sent', sent_at = now(), claimed_at = null,
      claim_token = null, last_error = null
  where id = p_id and status = 'sending' and claim_token is null;
$function$;

create or replace function public.wp_gw_mark_failed(
  p_id uuid,
  p_error text,
  p_max integer default 3
)
returns void
language sql
security definer
set search_path = ''
as $function$
  update wp_data.message_outbox
  set status = case when attempts >= greatest(coalesce(p_max, 3), 1) then 'failed' else 'pending' end,
      claimed_at = null,
      claim_token = null,
      next_attempt_at = now() + make_interval(secs => least(300, (15 * power(2, greatest(attempts - 1, 0)))::integer)),
      last_error = left(coalesce(p_error, 'Error desconocido'), 2000)
  where id = p_id and status = 'sending' and claim_token is null;
$function$;

create or replace function public.wp_gw_claim_messages_v2(
  p_limit integer default 10,
  p_max integer default 3
)
returns table(id uuid, to_phone text, body text, claim_token uuid)
language sql
security definer
set search_path = ''
as $function$
  with exhausted as (
    update wp_data.message_outbox
    set status = 'failed',
        last_error = coalesce(last_error, 'Entrega detenida después del máximo de intentos')
    where status = 'pending'
      and attempts >= greatest(coalesce(p_max, 3), 1)
    returning id
  ), expired as (
    update wp_data.message_outbox
    set status = case when attempts >= greatest(coalesce(p_max, 3), 1) then 'failed' else 'pending' end,
        claimed_at = null,
        claim_token = null,
        next_attempt_at = now() + make_interval(secs => least(300, (15 * power(2, greatest(attempts - 1, 0)))::integer)),
        last_error = case
          when attempts >= greatest(coalesce(p_max, 3), 1) then coalesce(last_error, 'Entrega interrumpida después del máximo de intentos')
          else last_error
        end
    where status = 'sending'
      and coalesce(claimed_at, created_at) < now() - interval '5 minutes'
    returning id
  ), claimed as (
    select m.id
    from wp_data.message_outbox m
    where m.status = 'pending'
      and m.attempts < greatest(coalesce(p_max, 3), 1)
      and m.next_attempt_at <= now()
    order by m.created_at
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  update wp_data.message_outbox o
  set status = 'sending', attempts = o.attempts + 1, claimed_at = now(), claim_token = gen_random_uuid()
  from claimed
  where o.id = claimed.id
  returning o.id, o.to_phone, o.body, o.claim_token;
$function$;

create or replace function public.wp_gw_mark_sent_v2(p_id uuid, p_claim_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_affected integer;
begin
  update wp_data.message_outbox
  set status = 'sent', sent_at = now(), claimed_at = null,
      claim_token = null, last_error = null
  where id = p_id and status = 'sending' and claim_token = p_claim_token;
  get diagnostics v_affected = row_count;
  return v_affected = 1;
end;
$function$;

create or replace function public.wp_gw_mark_failed_v2(
  p_id uuid,
  p_claim_token uuid,
  p_error text,
  p_max integer default 3
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_affected integer;
begin
  update wp_data.message_outbox
  set status = case when attempts >= greatest(coalesce(p_max, 3), 1) then 'failed' else 'pending' end,
      claimed_at = null,
      claim_token = null,
      next_attempt_at = now() + make_interval(secs => least(300, (15 * power(2, greatest(attempts - 1, 0)))::integer)),
      last_error = left(coalesce(p_error, 'Error desconocido'), 2000)
  where id = p_id and status = 'sending' and claim_token = p_claim_token;
  get diagnostics v_affected = row_count;
  return v_affected = 1;
end;
$function$;

revoke all on function public.wp_gw_claim_messages_v2(integer, integer) from public, anon, authenticated;
revoke all on function public.wp_gw_mark_sent_v2(uuid, uuid) from public, anon, authenticated;
revoke all on function public.wp_gw_mark_failed_v2(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.wp_gw_claim_messages(integer) from public, anon, authenticated;
revoke all on function public.wp_gw_mark_sent(uuid) from public, anon, authenticated;
revoke all on function public.wp_gw_mark_failed(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.wp_gw_claim_messages_v2(integer, integer) to service_role;
grant execute on function public.wp_gw_mark_sent_v2(uuid, uuid) to service_role;
grant execute on function public.wp_gw_mark_failed_v2(uuid, uuid, text, integer) to service_role;
grant execute on function public.wp_gw_claim_messages(integer) to service_role;
grant execute on function public.wp_gw_mark_sent(uuid) to service_role;
grant execute on function public.wp_gw_mark_failed(uuid, text, integer) to service_role;

-- Preserve the existing WhatsApp choices while renaming requisition statuses.
insert into wp_data.notification_rules(event_type, enabled, template, updated_at)
select mapping.new_event_type, rules.enabled, rules.template, now()
from (values
  ('requisition_status_revisada', 'requisition_status_revisando_compras'),
  ('requisition_status_aprobada', 'requisition_status_aprobada_compras'),
  ('requisition_status_cancelada', 'requisition_status_cancelada_compras')
) mapping(old_event_type, new_event_type)
join wp_data.notification_rules rules on rules.event_type = mapping.old_event_type
on conflict (event_type) do nothing;

insert into wp_data.notification_recipients(
  event_type, employee_id, phone, display_name, created_at
)
select
  mapping.new_event_type, recipients.employee_id, recipients.phone,
  recipients.display_name, now()
from (values
  ('requisition_status_revisada', 'requisition_status_revisando_compras'),
  ('requisition_status_aprobada', 'requisition_status_aprobada_compras'),
  ('requisition_status_cancelada', 'requisition_status_cancelada_compras')
) mapping(old_event_type, new_event_type)
join wp_data.notification_recipients recipients
  on recipients.event_type = mapping.old_event_type
on conflict (event_type, employee_id) do nothing;
