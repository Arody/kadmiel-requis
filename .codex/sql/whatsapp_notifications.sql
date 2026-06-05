-- ============================================================================
-- WhatsApp notifications (Baileys) — schema wp_data + RPCs + trigger
-- ----------------------------------------------------------------------------
-- Arquitectura: el frontend (static export) NO corre Baileys. Un gateway Node
-- aparte (en VPS) usa service_role para mantener la sesion en wp_data.auth_state
-- y consume wp_data.message_outbox para enviar. El frontend solo usa RPCs public
-- (SECURITY DEFINER, gated por public.is_super_admin()). wp_data NO se expone a
-- PostgREST, asi que la sesion de WhatsApp nunca es visible para el navegador.
-- ============================================================================

create schema if not exists wp_data;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

-- Estado de autenticacion de Baileys (creds + signal keys) serializado con BufferJSON.
create table if not exists wp_data.auth_state (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Estado de conexion (fila unica id = 1). El gateway escribe status/qr/phone;
-- el frontend lo lee via wp_get_status(). 'command' permite pedir logout.
create table if not exists wp_data.connection (
  id                smallint primary key default 1 check (id = 1),
  status            text not null default 'disconnected'
                     check (status in ('disconnected','connecting','qr','connected')),
  qr                text,
  phone             text,
  command           text check (command in ('logout')),
  last_connected_at timestamptz,
  updated_at        timestamptz not null default now()
);
insert into wp_data.connection (id) values (1) on conflict (id) do nothing;

-- Reglas de notificacion por tipo de evento.
create table if not exists wp_data.notification_rules (
  event_type text primary key,
  enabled    boolean not null default false,
  template   text,
  updated_at timestamptz not null default now()
);
insert into wp_data.notification_rules (event_type, enabled)
values ('requisition_created', false)
on conflict (event_type) do nothing;

-- Destinatarios por regla (snapshot de nombre + telefono normalizado).
create table if not exists wp_data.notification_recipients (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null references wp_data.notification_rules(event_type) on delete cascade,
  employee_id  uuid not null,
  phone        text not null,
  display_name text,
  created_at   timestamptz not null default now(),
  unique (event_type, employee_id)
);

-- Cola de salida que consume el gateway.
create table if not exists wp_data.message_outbox (
  id                    uuid primary key default gen_random_uuid(),
  to_phone              text not null,
  body                  text not null,
  event_type            text,
  ref_id                uuid,
  recipient_employee_id uuid,
  status                text not null default 'pending'
                         check (status in ('pending','sending','sent','failed')),
  attempts              int not null default 0,
  last_error            text,
  created_at            timestamptz not null default now(),
  sent_at               timestamptz,
  unique (event_type, ref_id, recipient_employee_id)
);
create index if not exists message_outbox_pending_idx
  on wp_data.message_outbox (created_at) where status in ('pending','sending');

-- RLS activo y SIN policies: solo accesible por funciones SECURITY DEFINER
-- (owner postgres) y por service_role (BYPASSRLS). El navegador no entra.
alter table wp_data.auth_state             enable row level security;
alter table wp_data.connection             enable row level security;
alter table wp_data.notification_rules     enable row level security;
alter table wp_data.notification_recipients enable row level security;
alter table wp_data.message_outbox         enable row level security;

-- Acceso del gateway (service_role).
grant usage on schema wp_data to service_role;
grant all privileges on all tables in schema wp_data to service_role;
grant all privileges on all sequences in schema wp_data to service_role;
alter default privileges in schema wp_data grant all on tables to service_role;
alter default privileges in schema wp_data grant all on sequences to service_role;

-- Realtime para que el gateway reaccione al instante (con polling como respaldo).
do $$
begin
  begin
    alter publication supabase_realtime add table wp_data.message_outbox;
  exception when duplicate_object then null; when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table wp_data.connection;
  exception when duplicate_object then null; when undefined_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Helper: normaliza telefono a digitos con lada MX por defecto (52).
-- ---------------------------------------------------------------------------
create or replace function wp_data.normalize_phone(p_raw text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  with d as (select regexp_replace(coalesce(p_raw, ''), '\D', '', 'g') as v)
  select case
    when v = '' then null
    when length(v) = 10 then '52' || v                                   -- 10 digitos -> +52
    when length(v) = 12 and left(v, 2) = '52' then v                     -- ya trae 52
    when length(v) = 13 and left(v, 3) = '521' then '52' || right(v, 10) -- 52 1 XXXXXXXXXX -> 52 XXXXXXXXXX
    else v
  end
  from d;
$$;

-- ---------------------------------------------------------------------------
-- RPCs publicas (SECURITY DEFINER, gated por super_admin)
-- ---------------------------------------------------------------------------

create or replace function public.wp_get_status()
returns table (status text, qr text, phone text, command text, last_connected_at timestamptz, updated_at timestamptz)
language plpgsql
security definer
set search_path = public, wp_data, pg_temp
as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select c.status, c.qr, c.phone, c.command, c.last_connected_at, c.updated_at
    from wp_data.connection c where c.id = 1;
end;
$$;

create or replace function public.wp_list_employees()
returns table (id uuid, nombre text, apellidos text, telefono text, has_phone boolean)
language plpgsql
security definer
set search_path = public, employee_data, wp_data, pg_temp
as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select e.id, e.nombre, e.apellidos, e.telefono,
           (wp_data.normalize_phone(e.telefono) is not null
            and length(wp_data.normalize_phone(e.telefono)) >= 10) as has_phone
    from employee_data.employees e
    order by e.nombre nulls last, e.apellidos nulls last;
end;
$$;

create or replace function public.wp_get_requisition_recipients()
returns jsonb
language plpgsql
security definer
set search_path = public, wp_data, pg_temp
as $$
declare
  v_enabled boolean;
  v_list jsonb;
begin
  if not public.is_super_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(enabled, false) into v_enabled
    from wp_data.notification_rules where event_type = 'requisition_created';
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'employee_id', r.employee_id,
             'display_name', r.display_name,
             'phone', r.phone
           ) order by r.display_name),
           '[]'::jsonb)
    into v_list
    from wp_data.notification_recipients r
    where r.event_type = 'requisition_created';
  return jsonb_build_object('enabled', coalesce(v_enabled, false), 'recipients', v_list);
