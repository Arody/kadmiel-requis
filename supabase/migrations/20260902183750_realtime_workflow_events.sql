-- Forward migration for the existing Kadmiel schema.
-- State tables remain authoritative; domain events are an append-only audit and
-- a private Realtime invalidation signal.

alter table abastecimiento.requisitions
  add column if not exists version integer not null default 1,
  add column if not exists review_started_by uuid references auth.users(id) on delete set null,
  add column if not exists review_started_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_reason text;

alter table abastecimiento.purchase_orders
  add column if not exists version integer not null default 1,
  add column if not exists review_cycle integer not null default 1,
  add column if not exists accounting_approved_by uuid references auth.users(id) on delete set null,
  add column if not exists accounting_approved_at timestamptz,
  add column if not exists management_approved_by uuid references auth.users(id) on delete set null,
  add column if not exists management_approved_at timestamptz,
  add column if not exists rejected_by uuid references auth.users(id) on delete set null,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_reason text,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_reason text;

alter table abastecimiento.receipts
  add column if not exists version integer not null default 1;

-- The legacy checks reject the canonical states below, so remove them before
-- normalizing existing active rows. New checks are installed immediately after.
alter table abastecimiento.requisitions
  drop constraint if exists requisitions_status_check;

alter table abastecimiento.purchase_orders
  drop constraint if exists purchase_orders_status_check;

-- Do not generate notifications or rewrite business timestamps while normalizing
-- legacy active rows. Historical completed rows intentionally remain untouched.
alter table abastecimiento.requisitions disable trigger user;
alter table abastecimiento.purchase_orders disable trigger user;

update abastecimiento.requisitions
set request_type = case when status = 'urgente' then 'urgente' else request_type end,
    status = case status
  when 'urgente' then 'pendiente'
  when 'revisada' then 'revisando_compras'
  when 'aprobada' then 'aprobada_compras'
  when 'cancelada' then 'cancelada_compras'
  else status
end
where status in ('urgente', 'revisada', 'aprobada', 'cancelada');

update abastecimiento.purchase_orders
set status = case
  when status in ('pendiente', 'urgente', 'parcial') then 'revisando_gerencia'
  else status
end
where status in ('pendiente', 'urgente', 'parcial');

alter table abastecimiento.requisitions enable trigger user;
alter table abastecimiento.purchase_orders enable trigger user;

alter table abastecimiento.requisitions
  alter column status set default 'pendiente',
  add constraint requisitions_status_check check (
    status in (
      'pendiente', 'revisando_compras', 'aprobada_compras',
      'cancelada_compras', 'completado', 'completada'
    )
  );

alter table abastecimiento.purchase_orders
  alter column status set default 'revisando_gerencia',
  add constraint purchase_orders_status_check check (
    status in ('revisando_gerencia', 'aprobado', 'rechazado', 'cancelado', 'completado')
  ),
  add constraint purchase_orders_review_cycle_positive check (review_cycle > 0),
  add constraint purchase_orders_distinct_approvers check (
    accounting_approved_by is null
    or management_approved_by is null
    or accounting_approved_by <> management_approved_by
  );

create index if not exists requisitions_location_status_idx
  on abastecimiento.requisitions(location_id, status, updated_at desc);
create index if not exists purchase_orders_location_status_idx
  on abastecimiento.purchase_orders(location_id, status, updated_at desc);
create index if not exists receipts_location_status_idx
  on abastecimiento.receipts(location_id, status, updated_at desc);

create table abastecimiento.workflow_commands (
  actor_id uuid not null references auth.users(id) on delete cascade,
  command_id uuid not null,
  command_name text not null check (command_name <> ''),
  request_hash text not null check (request_hash <> ''),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, command_id)
);

alter table abastecimiento.workflow_commands enable row level security;
revoke all on abastecimiento.workflow_commands from public, anon, authenticated;

create or replace function abastecimiento.normalized_workflow_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select translate(lower(trim(coalesce(p_value, ''))), 'áéíóúüñ', 'aeiouun');
$function$;