end;
$$;

create or replace function public.wp_save_requisition_recipients(p_enabled boolean, p_employee_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, employee_data, wp_data, pg_temp
as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  insert into wp_data.notification_rules (event_type, enabled, updated_at)
  values ('requisition_created', coalesce(p_enabled, false), now())
  on conflict (event_type) do update set enabled = excluded.enabled, updated_at = now();

  delete from wp_data.notification_recipients where event_type = 'requisition_created';

  insert into wp_data.notification_recipients (event_type, employee_id, phone, display_name)
  select 'requisition_created', e.id, wp_data.normalize_phone(e.telefono),
         nullif(trim(coalesce(e.nombre, '') || ' ' || coalesce(e.apellidos, '')), '')
  from employee_data.employees e
  where e.id = any (coalesce(p_employee_ids, '{}'::uuid[]))
    and wp_data.normalize_phone(e.telefono) is not null;

  return public.wp_get_requisition_recipients();
end;
$$;

create or replace function public.wp_request_logout()
returns void
language plpgsql
security definer
set search_path = public, wp_data, pg_temp
as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update wp_data.connection set command = 'logout', updated_at = now() where id = 1;
end;
$$;

create or replace function public.wp_get_recent_messages(p_limit int default 20)
returns table (id uuid, to_phone text, body text, status text, attempts int, last_error text, created_at timestamptz, sent_at timestamptz)
language plpgsql
security definer
set search_path = public, wp_data, pg_temp
as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select m.id, m.to_phone, m.body, m.status, m.attempts, m.last_error, m.created_at, m.sent_at
    from wp_data.message_outbox m
    order by m.created_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

-- Solo usuarios autenticados pueden invocar (la verificacion real es is_super_admin()).
-- Estas son funciones de administracion (PII / control de cuenta), asi que ademas
-- revocamos a anon (mas estricto que el resto del codigo, que se apoya solo en el gate interno).
revoke all on function public.wp_get_status()                                  from public, anon;
revoke all on function public.wp_list_employees()                              from public, anon;
revoke all on function public.wp_get_requisition_recipients()                  from public, anon;
revoke all on function public.wp_save_requisition_recipients(boolean, uuid[])  from public, anon;
revoke all on function public.wp_request_logout()                              from public, anon;
revoke all on function public.wp_get_recent_messages(int)                      from public, anon;

grant execute on function public.wp_get_status()                                 to authenticated;
grant execute on function public.wp_list_employees()                             to authenticated;
grant execute on function public.wp_get_requisition_recipients()                 to authenticated;
grant execute on function public.wp_save_requisition_recipients(boolean, uuid[]) to authenticated;
grant execute on function public.wp_request_logout()                             to authenticated;
grant execute on function public.wp_get_recent_messages(int)                     to authenticated;

-- ---------------------------------------------------------------------------
-- Trigger: encolar notificacion al crear una requisicion
-- ---------------------------------------------------------------------------
create or replace function wp_data.on_requisition_created()
returns trigger
language plpgsql
security definer
set search_path = wp_data, public, abastecimiento, pg_temp
as $$
declare
  v_enabled   boolean;
  v_location  text;
  v_area      text;
  v_requester text;
  v_body      text;
  r           record;
begin
  -- Nunca bloquear la creacion de la requisicion por un fallo de notificacion.
  begin
    select enabled into v_enabled
      from wp_data.notification_rules where event_type = 'requisition_created';
    if not coalesce(v_enabled, false) then
      return new;
    end if;

    select name      into v_location  from public.locations        where id = new.location_id;
    select name      into v_area      from abastecimiento.areas    where id = new.area_id;
    select full_name into v_requester from public.profiles         where id = new.requested_by;

    v_body :=
      '🧾 *Nueva requisición* ' || coalesce(new.folio, left(new.id::text, 8)) || E'\n' ||
      '🏢 Sucursal: ' || coalesce(v_location, '—')                || E'\n' ||
      '📍 Área: '     || coalesce(v_area, '—')                    || E'\n' ||
      '🗂️ Tipo: '     || coalesce(new.request_type, 'ordinaria')  || E'\n' ||
      '🙍 Solicitó: ' || coalesce(v_requester, '—')               || E'\n' ||
      '🕒 ' || to_char(new.created_at at time zone 'America/Mexico_City', 'DD/MM/YYYY HH24:MI');

    for r in
      select employee_id, phone
      from wp_data.notification_recipients
      where event_type = 'requisition_created'
        and phone is not null
        and length(phone) >= 10
    loop
      insert into wp_data.message_outbox (to_phone, body, event_type, ref_id, recipient_employee_id)
      values (r.phone, v_body, 'requisition_created', new.id, r.employee_id)
      on conflict (event_type, ref_id, recipient_employee_id) do nothing;
    end loop;
  exception when others then
    raise warning 'wp_data.on_requisition_created failed: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists trg_wp_requisition_created on abastecimiento.requisitions;
create trigger trg_wp_requisition_created
  after insert on abastecimiento.requisitions
  for each row execute function wp_data.on_requisition_created();

-- ---------------------------------------------------------------------------
-- RPCs del GATEWAY (solo service_role). El gateway corre en el VPS con la
-- service_role key. Como wp_data NO se expone a PostgREST, el gateway opera
-- el schema a traves de estas funciones (consistente con el patron del repo).
-- ---------------------------------------------------------------------------

-- Auth state de Baileys (creds + signal keys)
create or replace function public.wp_gw_auth_read(p_ids text[])
returns table (id text, data jsonb)
language sql security definer set search_path = public, wp_data, pg_temp
as $$ select a.id, a.data from wp_data.auth_state a where a.id = any (p_ids); $$;

create or replace function public.wp_gw_auth_write(p_id text, p_data jsonb)
returns void
language sql security definer set search_path = public, wp_data, pg_temp
as $$
  insert into wp_data.auth_state (id, data, updated_at)
  values (p_id, p_data, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();
$$;

create or replace function public.wp_gw_auth_remove(p_ids text[])
returns void
language sql security definer set search_path = public, wp_data, pg_temp
as $$ delete from wp_data.auth_state where id = any (p_ids); $$;

create or replace function public.wp_gw_auth_reset()
returns void
language sql security definer set search_path = public, wp_data, pg_temp
as $$ delete from wp_data.auth_state; $$;

-- Estado de conexion
create or replace function public.wp_gw_connection_get()
returns table (status text, command text)
language sql security definer set search_path = public, wp_data, pg_temp
as $$ select c.status, c.command from wp_data.connection c where c.id = 1; $$;

create or replace function public.wp_gw_connection_set(
  p_status text,
  p_qr text default null,
  p_phone text default null,
  p_clear_command boolean default false
)
returns void
language plpgsql security definer set search_path = public, wp_data, pg_temp
as $$
begin
  update wp_data.connection set
    status            = coalesce(p_status, status),
    qr                = p_qr,
    phone             = p_phone,
    last_connected_at = case when p_status = 'connected' then now() else last_connected_at end,
    command           = case when p_clear_command then null else command end,
    updated_at        = now()
  where id = 1;
end;
$$;

-- Cola de salida (claim atomico + marcado)
create or replace function public.wp_gw_claim_messages(p_limit int default 10)
returns table (id uuid, to_phone text, body text)
language sql security definer set search_path = public, wp_data, pg_temp
as $$
  with claimed as (
    select m.id from wp_data.message_outbox m
    where m.status = 'pending'
    order by m.created_at
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  update wp_data.message_outbox o
     set status = 'sending', attempts = o.attempts + 1
  from claimed
  where o.id = claimed.id
  returning o.id, o.to_phone, o.body;
$$;

create or replace function public.wp_gw_mark_sent(p_id uuid)
returns void
language sql security definer set search_path = public, wp_data, pg_temp
as $$ update wp_data.message_outbox set status = 'sent', sent_at = now(), last_error = null where id = p_id; $$;

create or replace function public.wp_gw_mark_failed(p_id uuid, p_error text, p_max int default 3)
returns void
language sql security definer set search_path = public, wp_data, pg_temp
as $$
  update wp_data.message_outbox set
    status     = case when attempts >= p_max then 'failed' else 'pending' end,
    last_error = p_error
  where id = p_id;
$$;

-- Solo service_role (backend) puede invocar las RPCs del gateway.
do $$
declare fn text;
begin
  for fn in
    select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'wp_gw_%'
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated;', fn);
    execute format('grant execute on function public.%s to service_role;', fn);
  end loop;
end $$;