create or replace function abastecimiento.has_workflow_permission(
  p_capability text,
  p_location_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null and exists (
    select 1
    from public.user_roles ur
    left join public.locations loc on loc.id = p_location_id
    left join public.location_departaments dep on dep.id = ur.department_id
    where ur.user_id = auth.uid()
      and (
        ur.role = 'super_admin'::public.app_role
        or p_location_id is null
        or ur.location_id = p_location_id
        or (
          ur.location_id is null
          and abastecimiento.normalize_branch(loc.name) = abastecimiento.normalize_branch(ur.sucursal::text)
        )
      )
      and case p_capability
        when 'purchasing' then
          ur.role in ('super_admin'::public.app_role, 'branch_admin'::public.app_role)
          or abastecimiento.normalized_workflow_text(coalesce(dep.name, ur.department::text)) = 'compras'
        when 'accounting' then
          ur.role in ('super_admin'::public.app_role, 'branch_admin'::public.app_role)
          or abastecimiento.normalized_workflow_text(coalesce(dep.name, ur.department::text)) in ('contabilidad', 'finanzas')
        when 'management' then
          ur.role in ('super_admin'::public.app_role, 'branch_admin'::public.app_role)
          or abastecimiento.normalized_workflow_text(coalesce(dep.name, ur.department::text)) in ('gerencia', 'direccion')
        when 'receiving' then
          ur.role in ('super_admin'::public.app_role, 'branch_admin'::public.app_role)
          or abastecimiento.normalized_workflow_text(coalesce(dep.name, ur.department::text)) in ('logistica', 'almacen', 'recepcion')
        when 'production' then
          ur.role in ('super_admin'::public.app_role, 'branch_admin'::public.app_role)
          or abastecimiento.normalized_workflow_text(coalesce(dep.name, ur.department::text)) = 'produccion'
        when 'inventory' then true
        else false
      end
  );
$function$;

create or replace function abastecimiento.event_location_capabilities(p_aggregate_type text)
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select case p_aggregate_type
    when 'requisition' then array['purchasing', 'production']::text[]
    when 'purchase_order' then array['purchasing', 'accounting', 'management', 'receiving']::text[]
    when 'receipt' then array['purchasing', 'receiving', 'inventory']::text[]
    when 'production' then array['inventory']::text[]
    when 'quality' then array['inventory']::text[]
    when 'merma_pv' then array['inventory']::text[]
    when 'transfer' then array['inventory']::text[]
    when 'waste' then array['inventory']::text[]
    when 'inventory' then array['inventory']::text[]
    else array[]::text[]
  end;
$function$;

create or replace function abastecimiento.can_receive_location_event(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null
    and p_location_id is not null
    and exists (
      select 1
      from public.user_roles ur
      left join public.locations loc on loc.id = p_location_id
      left join public.location_departaments dep on dep.id = ur.department_id
      where ur.user_id = auth.uid()
        and (
          ur.role in ('super_admin'::public.app_role, 'branch_admin'::public.app_role)
          or abastecimiento.normalized_workflow_text(coalesce(dep.name, ur.department::text)) in (
            'compras', 'contabilidad', 'finanzas', 'gerencia', 'direccion',
            'logistica', 'almacen', 'recepcion', 'produccion'
          )
        )
        and (
          ur.role = 'super_admin'::public.app_role
          or ur.location_id = p_location_id
          or (
            ur.location_id is null
            and abastecimiento.normalize_branch(loc.name) = abastecimiento.normalize_branch(ur.sucursal::text)
          )
        )
    );
$function$;

create or replace function abastecimiento.can_receive_location_event(
  p_location_id uuid,
  p_aggregate_type text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from unnest(abastecimiento.event_location_capabilities(p_aggregate_type)) as allowed(capability)
    where abastecimiento.has_workflow_permission(capability, p_location_id)
  );
$function$;

create or replace function abastecimiento.can_access_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null and exists (
    select 1
    from public.user_roles ur
    left join public.locations loc on loc.id = p_location_id
    where ur.user_id = auth.uid()
      and (
        ur.role = 'super_admin'::public.app_role
        or (
          p_location_id is not null
          and (
            ur.location_id = p_location_id
            or (
              ur.location_id is null
              and abastecimiento.normalize_branch(loc.name) = abastecimiento.normalize_branch(ur.sucursal::text)
            )
          )
        )
      )
  );
$function$;

create or replace function abastecimiento.can_manage_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null and exists (
    select 1
    from public.user_roles ur
    left join public.locations loc on loc.id = p_location_id
    where ur.user_id = auth.uid()
      and ur.role in ('super_admin'::public.app_role, 'branch_admin'::public.app_role)
      and (
        ur.role = 'super_admin'::public.app_role
        or (
          p_location_id is not null
          and (
            ur.location_id = p_location_id
            or (
              ur.location_id is null
              and abastecimiento.normalize_branch(loc.name) = abastecimiento.normalize_branch(ur.sucursal::text)
            )
          )
        )
      )
  );
$function$;

create or replace function abastecimiento.can_manage_purchases(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select abastecimiento.has_workflow_permission('purchasing', p_location_id)
      or abastecimiento.has_workflow_permission('accounting', p_location_id)
      or abastecimiento.has_workflow_permission('management', p_location_id);
$function$;

create or replace function abastecimiento.has_any_workflow_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null and exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
  );
$function$;

revoke all on function abastecimiento.normalized_workflow_text(text) from public;
revoke all on function abastecimiento.event_location_capabilities(text) from public;
revoke all on function abastecimiento.has_workflow_permission(text, uuid) from public;
revoke all on function abastecimiento.can_receive_location_event(uuid) from public;
revoke all on function abastecimiento.can_receive_location_event(uuid, text) from public;
revoke all on function abastecimiento.can_access_location(uuid) from public;
revoke all on function abastecimiento.can_manage_location(uuid) from public;
revoke all on function abastecimiento.can_manage_purchases(uuid) from public;
revoke all on function abastecimiento.has_any_workflow_role() from public;
grant execute on function abastecimiento.has_workflow_permission(text, uuid) to authenticated;
grant execute on function abastecimiento.can_receive_location_event(uuid) to authenticated;
grant execute on function abastecimiento.can_receive_location_event(uuid, text) to authenticated;
grant execute on function abastecimiento.can_access_location(uuid) to authenticated;
grant execute on function abastecimiento.can_manage_location(uuid) to authenticated;
grant execute on function abastecimiento.can_manage_purchases(uuid) to authenticated;
grant execute on function abastecimiento.has_any_workflow_role() to authenticated;

create or replace function abastecimiento.claim_workflow_command(
  p_command_name text,
  p_command_id uuid,
  p_request jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_existing abastecimiento.workflow_commands%rowtype;
  v_request_hash text := pg_catalog.encode(
    extensions.digest(coalesce(p_request, '{}'::jsonb)::text, 'sha256'),
    'hex'
  );
begin
  if v_actor_id is null then
    raise exception 'Debes iniciar sesión.' using errcode = '28000';
  end if;
  if p_command_id is null or nullif(trim(p_command_name), '') is null then
    raise exception 'La operación necesita una clave idempotente válida.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || p_command_id::text, 0)
  );

  select * into v_existing
  from abastecimiento.workflow_commands
  where actor_id = v_actor_id and command_id = p_command_id;

  if found then
    if v_existing.command_name <> p_command_name
       or v_existing.request_hash <> v_request_hash then
      raise exception 'La clave idempotente ya pertenece a otra operación o contenido.' using errcode = '22023';
    end if;
    return jsonb_build_object('replayed', true, 'result', v_existing.result);
  end if;

  perform pg_catalog.set_config('kadmiel.command_request_hash', v_request_hash, true);
  return jsonb_build_object('replayed', false);
end;
$function$;

create or replace function abastecimiento.finish_workflow_command(
  p_command_name text,
  p_command_id uuid,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into abastecimiento.workflow_commands(
    actor_id, command_id, command_name, request_hash, result
  ) values (
    auth.uid(), p_command_id, p_command_name,
    nullif(pg_catalog.current_setting('kadmiel.command_request_hash', true), ''),
    coalesce(p_result, '{}'::jsonb)
  );
end;
$function$;

revoke all on function abastecimiento.claim_workflow_command(text, uuid, jsonb) from public;
revoke all on function abastecimiento.finish_workflow_command(text, uuid, jsonb) from public;

create table abastecimiento.domain_events (
  sequence_id bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid() unique,
  command_id uuid,
  event_type text not null check (event_type <> ''),
  aggregate_type text not null check (aggregate_type <> ''),
  aggregate_id uuid not null,
  aggregate_version integer not null default 1 check (aggregate_version > 0),
  -- Event references deliberately have no cascading FK: audit rows are immutable
  -- and deleting a source must never widen an event into global visibility.
  location_id uuid,
  secondary_location_id uuid,
  audience_user_id uuid,
  actor_id uuid,
  is_global boolean not null default false,
  from_status text,
  to_status text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now(),
  check (is_global = (
    location_id is null and secondary_location_id is null and audience_user_id is null
  ))
);

create index domain_events_location_sequence_idx
  on abastecimiento.domain_events(location_id, sequence_id desc);
create index domain_events_secondary_location_sequence_idx
  on abastecimiento.domain_events(secondary_location_id, sequence_id desc)
  where secondary_location_id is not null;
create index domain_events_audience_sequence_idx
  on abastecimiento.domain_events(audience_user_id, sequence_id desc)
  where audience_user_id is not null;
create index domain_events_aggregate_idx
  on abastecimiento.domain_events(aggregate_type, aggregate_id, sequence_id desc);
create index domain_events_command_idx
  on abastecimiento.domain_events(command_id)
  where command_id is not null;

alter table abastecimiento.domain_events enable row level security;
revoke all on abastecimiento.domain_events from public, anon, authenticated;
grant select on abastecimiento.domain_events to authenticated;

create policy domain_events_read_related
on abastecimiento.domain_events
for select
to authenticated
using (
  auth.uid() = audience_user_id
  or (location_id is not null and abastecimiento.can_receive_location_event(location_id, aggregate_type))
  or (secondary_location_id is not null and abastecimiento.can_receive_location_event(secondary_location_id, aggregate_type))
  or (is_global and abastecimiento.has_any_workflow_role())
);

create or replace function public.get_abastecimiento_domain_event_cursor()
returns bigint
language sql
stable
set search_path = ''
as $function$
  select coalesce(max(sequence_id), 0)
  from abastecimiento.domain_events;
$function$;

revoke all on function public.get_abastecimiento_domain_event_cursor() from public, anon;
grant execute on function public.get_abastecimiento_domain_event_cursor() to authenticated;

create or replace function public.list_abastecimiento_domain_events_after(
  p_after_sequence bigint default 0,
  p_limit integer default 200
)
returns setof abastecimiento.domain_events
language sql
stable
set search_path = ''
as $function$
  select event.*
  from abastecimiento.domain_events event
  where event.sequence_id > greatest(coalesce(p_after_sequence, 0), 0)
  order by event.sequence_id
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$function$;

revoke all on function public.list_abastecimiento_domain_events_after(bigint, integer) from public, anon;
grant execute on function public.list_abastecimiento_domain_events_after(bigint, integer) to authenticated;

create or replace function abastecimiento.prevent_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception '% es append-only; registra un evento compensatorio.', tg_table_name
    using errcode = '55000';
end;
$function$;

create trigger domain_events_append_only
before update or delete on abastecimiento.domain_events
for each row execute function abastecimiento.prevent_append_only_mutation();

revoke all on function abastecimiento.prevent_append_only_mutation() from public;

create or replace function abastecimiento.emit_domain_event(
  p_event_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_aggregate_version integer,
  p_location_id uuid,
  p_secondary_location_id uuid default null,
  p_audience_user_id uuid default null,
  p_from_status text default null,
  p_to_status text default null,
  p_payload jsonb default '{}'::jsonb,
  p_command_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_command_id uuid;
  v_event abastecimiento.domain_events%rowtype;
  v_record jsonb;
  v_capability text;
begin
  if p_aggregate_id is null
     or nullif(trim(p_event_type), '') is null
     or nullif(trim(p_aggregate_type), '') is null then
    raise exception 'El evento de dominio está incompleto.' using errcode = '22023';
  end if;

  v_command_id := coalesce(
    p_command_id,
    nullif(pg_catalog.current_setting('kadmiel.command_id', true), '')::uuid
  );

  insert into abastecimiento.domain_events(
    command_id, event_type, aggregate_type, aggregate_id, aggregate_version,
    location_id, secondary_location_id, audience_user_id, actor_id, is_global,
    from_status, to_status, payload
  ) values (
    v_command_id, p_event_type, p_aggregate_type, p_aggregate_id,
    greatest(coalesce(p_aggregate_version, 1), 1), p_location_id,
    p_secondary_location_id, p_audience_user_id, auth.uid(),
    p_location_id is null and p_secondary_location_id is null and p_audience_user_id is null,
    p_from_status, p_to_status, coalesce(p_payload, '{}'::jsonb)
  ) returning * into v_event;

  v_record := jsonb_build_object(
    'sequence_id', v_event.sequence_id,
    'event_id', v_event.event_id,
    'command_id', v_event.command_id,
    'event_type', v_event.event_type,
    'aggregate_type', v_event.aggregate_type,
    'aggregate_id', v_event.aggregate_id,
    'aggregate_version', v_event.aggregate_version,
    'location_id', v_event.location_id,
    'secondary_location_id', v_event.secondary_location_id,
    'audience_user_id', v_event.audience_user_id,
    'is_global', v_event.is_global,
    'from_status', v_event.from_status,
    'to_status', v_event.to_status,
    'payload', v_event.payload,
    'occurred_at', v_event.occurred_at
  );

  -- Delivery is best effort; the durable row above remains the source for catch-up.
  begin
    if v_event.location_id is not null then
      foreach v_capability in array abastecimiento.event_location_capabilities(v_event.aggregate_type)
      loop
        perform realtime.send(
          jsonb_build_object('record', v_record), 'INSERT',
          'abastecimiento:location:' || v_event.location_id::text || ':' || v_capability, true
        );
      end loop;
    end if;
    if v_event.secondary_location_id is not null
       and v_event.secondary_location_id is distinct from v_event.location_id then
      foreach v_capability in array abastecimiento.event_location_capabilities(v_event.aggregate_type)
      loop
        perform realtime.send(
          jsonb_build_object('record', v_record), 'INSERT',
          'abastecimiento:location:' || v_event.secondary_location_id::text || ':' || v_capability, true
        );
      end loop;
    end if;
    if v_event.audience_user_id is not null then
      perform realtime.send(
        jsonb_build_object('record', v_record), 'INSERT',
        'abastecimiento:user:' || v_event.audience_user_id::text, true
      );
    end if;
    if v_event.is_global then
      perform realtime.send(
        jsonb_build_object('record', v_record), 'INSERT',
        'abastecimiento:global', true
      );
    end if;
  exception when others then
    raise warning 'No se pudo emitir el evento Realtime %: %', v_event.event_id, sqlerrm;
  end;

  return v_event.event_id;
end;
$function$;

revoke all on function abastecimiento.emit_domain_event(
  text, text, uuid, integer, uuid, uuid, uuid, text, text, jsonb, uuid
) from public;

drop policy if exists abastecimiento_private_broadcast_read on realtime.messages;
create policy abastecimiento_private_broadcast_read
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and (
    (
      (select realtime.topic()) = 'abastecimiento:global'
      and abastecimiento.has_any_workflow_role()
    )
    or (
      (select realtime.topic()) = 'abastecimiento:user:' || auth.uid()::text
    )
    or case
      when (select realtime.topic()) ~ '^abastecimiento:location:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}:(purchasing|accounting|management|receiving|production|inventory)$'
      then abastecimiento.has_workflow_permission(
        split_part((select realtime.topic()), ':', 4),
        split_part((select realtime.topic()), ':', 3)::uuid
      )
      else false
    end
  )
);

create or replace function abastecimiento.bump_workflow_version()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.version := old.version + 1;
  return new;
end;
$function$;

create trigger requisitions_bump_workflow_version
before update on abastecimiento.requisitions
for each row execute function abastecimiento.bump_workflow_version();

create trigger purchase_orders_bump_workflow_version
before update on abastecimiento.purchase_orders
for each row execute function abastecimiento.bump_workflow_version();

create trigger receipts_bump_workflow_version
before update on abastecimiento.receipts
for each row execute function abastecimiento.bump_workflow_version();

create or replace function abastecimiento.capture_domain_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_location_id uuid;
  v_secondary_location_id uuid;
  v_audience_user_id uuid;
  v_aggregate_type text;
  v_event_type text;
  v_version integer;
begin
  v_location_id := coalesce(
    nullif(v_row->>'location_id', '')::uuid,
    nullif(v_row->>'origin_location_id', '')::uuid
  );
  v_secondary_location_id := nullif(v_row->>'destination_location_id', '')::uuid;
  if tg_table_name = 'requisitions'
     and tg_op = 'UPDATE'
     and (v_old->>'location_id') is distinct from (v_row->>'location_id') then
    v_secondary_location_id := nullif(v_old->>'location_id', '')::uuid;
  end if;
  if tg_table_name in (
    'areas', 'suppliers', 'inventory', 'locations', 'inventory_categories',
    'location_departaments', 'inventory_locations', 'inventory_areas',
    'inventory_departments', 'location_areas', 'user_roles'
  ) then
    v_location_id := null;
    v_secondary_location_id := null;
  end if;
  v_version := greatest(coalesce(nullif(v_row->>'version', '')::integer, 1), 1);

  v_aggregate_type := case tg_table_name
    when 'requisitions' then 'requisition'
    when 'purchase_orders' then 'purchase_order'
    when 'receipts' then 'receipt'
    when 'production_lots' then 'production'
    when 'quality_verifications' then 'quality'
    when 'merma_pv_records' then 'merma_pv'
    when 'transfers' then 'transfer'
    when 'waste_entries' then 'waste'
    when 'stock_lots' then 'inventory'
    when 'inventory' then 'inventory_catalog'
    when 'areas' then 'area'
    when 'suppliers' then 'supplier'
    when 'locations' then 'location'
    when 'inventory_categories' then 'category'
    when 'location_departaments' then 'department'
    when 'inventory_locations' then 'inventory_assignment'
    when 'inventory_areas' then 'inventory_assignment'
    when 'inventory_departments' then 'inventory_assignment'
    when 'location_areas' then 'location_area'
    when 'user_roles' then 'user_role'
    else tg_table_name
  end;

  v_event_type := case
    when tg_op = 'INSERT' then 'created'
    when tg_op = 'DELETE' then 'deleted'
    when tg_table_name = 'purchase_orders'
      and (v_old->>'accounting_approved_by') is distinct from (v_row->>'accounting_approved_by')
      and nullif(v_row->>'accounting_approved_by', '') is not null then 'accounting_approved'
    when tg_table_name = 'purchase_orders'
      and (v_old->>'management_approved_by') is distinct from (v_row->>'management_approved_by')
      and nullif(v_row->>'management_approved_by', '') is not null then 'management_approved'
    when tg_table_name = 'purchase_orders'
      and v_row->>'status' = 'rechazado' and v_old->>'status' is distinct from 'rechazado' then 'rejected'
    when tg_table_name = 'purchase_orders'
      and v_old->>'status' = 'rechazado' and v_row->>'status' = 'revisando_gerencia' then 'resubmitted'
    when v_row->>'status' in ('cancelado', 'cancelada_compras')
      and (v_old->>'status') is distinct from (v_row->>'status') then 'cancelled'
    when tg_table_name = 'requisitions'
      and v_row->>'status' = 'revisando_compras' and v_old->>'status' is distinct from 'revisando_compras' then 'purchasing_review_started'
    when tg_table_name = 'requisitions'
      and v_row->>'status' = 'aprobada_compras' and v_old->>'status' is distinct from 'aprobada_compras' then 'purchasing_approved'
    when tg_table_name = 'receipts'
      and v_row->>'status' = 'recibida' and v_old->>'status' is distinct from 'recibida' then 'received'
    when tg_table_name = 'receipts'
      and v_row->>'status' = 'en_almacen' and v_old->>'status' is distinct from 'en_almacen' then 'stored'
    when v_row->>'status' in ('completado', 'completada')
      and (v_old->>'status') is distinct from (v_row->>'status') then 'completed'
    when (v_old->>'status') is distinct from (v_row->>'status') then 'status_changed'
    else 'updated'
  end;

  if tg_table_name = 'requisitions' then
    v_audience_user_id := nullif(v_row->>'requested_by', '')::uuid;
  elsif tg_table_name = 'user_roles' then
    v_audience_user_id := nullif(v_row->>'user_id', '')::uuid;
  elsif tg_table_name = 'purchase_orders' then
    select r.requested_by into v_audience_user_id
    from abastecimiento.requisitions r
    where r.id = nullif(v_row->>'requisition_id', '')::uuid;
  elsif tg_table_name = 'receipts' then
    select r.requested_by into v_audience_user_id
    from abastecimiento.purchase_orders po
    join abastecimiento.requisitions r on r.id = po.requisition_id
    where po.id = nullif(v_row->>'purchase_order_id', '')::uuid;
  end if;

  perform abastecimiento.emit_domain_event(
    v_event_type,
    v_aggregate_type,
    (v_row->>'id')::uuid,
    v_version,
    v_location_id,
    v_secondary_location_id,
    v_audience_user_id,
    v_old->>'status',
    v_row->>'status',
    jsonb_strip_nulls(jsonb_build_object(
      'operation', tg_op,
      'schema', tg_table_schema,
      'table', tg_table_name,
      'folio', v_row->>'folio',
      'request_type', v_row->>'request_type',
      'source_type', v_row->>'source_type',
      'review_cycle', v_row->>'review_cycle',
      'previous_review_cycle', v_old->>'review_cycle',
      'accounting_approved_by', coalesce(v_row->>'accounting_approved_by', v_old->>'accounting_approved_by'),
      'management_approved_by', coalesce(v_row->>'management_approved_by', v_old->>'management_approved_by'),
      'rejected_by', coalesce(v_row->>'rejected_by', v_old->>'rejected_by'),
      'rejected_reason', coalesce(v_row->>'rejected_reason', v_old->>'rejected_reason'),
      'cancelled_by', coalesce(v_row->>'cancelled_by', v_old->>'cancelled_by'),
      'cancelled_reason', coalesce(v_row->>'cancelled_reason', v_old->>'cancelled_reason'),
      'revision_note', coalesce(v_row->>'revision_note', v_old->>'revision_note')
    ))
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

revoke all on function abastecimiento.capture_domain_event() from public;

create trigger requisitions_capture_domain_event
after insert or update or delete on abastecimiento.requisitions
for each row execute function abastecimiento.capture_domain_event();
create trigger purchase_orders_capture_domain_event
after insert or update or delete on abastecimiento.purchase_orders
for each row execute function abastecimiento.capture_domain_event();
create trigger receipts_capture_domain_event
after insert or update or delete on abastecimiento.receipts
for each row execute function abastecimiento.capture_domain_event();
create trigger production_lots_capture_domain_event
after insert or update or delete on abastecimiento.production_lots
for each row execute function abastecimiento.capture_domain_event();
create trigger quality_verifications_capture_domain_event
after insert or update or delete on abastecimiento.quality_verifications
for each row execute function abastecimiento.capture_domain_event();
create trigger merma_pv_records_capture_domain_event
after insert or update or delete on abastecimiento.merma_pv_records
for each row execute function abastecimiento.capture_domain_event();
create trigger transfers_capture_domain_event
after insert or update or delete on abastecimiento.transfers
for each row execute function abastecimiento.capture_domain_event();
create trigger waste_entries_capture_domain_event
after insert or update or delete on abastecimiento.waste_entries
for each row execute function abastecimiento.capture_domain_event();
create trigger stock_lots_capture_domain_event
after insert or update or delete on abastecimiento.stock_lots
for each row execute function abastecimiento.capture_domain_event();
create trigger inventory_capture_domain_event
after insert or update or delete on public.inventory
for each row execute function abastecimiento.capture_domain_event();
create trigger areas_capture_domain_event
after insert or update or delete on abastecimiento.areas
for each row execute function abastecimiento.capture_domain_event();
create trigger suppliers_capture_domain_event
after insert or update or delete on abastecimiento.suppliers
for each row execute function abastecimiento.capture_domain_event();
create trigger suppliers_capture_domain_event
after insert or update or delete on public.suppliers
for each row execute function abastecimiento.capture_domain_event();
create trigger locations_capture_domain_event
after insert or update or delete on public.locations
for each row execute function abastecimiento.capture_domain_event();
create trigger inventory_categories_capture_domain_event
after insert or update or delete on public.inventory_categories
for each row execute function abastecimiento.capture_domain_event();
create trigger location_departaments_capture_domain_event
after insert or update or delete on public.location_departaments
for each row execute function abastecimiento.capture_domain_event();
create trigger inventory_locations_capture_domain_event
after insert or update or delete on public.inventory_locations
for each row execute function abastecimiento.capture_domain_event();
create trigger inventory_areas_capture_domain_event
after insert or update or delete on public.inventory_areas
for each row execute function abastecimiento.capture_domain_event();
create trigger inventory_departments_capture_domain_event
after insert or update or delete on public.inventory_departments
for each row execute function abastecimiento.capture_domain_event();
create trigger location_areas_capture_domain_event
after insert or update or delete on public.location_areas
for each row execute function abastecimiento.capture_domain_event();
create trigger user_roles_capture_domain_event
after insert or update or delete on public.user_roles
for each row execute function abastecimiento.capture_domain_event();

create or replace function abastecimiento.capture_production_catalog_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_type text := case tg_table_name
    when 'productos' then 'finished_product'
    when 'product_locations' then 'product_location'
    else 'recipe'
  end;
  v_key text;
begin
  v_key := coalesce(
    v_row->>'id',
    coalesce(v_row->>'product_id', '') || ':' || coalesce(v_row->>'location_id', '')
  );
  perform abastecimiento.emit_domain_event(
    case when tg_op = 'INSERT' then 'created' when tg_op = 'DELETE' then 'deleted' else 'updated' end,
    v_type,
    md5(v_type || ':' || v_key)::uuid,
    1,
    null,
    null,
    null,
    null,
    null,
    jsonb_strip_nulls(jsonb_build_object(
      'operation', tg_op,
      'schema', tg_table_schema,
      'table', tg_table_name,
      'entity_id', v_row->>'id',
      'product_id', v_row->>'product_id',
      'location_id', v_row->>'location_id'
    ))
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

revoke all on function abastecimiento.capture_production_catalog_event() from public;

create trigger productos_capture_domain_event
after insert or update or delete on public.productos
for each row execute function abastecimiento.capture_production_catalog_event();
create trigger product_locations_capture_domain_event
after insert or update or delete on public.product_locations
for each row execute function abastecimiento.capture_production_catalog_event();
create trigger recipes_capture_domain_event
after insert or update or delete on public.recipes
for each row execute function abastecimiento.capture_production_catalog_event();

create or replace function abastecimiento.prevent_user_role_reassignment()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'No se puede reasignar un rol; elimínalo y crea uno para el otro usuario.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger user_roles_prevent_reassignment
before update of user_id on public.user_roles
for each row execute function abastecimiento.prevent_user_role_reassignment();

revoke all on function abastecimiento.prevent_user_role_reassignment() from public;

create or replace function public.create_abastecimiento_requisition_v2(
  p_location_id uuid,
  p_area_id uuid,
  p_request_type text,
  p_needed_by date,
  p_notes text,
  p_items jsonb,
  p_command_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_requisition_id uuid;
  v_inserted_count integer;
begin
  v_claim := abastecimiento.claim_workflow_command(
    'create_requisition',
    p_command_id,
    jsonb_build_object(
      'location_id', p_location_id,
      'area_id', p_area_id,
      'request_type', p_request_type,
      'needed_by', p_needed_by,
      'notes', p_notes,
      'items', p_items
    )
  );
  if (v_claim->>'replayed')::boolean then
    return (v_claim->'result'->>'id')::uuid;
  end if;

  if p_location_id is null or not abastecimiento.can_access_location(p_location_id) then
    raise exception 'No tienes acceso a la sucursal seleccionada.' using errcode = '42501';
  end if;
  if coalesce(nullif(p_request_type, ''), 'ordinaria') not in ('ordinaria', 'urgente', 'programada') then
    raise exception 'Tipo de requisición inválido.' using errcode = '22023';
  end if;
  if p_area_id is not null and not exists (
    select 1 from abastecimiento.areas a
    where a.id = p_area_id and a.location_id = p_location_id and a.active
  ) then
    raise exception 'El área no pertenece a la sucursal seleccionada.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La requisición necesita al menos un producto.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('kadmiel.command_id', p_command_id::text, true);

  insert into abastecimiento.requisitions(
    location_id, area_id, requested_by, request_type, status, needed_by, notes
  ) values (
    p_location_id, p_area_id, auth.uid(),
    coalesce(nullif(p_request_type, ''), 'ordinaria'), 'pendiente',
    p_needed_by, nullif(trim(p_notes), '')
  ) returning id into v_requisition_id;

  insert into abastecimiento.requisition_items(
    requisition_id, product_id, quantity, unit, notes
  )
  select
    v_requisition_id,
    item.product_id,
    item.quantity,
    nullif(trim(item.unit), ''),
    nullif(trim(item.notes), '')
  from jsonb_to_recordset(p_items) as item(
    product_id uuid, quantity numeric, unit text, notes text
  )
  where item.product_id is not null
    and item.quantity > 0
    and exists (
      select 1 from public.inventory_locations il
      where il.inventory_id = item.product_id and il.location_id = p_location_id
    );

  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> jsonb_array_length(p_items) then
    raise exception 'Todas las partidas necesitan producto disponible para la sucursal y cantidad válida.' using errcode = '22023';
  end if;

  perform abastecimiento.finish_workflow_command(
    'create_requisition', p_command_id, jsonb_build_object('id', v_requisition_id)
  );
  return v_requisition_id;
end;
$function$;

create or replace function public.create_abastecimiento_requisition(
  p_location_id uuid,
  p_area_id uuid,
  p_request_type text,
  p_needed_by date,
  p_notes text,
  p_items jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $function$
  select public.create_abastecimiento_requisition_v2(
    p_location_id, p_area_id, p_request_type, p_needed_by, p_notes, p_items,
    gen_random_uuid()
  );
$function$;

create or replace function public.update_abastecimiento_requisition_v2(
  p_requisition_id uuid,
  p_location_id uuid,
  p_area_id uuid,
  p_request_type text,
  p_needed_by date,
  p_notes text,
  p_items jsonb,
  p_revision_note text,
  p_command_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_req abastecimiento.requisitions%rowtype;
  v_inserted_count integer;
begin
  v_claim := abastecimiento.claim_workflow_command(
    'update_requisition',
    p_command_id,
    jsonb_build_object(
      'requisition_id', p_requisition_id,
      'location_id', p_location_id,
      'area_id', p_area_id,
      'request_type', p_request_type,
      'needed_by', p_needed_by,
      'notes', p_notes,
      'items', p_items,
      'revision_note', p_revision_note,
      'expected_version', p_expected_version
    )
  );
  if (v_claim->>'replayed')::boolean then
    return public.get_abastecimiento_requisition((v_claim->'result'->>'id')::uuid);
  end if;

  select * into v_req
  from abastecimiento.requisitions
  where id = p_requisition_id
  for update;

  if not found then
    raise exception 'No se encontró la requisición.' using errcode = 'P0002';
  end if;
  if v_req.version is distinct from p_expected_version then
    raise exception 'La requisición cambió en otra sesión. Recarga antes de guardar.' using errcode = '40001';
  end if;
  if v_req.status <> 'pendiente' then
    raise exception 'Solo se puede editar una requisición pendiente.' using errcode = '42501';
  end if;
  if not (
    v_req.requested_by = auth.uid()
    or abastecimiento.has_workflow_permission('production', v_req.location_id)
  ) then
    raise exception 'No tienes permiso para editar esta requisición.' using errcode = '42501';
  end if;
  if p_location_id is null or not abastecimiento.can_access_location(p_location_id) then
    raise exception 'No tienes acceso a la sucursal seleccionada.' using errcode = '42501';
  end if;
  if p_request_type is null or p_request_type not in ('ordinaria', 'urgente', 'programada') then
    raise exception 'Tipo de requisición inválido.' using errcode = '22023';
  end if;
  if p_area_id is not null and not exists (
    select 1 from abastecimiento.areas a
    where a.id = p_area_id and a.location_id = p_location_id and a.active
  ) then
    raise exception 'El área no pertenece a la sucursal seleccionada.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La requisición necesita al menos un producto.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('kadmiel.command_id', p_command_id::text, true);
  update abastecimiento.requisitions
  set location_id = p_location_id,
      area_id = p_area_id,
      request_type = p_request_type,
      needed_by = p_needed_by,
      notes = nullif(trim(p_notes), ''),
      revision_note = nullif(trim(p_revision_note), '')
  where id = p_requisition_id;

  delete from abastecimiento.requisition_items where requisition_id = p_requisition_id;
  insert into abastecimiento.requisition_items(
    requisition_id, product_id, quantity, unit, notes, selected, revision_note
  )
  select
    p_requisition_id, item.product_id, item.quantity,
    nullif(trim(item.unit), ''), nullif(trim(item.notes), ''),
    coalesce(item.selected, true), nullif(trim(item.revision_note), '')
  from jsonb_to_recordset(p_items) as item(
    product_id uuid, quantity numeric, unit text, notes text,
    selected boolean, revision_note text
  )
  where item.product_id is not null
    and item.quantity > 0
    and exists (
      select 1 from public.inventory_locations il
      where il.inventory_id = item.product_id and il.location_id = p_location_id
    );

  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> jsonb_array_length(p_items) then
    raise exception 'Todas las partidas necesitan producto disponible para la sucursal y cantidad válida.' using errcode = '22023';
  end if;

  perform abastecimiento.finish_workflow_command(
    'update_requisition', p_command_id, jsonb_build_object('id', p_requisition_id)
  );
  return public.get_abastecimiento_requisition(p_requisition_id);
end;
$function$;

create or replace function public.update_abastecimiento_requisition(
  p_requisition_id uuid,
  p_location_id uuid,
  p_area_id uuid,
  p_request_type text,
  p_needed_by date,
  p_notes text,
  p_items jsonb,
  p_revision_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_version integer;
begin
  select version into v_version
  from abastecimiento.requisitions
  where id = p_requisition_id;
  if not found then
    raise exception 'No se encontró la requisición.' using errcode = 'P0002';
  end if;
  return public.update_abastecimiento_requisition_v2(
    p_requisition_id, p_location_id, p_area_id, p_request_type, p_needed_by,
    p_notes, p_items, p_revision_note, gen_random_uuid(), v_version
  );
end;
$function$;

create or replace function public.review_abastecimiento_requisition_items_v2(
  p_requisition_id uuid,
  p_items jsonb,
  p_command_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_req abastecimiento.requisitions%rowtype;
  v_item_count integer;
begin
  v_claim := abastecimiento.claim_workflow_command(
    'review_requisition_items',
    p_command_id,
    jsonb_build_object(
      'requisition_id', p_requisition_id,
      'items', p_items,
      'expected_version', p_expected_version
    )
  );
  if (v_claim->>'replayed')::boolean then
    return public.get_abastecimiento_requisition((v_claim->'result'->>'id')::uuid);
  end if;

  select * into v_req from abastecimiento.requisitions
  where id = p_requisition_id for update;
  if not found then
    raise exception 'No se encontró la requisición.' using errcode = 'P0002';
  end if;
  if v_req.version is distinct from p_expected_version then
    raise exception 'La requisición cambió en otra sesión. Recarga antes de guardar.' using errcode = '40001';
  end if;
  if v_req.status <> 'revisando_compras' then
    raise exception 'Las partidas solo se revisan durante la revisión de Compras.' using errcode = '42501';
  end if;
  if not abastecimiento.has_workflow_permission('purchasing', v_req.location_id) then
    raise exception 'Solo Compras puede revisar las partidas.' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'La revisión necesita partidas válidas.' using errcode = '22023';
  end if;

  select count(*) into v_item_count
  from abastecimiento.requisition_items where requisition_id = p_requisition_id;
  if jsonb_array_length(p_items) <> v_item_count
     or (select count(distinct x.item_id) from jsonb_to_recordset(p_items) as x(item_id uuid, selected boolean, revision_note text)) <> v_item_count
     or exists (
       select 1
       from jsonb_to_recordset(p_items) as x(item_id uuid, selected boolean, revision_note text)
       left join abastecimiento.requisition_items ri
         on ri.id = x.item_id and ri.requisition_id = p_requisition_id
       where ri.id is null
     ) then
    raise exception 'La revisión debe incluir cada partida exactamente una vez.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from jsonb_to_recordset(p_items) as x(item_id uuid, selected boolean, revision_note text)
    where coalesce(x.selected, false)
  ) then
    raise exception 'Debes conservar al menos una partida seleccionada.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('kadmiel.command_id', p_command_id::text, true);
  update abastecimiento.requisition_items ri
  set selected = coalesce(x.selected, false),
      revision_note = nullif(trim(x.revision_note), '')
  from jsonb_to_recordset(p_items) as x(item_id uuid, selected boolean, revision_note text)
  where ri.id = x.item_id and ri.requisition_id = p_requisition_id;

  update abastecimiento.requisitions set updated_at = now() where id = p_requisition_id;
  perform abastecimiento.finish_workflow_command(
    'review_requisition_items', p_command_id, jsonb_build_object('id', p_requisition_id)
  );
  return public.get_abastecimiento_requisition(p_requisition_id);
end;
$function$;

create or replace function abastecimiento.sync_purchase_order_for_requisition(p_requisition_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_req abastecimiento.requisitions%rowtype;
  v_purchase_order_id uuid;
  v_subtotal numeric;
begin
  select * into v_req from abastecimiento.requisitions
  where id = p_requisition_id for update;
  if not found then
    raise exception 'No se encontró la requisición.' using errcode = 'P0002';
  end if;
  if v_req.status <> 'aprobada_compras' then
    raise exception 'Solo las requisiciones aprobadas por Compras pasan a evaluación.' using errcode = '42501';
  end if;
  if not abastecimiento.has_workflow_permission('purchasing', v_req.location_id) then
    raise exception 'No tienes permiso para preparar esta compra.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from abastecimiento.requisition_items
    where requisition_id = p_requisition_id and selected
  ) then
    raise exception 'No se puede aprobar una requisición sin partidas seleccionadas.' using errcode = '22023';
  end if;

  select coalesce(sum(ri.quantity * coalesce(inv.total_price, inv.unit_price, 0)), 0)
  into v_subtotal
  from abastecimiento.requisition_items ri
  join public.inventory inv on inv.id = ri.product_id
  where ri.requisition_id = p_requisition_id and ri.selected;

  insert into abastecimiento.purchase_orders(
    requisition_id, location_id, status, ordered_by, ordered_at,
    subtotal, tax, notes
  ) values (
    p_requisition_id, v_req.location_id, 'revisando_gerencia', auth.uid(), now(),
    v_subtotal, 0, v_req.notes
  )
  on conflict (requisition_id) do update
  set location_id = excluded.location_id,
      status = 'revisando_gerencia',
      ordered_by = auth.uid(),
      ordered_at = now(),
      subtotal = excluded.subtotal,
      tax = 0,
      notes = excluded.notes,
      review_cycle = abastecimiento.purchase_orders.review_cycle + 1,
      accounting_approved_by = null,
      accounting_approved_at = null,
      management_approved_by = null,
      management_approved_at = null,
      rejected_by = null,
      rejected_at = null,
      rejected_reason = null,
      cancelled_by = null,
      cancelled_at = null,
      cancelled_reason = null
  returning id into v_purchase_order_id;

  delete from abastecimiento.purchase_order_items
  where purchase_order_id = v_purchase_order_id;
  insert into abastecimiento.purchase_order_items(
    purchase_order_id, requisition_item_id, product_id, quantity, unit, unit_cost
  )
  select
    v_purchase_order_id, ri.id, ri.product_id, ri.quantity,
    coalesce(ri.unit, inv.unit), coalesce(inv.total_price, inv.unit_price, 0)
  from abastecimiento.requisition_items ri
  join public.inventory inv on inv.id = ri.product_id
  where ri.requisition_id = p_requisition_id and ri.selected;

  return v_purchase_order_id;
end;
$function$;

create or replace function public.update_abastecimiento_requisition_status_v2(
  p_requisition_id uuid,
  p_status text,
  p_reason text,
  p_command_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_req abastecimiento.requisitions%rowtype;
begin
  v_claim := abastecimiento.claim_workflow_command(
    'set_requisition_status',
    p_command_id,
    jsonb_build_object(
      'requisition_id', p_requisition_id,
      'status', p_status,
      'reason', p_reason,
      'expected_version', p_expected_version
    )
  );
  if (v_claim->>'replayed')::boolean then
    return public.get_abastecimiento_requisition((v_claim->'result'->>'id')::uuid);
  end if;

  select * into v_req from abastecimiento.requisitions
  where id = p_requisition_id for update;
  if not found then
    raise exception 'No se encontró la requisición.' using errcode = 'P0002';
  end if;
  if v_req.version is distinct from p_expected_version then
    raise exception 'La requisición cambió en otra sesión. Recarga antes de continuar.' using errcode = '40001';
  end if;
  if not abastecimiento.has_workflow_permission('purchasing', v_req.location_id) then
    raise exception 'Solo Compras puede cambiar este estado.' using errcode = '42501';
  end if;
  if p_status not in ('revisando_compras', 'aprobada_compras', 'cancelada_compras') then
    raise exception 'Estado de requisición inválido.' using errcode = '22023';
  end if;
  if not (
    (v_req.status = 'pendiente' and p_status in ('revisando_compras', 'cancelada_compras'))
    or (v_req.status = 'revisando_compras' and p_status in ('aprobada_compras', 'cancelada_compras'))
  ) then
    raise exception 'Transición de requisición no permitida: % → %.', v_req.status, p_status using errcode = '22023';
  end if;
  if p_status = 'cancelada_compras' and nullif(trim(p_reason), '') is null then
    raise exception 'La cancelación requiere un motivo.' using errcode = '22023';
  end if;
  if p_status = 'aprobada_compras' and not exists (
    select 1 from abastecimiento.requisition_items
    where requisition_id = p_requisition_id and selected
  ) then
    raise exception 'No se puede aprobar una requisición sin partidas seleccionadas.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('kadmiel.command_id', p_command_id::text, true);
  update abastecimiento.requisitions
  set status = p_status,
      review_started_by = case when p_status = 'revisando_compras' then auth.uid() else review_started_by end,
      review_started_at = case when p_status = 'revisando_compras' then now() else review_started_at end,
      approved_by = case when p_status = 'aprobada_compras' then auth.uid() else null end,
      approved_at = case when p_status = 'aprobada_compras' then now() else null end,
      cancelled_by = case when p_status = 'cancelada_compras' then auth.uid() else null end,
      cancelled_at = case when p_status = 'cancelada_compras' then now() else null end,
      cancelled_reason = case when p_status = 'cancelada_compras' then trim(p_reason) else null end,
      rejected_reason = case when p_status = 'cancelada_compras' then trim(p_reason) else null end
  where id = p_requisition_id;

  if p_status = 'aprobada_compras' then
    perform abastecimiento.sync_purchase_order_for_requisition(p_requisition_id);
  end if;

  perform abastecimiento.finish_workflow_command(
    'set_requisition_status', p_command_id, jsonb_build_object('id', p_requisition_id)
  );
  return public.get_abastecimiento_requisition(p_requisition_id);
end;
$function$;

create or replace function public.update_abastecimiento_requisition_status(
  p_requisition_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_version integer;
  v_status text;
begin
  select version into v_version from abastecimiento.requisitions where id = p_requisition_id;
  if not found then
    raise exception 'No se encontró la requisición.' using errcode = 'P0002';
  end if;
  v_status := case p_status
    when 'revisada' then 'revisando_compras'
    when 'aprobada' then 'aprobada_compras'
    when 'cancelada' then 'cancelada_compras'
    else p_status
  end;
  return public.update_abastecimiento_requisition_status_v2(
    p_requisition_id, v_status,
    case when v_status = 'cancelada_compras' then 'Cancelada desde cliente legado' else null end,
    gen_random_uuid(), v_version
  );
end;
$function$;

create or replace function public.update_abastecimiento_purchase_order_v2(
  p_purchase_order_id uuid,
  p_items jsonb,
  p_notes text,
  p_command_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_order abastecimiento.purchase_orders%rowtype;
  v_item_count integer;
  v_subtotal numeric;
begin
  v_claim := abastecimiento.claim_workflow_command(
    'update_purchase_order',
    p_command_id,
    jsonb_build_object(
      'purchase_order_id', p_purchase_order_id,
      'items', p_items,
      'notes', p_notes,
      'expected_version', p_expected_version
    )
  );
  if (v_claim->>'replayed')::boolean then
    return public.get_abastecimiento_purchase_order((v_claim->'result'->>'id')::uuid);
  end if;

  select * into v_order from abastecimiento.purchase_orders
  where id = p_purchase_order_id for update;
  if not found then
    raise exception 'No se encontró la orden de compra.' using errcode = 'P0002';
  end if;
  if v_order.version is distinct from p_expected_version then
    raise exception 'La orden cambió en otra sesión. Recarga antes de guardar.' using errcode = '40001';
  end if;
  if v_order.status <> 'rechazado' then
    raise exception 'Solo se puede editar una orden rechazada.' using errcode = '42501';
  end if;
  if not abastecimiento.has_workflow_permission('purchasing', v_order.location_id) then
    raise exception 'Solo Compras puede editar una orden rechazada.' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'La orden necesita partidas válidas.' using errcode = '22023';
  end if;

  select count(*) into v_item_count
  from abastecimiento.purchase_order_items where purchase_order_id = p_purchase_order_id;
  if jsonb_array_length(p_items) <> v_item_count
     or (select count(distinct x.purchase_order_item_id)
         from jsonb_to_recordset(p_items) as x(purchase_order_item_id uuid, quantity numeric, unit_cost numeric)) <> v_item_count
     or exists (
       select 1
       from jsonb_to_recordset(p_items) as x(purchase_order_item_id uuid, quantity numeric, unit_cost numeric)
       left join abastecimiento.purchase_order_items poi
         on poi.id = x.purchase_order_item_id and poi.purchase_order_id = p_purchase_order_id
       where poi.id is null
          or x.quantity is null or x.quantity <= 0
          or x.unit_cost is null or x.unit_cost < 0
     ) then
    raise exception 'Incluye cada partida exactamente una vez, con cantidad positiva y costo no negativo.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('kadmiel.command_id', p_command_id::text, true);
  update abastecimiento.purchase_order_items poi
  set quantity = x.quantity, unit_cost = x.unit_cost
  from jsonb_to_recordset(p_items) as x(
    purchase_order_item_id uuid, quantity numeric, unit_cost numeric
  )
  where poi.id = x.purchase_order_item_id and poi.purchase_order_id = p_purchase_order_id;

  select coalesce(sum(quantity * unit_cost), 0) into v_subtotal
  from abastecimiento.purchase_order_items where purchase_order_id = p_purchase_order_id;
  update abastecimiento.purchase_orders
  set notes = nullif(trim(p_notes), ''),
      subtotal = v_subtotal
  where id = p_purchase_order_id;

  perform abastecimiento.finish_workflow_command(
    'update_purchase_order', p_command_id, jsonb_build_object('id', p_purchase_order_id)
  );
  return public.get_abastecimiento_purchase_order(p_purchase_order_id);
end;
$function$;

create or replace function public.update_abastecimiento_purchase_order_status_v2(
  p_purchase_order_id uuid,
  p_action text,
  p_reason text,
  p_command_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_order abastecimiento.purchase_orders%rowtype;
begin
  v_claim := abastecimiento.claim_workflow_command(
    'set_purchase_order_status',
    p_command_id,
    jsonb_build_object(
      'purchase_order_id', p_purchase_order_id,
      'action', p_action,
      'reason', p_reason,
      'expected_version', p_expected_version
    )
  );
  if (v_claim->>'replayed')::boolean then
    return public.get_abastecimiento_purchase_order((v_claim->'result'->>'id')::uuid);
  end if;

  select * into v_order from abastecimiento.purchase_orders
  where id = p_purchase_order_id for update;
  if not found then
    raise exception 'No se encontró la orden de compra.' using errcode = 'P0002';
  end if;
  if v_order.version is distinct from p_expected_version then
    raise exception 'La orden cambió en otra sesión. Recarga antes de continuar.' using errcode = '40001';
  end if;
  if p_action not in ('aprobar_contabilidad', 'aprobar_gerencia', 'rechazar', 'reenviar', 'cancelar') then
    raise exception 'Acción de compra inválida.' using errcode = '22023';
  end if;
  if p_action in ('rechazar', 'cancelar') and nullif(trim(p_reason), '') is null then
    raise exception 'La acción requiere un motivo.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('kadmiel.command_id', p_command_id::text, true);

  case p_action
    when 'aprobar_contabilidad' then
      if v_order.status <> 'revisando_gerencia' or v_order.accounting_approved_at is not null then
        raise exception 'La aprobación de Contabilidad no corresponde al estado actual.' using errcode = '22023';
      end if;
      if not abastecimiento.has_workflow_permission('accounting', v_order.location_id) then
        raise exception 'Solo Contabilidad puede registrar esta aprobación.' using errcode = '42501';
      end if;
      update abastecimiento.purchase_orders
      set accounting_approved_by = auth.uid(), accounting_approved_at = now()
      where id = p_purchase_order_id;

    when 'aprobar_gerencia' then
      if v_order.status <> 'revisando_gerencia'
         or v_order.accounting_approved_at is null
         or v_order.management_approved_at is not null then
        raise exception 'Gerencia solo puede aprobar después de Contabilidad.' using errcode = '22023';
      end if;
      if not abastecimiento.has_workflow_permission('management', v_order.location_id) then
        raise exception 'Solo Gerencia puede registrar esta aprobación.' using errcode = '42501';
      end if;
      if v_order.accounting_approved_by = auth.uid() then
        raise exception 'Contabilidad y Gerencia deben aprobar con cuentas distintas.' using errcode = '42501';
      end if;
      update abastecimiento.purchase_orders
      set management_approved_by = auth.uid(),
          management_approved_at = now(),
          approved_by = auth.uid(),
          approved_at = now(),
          status = 'aprobado'
      where id = p_purchase_order_id;

    when 'rechazar' then
      if v_order.status <> 'revisando_gerencia' then
        raise exception 'Solo se puede rechazar una orden en revisión.' using errcode = '22023';
      end if;
      if not (
        abastecimiento.has_workflow_permission('accounting', v_order.location_id)
        or abastecimiento.has_workflow_permission('management', v_order.location_id)
      ) then
        raise exception 'Solo Contabilidad o Gerencia puede rechazar la compra.' using errcode = '42501';
      end if;
      update abastecimiento.purchase_orders
      set status = 'rechazado', rejected_by = auth.uid(), rejected_at = now(),
          rejected_reason = trim(p_reason), approved_by = null, approved_at = null
      where id = p_purchase_order_id;

    when 'reenviar' then
      if v_order.status <> 'rechazado' then
        raise exception 'Solo se puede reenviar una orden rechazada.' using errcode = '22023';
      end if;
      if not abastecimiento.has_workflow_permission('purchasing', v_order.location_id) then
        raise exception 'Solo Compras puede reenviar la orden.' using errcode = '42501';
      end if;
      update abastecimiento.purchase_orders
      set status = 'revisando_gerencia',
          review_cycle = review_cycle + 1,
          accounting_approved_by = null,
          accounting_approved_at = null,
          management_approved_by = null,
          management_approved_at = null,
          rejected_by = null,
          rejected_at = null,
          rejected_reason = null,
          approved_by = null,
          approved_at = null
      where id = p_purchase_order_id;

    when 'cancelar' then
      if v_order.status not in ('revisando_gerencia', 'rechazado') then
        raise exception 'La orden ya no puede cancelarse en este punto.' using errcode = '22023';
      end if;
      if not abastecimiento.has_workflow_permission('purchasing', v_order.location_id) then
        raise exception 'Solo Compras puede cancelar la orden.' using errcode = '42501';
      end if;
      update abastecimiento.purchase_orders
      set status = 'cancelado', cancelled_by = auth.uid(), cancelled_at = now(),
          cancelled_reason = trim(p_reason), approved_by = null, approved_at = null
      where id = p_purchase_order_id;

      update abastecimiento.requisitions
      set status = 'cancelada_compras', cancelled_by = auth.uid(), cancelled_at = now(),
          cancelled_reason = trim(p_reason)
      where id = v_order.requisition_id;
  end case;

  perform abastecimiento.finish_workflow_command(
    'set_purchase_order_status', p_command_id, jsonb_build_object('id', p_purchase_order_id)
  );
  return public.get_abastecimiento_purchase_order(p_purchase_order_id);
end;
$function$;

create or replace function public.update_abastecimiento_purchase_order_status(
  p_purchase_order_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order abastecimiento.purchase_orders%rowtype;
  v_action text;
begin
  select * into v_order from abastecimiento.purchase_orders
  where id = p_purchase_order_id;
  if not found then
    raise exception 'No se encontró la orden de compra.' using errcode = 'P0002';
  end if;

  v_action := case
    when p_status = 'aprobado' and v_order.accounting_approved_at is null then 'aprobar_contabilidad'
    when p_status = 'aprobado' then 'aprobar_gerencia'
    when p_status = 'cancelado' then 'cancelar'
    when p_status in ('pendiente', 'urgente') and v_order.status = 'rechazado' then 'reenviar'
    else null
  end;
  if v_action is null then
    raise exception 'El cliente legado no puede ejecutar esa transición.' using errcode = '22023';
  end if;

  return public.update_abastecimiento_purchase_order_status_v2(
    p_purchase_order_id, v_action,
    case when v_action = 'cancelar' then 'Cancelada desde cliente legado' else null end,
    gen_random_uuid(), v_order.version
  );
end;
$function$;

create or replace function public.save_abastecimiento_receipt_v2(
  p_purchase_order_id uuid,
  p_status text,
  p_items jsonb,
  p_notes text,
  p_command_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_order abastecimiento.purchase_orders%rowtype;
  v_receipt abastecimiento.receipts%rowtype;
  v_receipt_id uuid;
  v_item_count integer;
  v_has_differences boolean;
begin
  v_claim := abastecimiento.claim_workflow_command(
    'save_receipt',
    p_command_id,
    jsonb_build_object(
      'purchase_order_id', p_purchase_order_id,
      'status', p_status,
      'items', p_items,
      'notes', p_notes,
      'expected_version', p_expected_version
    )
  );
  if (v_claim->>'replayed')::boolean then
    return public.get_abastecimiento_receiving_order((v_claim->'result'->>'purchase_order_id')::uuid);
  end if;

  select * into v_order from abastecimiento.purchase_orders
  where id = p_purchase_order_id for update;
  if not found then
    raise exception 'No se encontró la orden de compra.' using errcode = 'P0002';
  end if;
  if v_order.status not in ('aprobado', 'completado') then
    raise exception 'Solo se puede recibir una orden aprobada.' using errcode = '42501';
  end if;
  if not abastecimiento.has_workflow_permission('receiving', v_order.location_id) then
    raise exception 'No tienes permiso para registrar la recepción.' using errcode = '42501';
  end if;
  if p_status not in ('recibida', 'en_almacen') then
    raise exception 'Selecciona Recibida para iniciar la recepción.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'La recepción necesita partidas válidas.' using errcode = '22023';
  end if;

  select * into v_receipt from abastecimiento.receipts
  where purchase_order_id = p_purchase_order_id for update;

  if found then
    if v_receipt.version is distinct from p_expected_version then
      raise exception 'La recepción cambió en otra sesión. Recarga antes de guardar.' using errcode = '40001';
    end if;
    if v_receipt.status = 'en_almacen' then
      raise exception 'La recepción en almacén está cerrada.' using errcode = '42501';
    end if;
    if not (
      (v_receipt.status = 'pendiente' and p_status = 'recibida')
      or (v_receipt.status = 'recibida' and p_status in ('recibida', 'en_almacen'))
    ) then
      raise exception 'Transición de recepción no permitida: % → %.', v_receipt.status, p_status using errcode = '22023';
    end if;
  else
    if p_expected_version is distinct from 0 then
      raise exception 'La recepción cambió en otra sesión. Recarga antes de guardar.' using errcode = '40001';
    end if;
    if p_status <> 'recibida' then
      raise exception 'La mercancía debe marcarse como recibida antes de enviarla a almacén.' using errcode = '22023';
    end if;
  end if;

  select count(*) into v_item_count
  from abastecimiento.purchase_order_items where purchase_order_id = p_purchase_order_id;
  if v_item_count = 0
     or jsonb_array_length(p_items) <> v_item_count
     or (select count(distinct x.purchase_order_item_id)
         from jsonb_to_recordset(p_items) as x(purchase_order_item_id uuid, received_quantity numeric, lot_code text, expires_at date)) <> v_item_count
     or exists (
       select 1
       from jsonb_to_recordset(p_items) as x(purchase_order_item_id uuid, received_quantity numeric, lot_code text, expires_at date)
       left join abastecimiento.purchase_order_items poi
         on poi.id = x.purchase_order_item_id and poi.purchase_order_id = p_purchase_order_id
       where poi.id is null or x.received_quantity is null or x.received_quantity < 0
     ) then
    raise exception 'Incluye cada partida exactamente una vez y sin cantidades negativas.' using errcode = '22023';
  end if;

  if p_status = 'en_almacen' and exists (
    select 1
    from jsonb_to_recordset(p_items) as x(
      purchase_order_item_id uuid, received_quantity numeric, lot_code text, expires_at date
    )
    join abastecimiento.purchase_order_items poi on poi.id = x.purchase_order_item_id
    join public.inventory inv on inv.id = poi.product_id
    where poi.purchase_order_id = p_purchase_order_id
      and x.received_quantity > 0
      and (inv.base_unit is null or inv.base_quantity_per_presentation is null)
  ) then
    raise exception 'Normaliza todas las presentaciones antes de enviar la recepción a almacén.' using errcode = '22023';
  end if;
  if p_status = 'en_almacen' and not exists (
    select 1
    from jsonb_to_recordset(p_items) as x(received_quantity numeric)
    where x.received_quantity is not null and x.received_quantity > 0
  ) then
    raise exception 'No puedes cerrar la recepción sin mercancía recibida.' using errcode = '22023';
  end if;

  select exists (
    select 1
    from jsonb_to_recordset(p_items) as x(
      purchase_order_item_id uuid, received_quantity numeric, lot_code text, expires_at date
    )
    join abastecimiento.purchase_order_items poi on poi.id = x.purchase_order_item_id
    where poi.purchase_order_id = p_purchase_order_id
      and x.received_quantity <> poi.quantity
  ) into v_has_differences;

  perform pg_catalog.set_config('kadmiel.command_id', p_command_id::text, true);
  if v_receipt.id is null then
    insert into abastecimiento.receipts(
      purchase_order_id, supplier_id, location_id, received_by, received_at,
      status, has_differences, notes, stored_at
    ) values (
      p_purchase_order_id, v_order.supplier_id, v_order.location_id, auth.uid(), now(),
      p_status, v_has_differences, nullif(trim(p_notes), ''), null
    ) returning id into v_receipt_id;
  else
    update abastecimiento.receipts
    set status = case when p_status = 'en_almacen' then status else p_status end,
        received_by = auth.uid(),
        received_at = case when status = 'pendiente' then now() else received_at end,
        has_differences = v_has_differences,
        notes = nullif(trim(p_notes), '')
    where id = v_receipt.id
    returning id into v_receipt_id;
  end if;

  insert into abastecimiento.receipt_items(
    receipt_id, purchase_order_item_id, product_id, requested_quantity,
    received_quantity, unit, lot_code, expires_at, unit_cost
  )
  select
    v_receipt_id, poi.id, poi.product_id, poi.quantity, x.received_quantity,
    poi.unit, nullif(trim(x.lot_code), ''), x.expires_at, poi.unit_cost
  from jsonb_to_recordset(p_items) as x(
    purchase_order_item_id uuid, received_quantity numeric, lot_code text, expires_at date
  )
  join abastecimiento.purchase_order_items poi on poi.id = x.purchase_order_item_id
  where poi.purchase_order_id = p_purchase_order_id
  on conflict (purchase_order_item_id) do update
  set receipt_id = excluded.receipt_id,
      product_id = excluded.product_id,
      requested_quantity = excluded.requested_quantity,
      received_quantity = excluded.received_quantity,
      unit = excluded.unit,
      lot_code = excluded.lot_code,
      expires_at = excluded.expires_at,
      unit_cost = excluded.unit_cost;

  if v_receipt.id is not null and p_status = 'en_almacen' then
    update abastecimiento.receipts
    set status = 'en_almacen', stored_at = coalesce(stored_at, now())
    where id = v_receipt_id;

    update abastecimiento.purchase_orders
    set status = 'completado'
    where id = p_purchase_order_id and status = 'aprobado';

    update abastecimiento.requisitions
    set status = 'completado'
    where id = v_order.requisition_id and status = 'aprobada_compras';
  end if;

  perform abastecimiento.finish_workflow_command(
    'save_receipt', p_command_id, jsonb_build_object('purchase_order_id', p_purchase_order_id)
  );
  return public.get_abastecimiento_receiving_order(p_purchase_order_id);
end;
$function$;

create or replace function public.save_abastecimiento_receipt(
  p_purchase_order_id uuid,
  p_status text,
  p_items jsonb,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_version integer;
begin
  select version into v_version
  from abastecimiento.receipts where purchase_order_id = p_purchase_order_id;
  return public.save_abastecimiento_receipt_v2(
    p_purchase_order_id, p_status, p_items, p_notes,
    gen_random_uuid(), coalesce(v_version, 0)
  );
end;
$function$;

create or replace function public.list_abastecimiento_receiving_orders(
  p_date_from date default null,
  p_date_to date default null
)
returns table(
  receipt_id uuid,
  receipt_folio text,
  purchase_order_id uuid,
  purchase_folio text,
  requisition_id uuid,
  requisition_folio text,
  location_id uuid,
  location_name text,
  requested_by_name text,
  completed_at timestamptz,
  received_at timestamptz,
  status text,
  items_count bigint,
  differences_count bigint,
  total_ordered numeric,
  total_received numeric
)
language sql
stable
set search_path = ''
as $function$
  select
    rec.id,
    rec.folio,
    po.id,
    po.folio,
    r.id,
    r.folio,
    po.location_id,
    l.name::text,
    coalesce(nullif(trim(requester.full_name), ''), nullif(trim(requester.email), ''), r.requested_by::text),
    coalesce(po.approved_at, po.updated_at, po.ordered_at),
    rec.received_at,
    coalesce(rec.status, 'pendiente'),
    coalesce(totals.items_count, 0),
    coalesce(totals.differences_count, 0),
    coalesce(totals.total_ordered, 0),
    coalesce(totals.total_received, 0)
  from abastecimiento.purchase_orders po
  join abastecimiento.requisitions r on r.id = po.requisition_id
  join public.locations l on l.id = po.location_id
  left join public.profiles requester on requester.id = r.requested_by
  left join abastecimiento.receipts rec on rec.purchase_order_id = po.id
  left join lateral (
    select
      count(poi.id) as items_count,
      count(poi.id) filter (
        where rec.id is not null and coalesce(rit.received_quantity, 0) <> poi.quantity
      ) as differences_count,
      coalesce(sum(poi.quantity), 0)::numeric as total_ordered,
      coalesce(sum(rit.received_quantity), 0)::numeric as total_received
    from abastecimiento.purchase_order_items poi
    left join abastecimiento.receipt_items rit on rit.purchase_order_item_id = poi.id
    where poi.purchase_order_id = po.id
  ) totals on true
  where r.status in ('aprobada_compras', 'completado', 'completada')
    and po.status in ('aprobado', 'completado')
    and abastecimiento.can_access_location(po.location_id)
    and (p_date_from is null or coalesce(rec.received_at, po.approved_at, po.updated_at)::date >= p_date_from)
    and (p_date_to is null or coalesce(rec.received_at, po.approved_at, po.updated_at)::date <= p_date_to)
  order by coalesce(rec.received_at, po.approved_at, po.updated_at) desc;
$function$;

create or replace function public.get_abastecimiento_receiving_order(p_purchase_order_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para ver la recepción.' using errcode = '28000';
  end if;

  select jsonb_build_object(
    'receipt_id', rec.id,
    'receipt_folio', rec.folio,
    'purchase_order_id', po.id,
    'purchase_folio', po.folio,
    'requisition_id', r.id,
    'requisition_folio', r.folio,
    'location_id', po.location_id,
    'location_name', l.name,
    'area_name', a.name,
    'requested_by_name', coalesce(nullif(trim(requester.full_name), ''), nullif(trim(requester.email), ''), r.requested_by::text),
    'completed_at', coalesce(po.approved_at, po.updated_at, po.ordered_at),
    'received_at', rec.received_at,
    'stored_at', rec.stored_at,
    'status', coalesce(rec.status, 'pendiente'),
    'version', coalesce(rec.version, 0),
    'notes', rec.notes,
    'items_count', count(poi.id),
    'differences_count', count(poi.id) filter (
      where rec.id is not null and coalesce(rit.received_quantity, 0) <> poi.quantity
    ),
    'total_ordered', coalesce(sum(poi.quantity), 0),
    'total_received', coalesce(sum(rit.received_quantity), 0),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'receipt_item_id', item_rec.id,
        'purchase_order_item_id', item_po.id,
        'product_id', item_po.product_id,
        'product', inv.product,
        'brand', inv.brand,
        'presentation', inv.presentation,
        'image_url', inv.image_url,
        'unit', coalesce(item_po.unit, inv.unit),
        'requisition_quantity', coalesce(item_req.quantity, 0),
        'purchased_quantity', item_po.quantity,
        'received_quantity', coalesce(item_rec.received_quantity, 0),
        'quantity_difference', coalesce(item_rec.received_quantity, 0) - item_po.quantity,
        'lot_code', item_rec.lot_code,
        'expires_at', item_rec.expires_at,
        'unit_cost', item_po.unit_cost,
        'almacen', inv.almacen,
        'warehouse_id', inv.warehouse_id,
        'warehouse_name', wh.name,
        'warehouse_address', wh.address,
        'rack_id', inv.rack_id,
        'rack_name', rack.name,
        'rack_position', rack.position,
        'storage_type', rack.storage_type,
        'category_id', inv.category_id,
        'category_name', cat.name,
        'delicate_management', coalesce(inv.delicate_management, false),
        'product_note', inv.note,
        'description', inv.description
      ) order by item_po.created_at, item_po.id)
      from abastecimiento.purchase_order_items item_po
      left join abastecimiento.requisition_items item_req on item_req.id = item_po.requisition_item_id
      left join abastecimiento.receipt_items item_rec on item_rec.purchase_order_item_id = item_po.id
      join public.inventory inv on inv.id = item_po.product_id
      left join public.inventory_warehouses wh on wh.id = inv.warehouse_id
      left join public.inventory_racks rack on rack.id = inv.rack_id
      left join public.inventory_categories cat on cat.id = inv.category_id
      where item_po.purchase_order_id = po.id
    ), '[]'::jsonb)
  ) into v_result
  from abastecimiento.purchase_orders po
  join abastecimiento.requisitions r on r.id = po.requisition_id
  join public.locations l on l.id = po.location_id
  left join abastecimiento.areas a on a.id = r.area_id
  left join public.profiles requester on requester.id = r.requested_by
  left join abastecimiento.receipts rec on rec.purchase_order_id = po.id
  left join abastecimiento.purchase_order_items poi on poi.purchase_order_id = po.id
  left join abastecimiento.receipt_items rit on rit.purchase_order_item_id = poi.id
  where po.id = p_purchase_order_id
    and r.status in ('aprobada_compras', 'completado', 'completada')
    and po.status in ('aprobado', 'completado')
    and abastecimiento.can_access_location(po.location_id)
  group by po.id, r.id, l.name, a.name, requester.full_name, requester.email, rec.id;

  if v_result is null then
    raise exception 'No se encontró la recepción o no tienes acceso.' using errcode = '42501';
  end if;
  return v_result;
end;
$function$;

create or replace function public.get_abastecimiento_requisition(p_requisition_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para ver la requisición.' using errcode = '28000';
  end if;

  select jsonb_build_object(
    'id', r.id,
    'folio', r.folio,
    'location_id', r.location_id,
    'location_name', l.name,
    'area_id', r.area_id,
    'area_name', a.name,
    'request_type', r.request_type,
    'status', r.status,
    'needed_by', r.needed_by,
    'notes', r.notes,
    'revision_note', r.revision_note,
    'requested_by', r.requested_by,
    'requested_by_name', coalesce(nullif(trim(requester.full_name), ''), nullif(trim(requester.email), ''), r.requested_by::text),
    'approved_by', r.approved_by,
    'approved_by_name', coalesce(nullif(trim(approver.full_name), ''), nullif(trim(approver.email), ''), r.approved_by::text),
    'approved_at', r.approved_at,
    'review_started_by', r.review_started_by,
    'review_started_at', r.review_started_at,
    'cancelled_by', r.cancelled_by,
    'cancelled_at', r.cancelled_at,
    'cancelled_reason', r.cancelled_reason,
    'version', r.version,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'items_count', count(ri.id),
    'estimated_total', coalesce(sum(
      case when ri.selected then ri.quantity * coalesce(inv_total.total_price, inv_total.unit_price, 0) else 0 end
    ), 0),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'product_id', item.product_id,
        'product', inv.product,
        'brand', inv.brand,
        'presentation', inv.presentation,
        'image_url', inv.image_url,
        'quantity', item.quantity,
        'unit', coalesce(item.unit, inv.unit),
        'notes', item.notes,
        'selected', item.selected,
        'revision_note', item.revision_note,
        'unit_price', inv.unit_price,
        'total_price', inv.total_price,
        'line_total', item.quantity * coalesce(inv.total_price, inv.unit_price, 0),
        'almacen', inv.almacen
      ) order by item.created_at, item.id)
      from abastecimiento.requisition_items item
      join public.inventory inv on inv.id = item.product_id
      where item.requisition_id = r.id
    ), '[]'::jsonb)
  ) into v_result
  from abastecimiento.requisitions r
  join public.locations l on l.id = r.location_id
  left join abastecimiento.areas a on a.id = r.area_id
  left join public.profiles requester on requester.id = r.requested_by
  left join public.profiles approver on approver.id = r.approved_by
  left join abastecimiento.requisition_items ri on ri.requisition_id = r.id
  left join public.inventory inv_total on inv_total.id = ri.product_id
  where r.id = p_requisition_id
    and (r.requested_by = auth.uid() or abastecimiento.can_access_location(r.location_id))
  group by r.id, l.name, a.name, requester.full_name, requester.email, approver.full_name, approver.email;

  if v_result is null then
    raise exception 'No se encontró la requisición o no tienes acceso.' using errcode = '42501';
  end if;
  return v_result;
end;
$function$;

create or replace function public.get_abastecimiento_purchase_order(p_purchase_order_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para ver la orden de compra.' using errcode = '28000';
  end if;

  select jsonb_build_object(
    'id', po.id,
    'folio', po.folio,
    'status', po.status,
    'requisition_id', r.id,
    'requisition_folio', r.folio,
    'location_id', po.location_id,
    'location_name', l.name,
    'area_id', r.area_id,
    'area_name', a.name,
    'request_type', r.request_type,
    'requisition_status', r.status,
    'needed_by', r.needed_by,
    'notes', po.notes,
    'requested_by', r.requested_by,
    'requested_by_name', coalesce(nullif(trim(requester.full_name), ''), nullif(trim(requester.email), ''), r.requested_by::text),
    'approved_by', po.approved_by,
    'approved_by_name', coalesce(nullif(trim(approver.full_name), ''), nullif(trim(approver.email), ''), po.approved_by::text),
    'approved_at', po.approved_at,
    'requisition_approved_at', r.approved_at,
    'version', po.version,
    'review_cycle', po.review_cycle,
    'accounting_approved_by', po.accounting_approved_by,
    'accounting_approved_by_name', coalesce(nullif(trim(accounting.full_name), ''), nullif(trim(accounting.email), ''), po.accounting_approved_by::text),
    'accounting_approved_at', po.accounting_approved_at,
    'management_approved_by', po.management_approved_by,
    'management_approved_by_name', coalesce(nullif(trim(management.full_name), ''), nullif(trim(management.email), ''), po.management_approved_by::text),
    'management_approved_at', po.management_approved_at,
    'rejected_reason', po.rejected_reason,
    'cancelled_reason', po.cancelled_reason,
    'created_at', po.ordered_at,
    'updated_at', po.updated_at,
    'items_count', count(poi_count.id),
    'estimated_total', coalesce(sum(poi_count.quantity * poi_count.unit_cost), po.subtotal, 0),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', poi.id,
        'requisition_item_id', poi.requisition_item_id,
        'product_id', poi.product_id,
        'product', inv.product,
        'brand', inv.brand,
        'presentation', inv.presentation,
        'image_url', inv.image_url,
        'quantity', poi.quantity,
        'unit', coalesce(poi.unit, inv.unit),
        'notes', ri.notes,
        'selected', true,
        'revision_note', ri.revision_note,
        'unit_price', poi.unit_cost,
        'unit_cost', poi.unit_cost,
        'total_price', poi.unit_cost,
        'line_total', poi.quantity * poi.unit_cost,
        'almacen', inv.almacen,
        'supplier_name', sup.name
      ) order by poi.created_at, poi.id)
      from abastecimiento.purchase_order_items poi
      left join abastecimiento.requisition_items ri on ri.id = poi.requisition_item_id
      join public.inventory inv on inv.id = poi.product_id
      left join public.suppliers sup on sup.id = inv.supplier_id
      where poi.purchase_order_id = po.id
    ), '[]'::jsonb)
  ) into v_result
  from abastecimiento.purchase_orders po
  join abastecimiento.requisitions r on r.id = po.requisition_id
  join public.locations l on l.id = po.location_id
  left join abastecimiento.areas a on a.id = r.area_id
  left join public.profiles requester on requester.id = r.requested_by
  left join public.profiles approver on approver.id = po.approved_by
  left join public.profiles accounting on accounting.id = po.accounting_approved_by
  left join public.profiles management on management.id = po.management_approved_by
  left join abastecimiento.purchase_order_items poi_count on poi_count.purchase_order_id = po.id
  where po.id = p_purchase_order_id and abastecimiento.can_access_location(po.location_id)
  group by po.id, r.id, l.name, a.name,
    requester.full_name, requester.email, approver.full_name, approver.email,
    accounting.full_name, accounting.email, management.full_name, management.email;

  if v_result is null then
    raise exception 'No se encontró la orden de compra o no tienes acceso.' using errcode = '42501';
  end if;
  return v_result;
end;
$function$;

create or replace function public.list_abastecimiento_purchase_orders_v2()
returns table(
  id uuid,
  folio text,
  requisition_id uuid,
  requisition_folio text,
  location_id uuid,
  location_name text,
  request_type text,
  requisition_status text,
  status text,
  needed_by date,
  notes text,
  requested_by uuid,
  requested_by_name text,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  created_at timestamptz,
  items_count bigint,
  estimated_total numeric,
  version integer,
  review_cycle integer,
  accounting_approved_by uuid,
  accounting_approved_by_name text,
  accounting_approved_at timestamptz,
  management_approved_by uuid,
  management_approved_by_name text,
  management_approved_at timestamptz,
  rejected_reason text,
  cancelled_reason text
)
language sql
stable
set search_path = ''
as $function$
  with totals as (
    select purchase_order_id, count(*) as items_count,
      coalesce(sum(quantity * unit_cost), 0)::numeric as estimated_total
    from abastecimiento.purchase_order_items
    group by purchase_order_id
  )
  select
    po.id,
    po.folio,
    po.requisition_id,
    r.folio,
    po.location_id,
    l.name::text,
    r.request_type,
    r.status,
    po.status,
    r.needed_by,
    po.notes,
    r.requested_by,
    coalesce(nullif(trim(requester.full_name), ''), nullif(trim(requester.email), ''), r.requested_by::text),
    po.approved_by,
    coalesce(nullif(trim(approver.full_name), ''), nullif(trim(approver.email), ''), po.approved_by::text),
    po.approved_at,
    po.ordered_at,
    coalesce(totals.items_count, 0),
    coalesce(totals.estimated_total, po.subtotal, 0),
    po.version,
    po.review_cycle,
    po.accounting_approved_by,
    coalesce(nullif(trim(accounting.full_name), ''), nullif(trim(accounting.email), ''), po.accounting_approved_by::text),
    po.accounting_approved_at,
    po.management_approved_by,
    coalesce(nullif(trim(management.full_name), ''), nullif(trim(management.email), ''), po.management_approved_by::text),
    po.management_approved_at,
    po.rejected_reason,
    po.cancelled_reason
  from abastecimiento.purchase_orders po
  join abastecimiento.requisitions r on r.id = po.requisition_id
  join public.locations l on l.id = po.location_id
  left join public.profiles requester on requester.id = r.requested_by
  left join public.profiles approver on approver.id = po.approved_by
  left join public.profiles accounting on accounting.id = po.accounting_approved_by
  left join public.profiles management on management.id = po.management_approved_by
  left join totals on totals.purchase_order_id = po.id
  where (
      r.status in ('aprobada_compras', 'completado', 'completada')
      or (r.status = 'cancelada_compras' and po.status = 'cancelado')
    )
    and abastecimiento.can_access_location(po.location_id)
  order by
    case po.status
      when 'revisando_gerencia' then 0
      when 'rechazado' then 1
      when 'aprobado' then 2
      when 'cancelado' then 3
      else 4
    end,
    po.ordered_at desc;
$function$;

create or replace function public.list_abastecimiento_purchase_orders()
returns table(
  id uuid,
  folio text,
  requisition_id uuid,
  requisition_folio text,
  location_id uuid,
  location_name text,
  request_type text,
  requisition_status text,
  status text,
  needed_by date,
  notes text,
  requested_by uuid,
  requested_by_name text,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  created_at timestamptz,
  items_count bigint,
  estimated_total numeric
)
language sql
stable
set search_path = ''
as $function$
  select
    po.id, po.folio, po.requisition_id, po.requisition_folio,
    po.location_id, po.location_name, po.request_type, po.requisition_status,
    po.status, po.needed_by, po.notes, po.requested_by, po.requested_by_name,
    po.approved_by, po.approved_by_name, po.approved_at, po.created_at,
    po.items_count, po.estimated_total
  from public.list_abastecimiento_purchase_orders_v2() po;
$function$;

create or replace function public.list_abastecimiento_requisitions_v2()
returns table(
  id uuid,
  folio text,
  location_id uuid,
  location_name text,
  area_id uuid,
  area_name text,
  request_type text,
  status text,
  needed_by date,
  notes text,
  requested_by uuid,
  requested_by_name text,
  created_at timestamptz,
  items_count bigint,
  estimated_total numeric,
  version integer
)
language sql
stable
set search_path = ''
as $function$
  select legacy.*, r.version
  from public.list_abastecimiento_requisitions() legacy
  join abastecimiento.requisitions r on r.id = legacy.id;
$function$;

create or replace function public.list_abastecimiento_receiving_orders_v2(
  p_date_from date default null,
  p_date_to date default null
)
returns table(
  receipt_id uuid,
  receipt_folio text,
  purchase_order_id uuid,
  purchase_folio text,
  requisition_id uuid,
  requisition_folio text,
  location_id uuid,
  location_name text,
  requested_by_name text,
  completed_at timestamptz,
  received_at timestamptz,
  status text,
  items_count bigint,
  differences_count bigint,
  total_ordered numeric,
  total_received numeric,
  version integer
)
language sql
stable
set search_path = ''
as $function$
  select legacy.*, coalesce(rec.version, 0)
  from public.list_abastecimiento_receiving_orders(p_date_from, p_date_to) legacy
  left join abastecimiento.receipts rec on rec.id = legacy.receipt_id;
$function$;

create or replace function public.list_abastecimiento_transfers_v2()
returns table(
  folio text,
  origen text,
  destino text,
  insumo text,
  cantidad text,
  estado text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    transfer.folio,
    origin.name::text,
    destination.name::text,
    inventory.product::text,
    concat_ws(' ', item.quantity::text, nullif(trim(item.unit), '')),
    transfer.status
  from abastecimiento.transfers transfer
  join abastecimiento.transfer_items item on item.transfer_id = transfer.id
  join public.locations origin on origin.id = transfer.origin_location_id
  join public.locations destination on destination.id = transfer.destination_location_id
  join public.inventory inventory on inventory.id = item.product_id
  where abastecimiento.can_access_location(transfer.origin_location_id)
     or abastecimiento.can_access_location(transfer.destination_location_id)
  order by transfer.created_at desc, item.created_at, item.id;
$function$;

create or replace function public.list_abastecimiento_waste_entries_v2()
returns table(
  folio text,
  sucursal text,
  insumo text,
  cantidad text,
  tipo text,
  valor numeric
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    ('MRM-' || upper(left(replace(waste.id::text, '-', ''), 8)))::text,
    location.name::text,
    inventory.product::text,
    concat_ws(' ', waste.quantity::text, nullif(trim(waste.unit), '')),
    waste.waste_type,
    coalesce(waste.total_cost, waste.quantity * waste.unit_cost, 0)::numeric
  from abastecimiento.waste_entries waste
  join public.locations location on location.id = waste.location_id
  join public.inventory inventory on inventory.id = waste.product_id
  where abastecimiento.can_access_location(waste.location_id)
  order by waste.registered_at desc, waste.id;
$function$;

revoke all on function public.list_abastecimiento_transfers_v2() from public, anon;
revoke all on function public.list_abastecimiento_waste_entries_v2() from public, anon;
grant execute on function public.list_abastecimiento_transfers_v2() to authenticated;
grant execute on function public.list_abastecimiento_waste_entries_v2() to authenticated;

-- Client sessions may read state, but all workflow mutations must pass through
-- the validated RPCs above. SECURITY DEFINER implementations still re-check
-- actor, location, state and version explicitly.
drop policy if exists requisitions_delete_admin on abastecimiento.requisitions;
drop policy if exists requisitions_insert_own_location on abastecimiento.requisitions;
drop policy if exists requisitions_update_related on abastecimiento.requisitions;
drop policy if exists requisition_items_delete_pending_or_admin on abastecimiento.requisition_items;
drop policy if exists requisition_items_insert_parent on abastecimiento.requisition_items;
drop policy if exists requisition_items_update_parent on abastecimiento.requisition_items;
drop policy if exists purchase_orders_manage_by_purchasing on abastecimiento.purchase_orders;
drop policy if exists purchase_order_items_manage_purchase_parent on abastecimiento.purchase_order_items;
drop policy if exists receipts_insert_by_location_access on abastecimiento.receipts;
drop policy if exists receipts_manage_by_location_admin on abastecimiento.receipts;
drop policy if exists receipts_update_by_location_access on abastecimiento.receipts;
drop policy if exists receipt_items_insert_by_parent_access on abastecimiento.receipt_items;
drop policy if exists receipt_items_manage_parent on abastecimiento.receipt_items;
drop policy if exists receipt_items_update_by_parent_access on abastecimiento.receipt_items;

drop policy if exists requisitions_select_related on abastecimiento.requisitions;
create policy requisitions_select_related
on abastecimiento.requisitions for select to authenticated
using (
  requested_by = auth.uid()
  or abastecimiento.has_workflow_permission('purchasing', location_id)
  or abastecimiento.has_workflow_permission('accounting', location_id)
  or abastecimiento.has_workflow_permission('management', location_id)
  or abastecimiento.has_workflow_permission('receiving', location_id)
  or abastecimiento.has_workflow_permission('production', location_id)
);

drop policy if exists requisition_items_select_parent on abastecimiento.requisition_items;
create policy requisition_items_select_parent
on abastecimiento.requisition_items for select to authenticated
using (exists (
  select 1 from abastecimiento.requisitions r
  where r.id = requisition_items.requisition_id
));

drop policy if exists purchase_orders_select_by_location on abastecimiento.purchase_orders;
create policy purchase_orders_select_by_location
on abastecimiento.purchase_orders for select to authenticated
using (
  abastecimiento.has_workflow_permission('purchasing', location_id)
  or abastecimiento.has_workflow_permission('accounting', location_id)
  or abastecimiento.has_workflow_permission('management', location_id)
  or abastecimiento.has_workflow_permission('receiving', location_id)
  or exists (
    select 1 from abastecimiento.requisitions r
    where r.id = purchase_orders.requisition_id and r.requested_by = auth.uid()
  )
);

drop policy if exists purchase_order_items_select_parent on abastecimiento.purchase_order_items;
create policy purchase_order_items_select_parent
on abastecimiento.purchase_order_items for select to authenticated
using (exists (
  select 1 from abastecimiento.purchase_orders po
  where po.id = purchase_order_items.purchase_order_id
));

drop policy if exists receipts_select_by_location on abastecimiento.receipts;
create policy receipts_select_by_location
on abastecimiento.receipts for select to authenticated
using (
  abastecimiento.has_workflow_permission('purchasing', location_id)
  or abastecimiento.has_workflow_permission('accounting', location_id)
  or abastecimiento.has_workflow_permission('management', location_id)
  or abastecimiento.has_workflow_permission('receiving', location_id)
  or exists (
    select 1
    from abastecimiento.purchase_orders po
    join abastecimiento.requisitions r on r.id = po.requisition_id
    where po.id = receipts.purchase_order_id and r.requested_by = auth.uid()
  )
);

drop policy if exists receipt_items_select_parent on abastecimiento.receipt_items;
create policy receipt_items_select_parent
on abastecimiento.receipt_items for select to authenticated
using (exists (
  select 1 from abastecimiento.receipts r
  where r.id = receipt_items.receipt_id
));

revoke insert, update, delete, truncate, references, trigger
on abastecimiento.requisitions,
   abastecimiento.requisition_items,
   abastecimiento.purchase_orders,
   abastecimiento.purchase_order_items,
   abastecimiento.receipts,
   abastecimiento.receipt_items
from public, anon, authenticated;

revoke all on function public.create_abastecimiento_requisition_v2(uuid, uuid, text, date, text, jsonb, uuid) from public, anon;
revoke all on function public.create_abastecimiento_requisition(uuid, uuid, text, date, text, jsonb) from public, anon;
revoke all on function public.update_abastecimiento_requisition_v2(uuid, uuid, uuid, text, date, text, jsonb, text, uuid, integer) from public, anon;
revoke all on function public.update_abastecimiento_requisition(uuid, uuid, uuid, text, date, text, jsonb, text) from public, anon;
revoke all on function public.review_abastecimiento_requisition_items_v2(uuid, jsonb, uuid, integer) from public, anon;
revoke all on function public.update_abastecimiento_requisition_status_v2(uuid, text, text, uuid, integer) from public, anon;
revoke all on function public.update_abastecimiento_requisition_status(uuid, text) from public, anon;
revoke all on function public.update_abastecimiento_purchase_order_v2(uuid, jsonb, text, uuid, integer) from public, anon;
revoke all on function public.update_abastecimiento_purchase_order_status_v2(uuid, text, text, uuid, integer) from public, anon;
revoke all on function public.update_abastecimiento_purchase_order_status(uuid, text) from public, anon;
revoke all on function public.save_abastecimiento_receipt_v2(uuid, text, jsonb, text, uuid, integer) from public, anon;
revoke all on function public.save_abastecimiento_receipt(uuid, text, jsonb, text) from public, anon;
revoke all on function public.list_abastecimiento_requisitions_v2() from public, anon;
revoke all on function public.list_abastecimiento_purchase_orders_v2() from public, anon;
revoke all on function public.list_abastecimiento_receiving_orders_v2(date, date) from public, anon;

grant execute on function public.create_abastecimiento_requisition_v2(uuid, uuid, text, date, text, jsonb, uuid) to authenticated;
grant execute on function public.create_abastecimiento_requisition(uuid, uuid, text, date, text, jsonb) to authenticated;
grant execute on function public.update_abastecimiento_requisition_v2(uuid, uuid, uuid, text, date, text, jsonb, text, uuid, integer) to authenticated;
grant execute on function public.update_abastecimiento_requisition(uuid, uuid, uuid, text, date, text, jsonb, text) to authenticated;
grant execute on function public.review_abastecimiento_requisition_items_v2(uuid, jsonb, uuid, integer) to authenticated;
grant execute on function public.update_abastecimiento_requisition_status_v2(uuid, text, text, uuid, integer) to authenticated;
grant execute on function public.update_abastecimiento_requisition_status(uuid, text) to authenticated;
grant execute on function public.update_abastecimiento_purchase_order_v2(uuid, jsonb, text, uuid, integer) to authenticated;
grant execute on function public.update_abastecimiento_purchase_order_status_v2(uuid, text, text, uuid, integer) to authenticated;
grant execute on function public.update_abastecimiento_purchase_order_status(uuid, text) to authenticated;
grant execute on function public.save_abastecimiento_receipt_v2(uuid, text, jsonb, text, uuid, integer) to authenticated;
grant execute on function public.save_abastecimiento_receipt(uuid, text, jsonb, text) to authenticated;
grant execute on function public.list_abastecimiento_requisitions_v2() to authenticated;
grant execute on function public.list_abastecimiento_purchase_orders_v2() to authenticated;
grant execute on function public.list_abastecimiento_receiving_orders_v2(date, date) to authenticated;

revoke all on function abastecimiento.sync_purchase_order_for_requisition(uuid) from public, anon, authenticated;

-- Existing read RPCs should not be callable anonymously either.
revoke all on function public.get_abastecimiento_requisition(uuid) from public, anon;
revoke all on function public.get_abastecimiento_purchase_order(uuid) from public, anon;
revoke all on function public.get_abastecimiento_receiving_order(uuid) from public, anon;
revoke all on function public.list_abastecimiento_requisitions() from public, anon;
revoke all on function public.list_abastecimiento_purchase_orders() from public, anon;
revoke all on function public.list_abastecimiento_receiving_orders(date, date) from public, anon;
grant execute on function public.get_abastecimiento_requisition(uuid) to authenticated;
grant execute on function public.get_abastecimiento_purchase_order(uuid) to authenticated;
grant execute on function public.get_abastecimiento_receiving_order(uuid) to authenticated;
grant execute on function public.list_abastecimiento_requisitions() to authenticated;
grant execute on function public.list_abastecimiento_purchase_orders() to authenticated;
grant execute on function public.list_abastecimiento_receiving_orders(date, date) to authenticated;
