-- The legacy read RPCs trusted nullable filter parameters before checking the
-- location attached to the requested aggregate. Keep their response contracts,
-- but put an authorization boundary in front of the proven query bodies.

alter function public.list_abastecimiento_pending_quality_items(uuid, date, uuid)
  set schema abastecimiento;
alter function abastecimiento.list_abastecimiento_pending_quality_items(uuid, date, uuid)
  set search_path = '';
revoke all on function abastecimiento.list_abastecimiento_pending_quality_items(uuid, date, uuid)
  from public, anon, authenticated;

create function public.list_abastecimiento_pending_quality_items(
  p_location_id uuid,
  p_date date,
  p_lot_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actual_location_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para consultar partidas de calidad.'
      using errcode = '28000';
  end if;

  if p_lot_id is not null then
    select lot.location_id
      into v_actual_location_id
    from abastecimiento.production_lots lot
    where lot.id = p_lot_id;

    if not found
       or (p_location_id is not null and p_location_id is distinct from v_actual_location_id)
       or not abastecimiento.can_access_location(v_actual_location_id) then
      raise exception 'No se encontró el lote o no tienes acceso a su sucursal.'
        using errcode = '42501';
    end if;
  elsif p_location_id is not null then
    if not abastecimiento.can_access_location(p_location_id) then
      raise exception 'No tienes permiso para acceder a esta sucursal.'
        using errcode = '42501';
    end if;
  elsif not exists (
    select 1
    from public.user_roles role_assignment
    where role_assignment.user_id = auth.uid()
      and role_assignment.role = 'super_admin'::public.app_role
  ) then
    raise exception 'Selecciona una sucursal para consultar partidas de calidad.'
      using errcode = '42501';
  end if;

  return abastecimiento.list_abastecimiento_pending_quality_items(
    p_location_id, p_date, p_lot_id
  );
end;
$function$;

alter function public.list_abastecimiento_quality_products_for_merma(uuid, date, uuid)
  set schema abastecimiento;
alter function abastecimiento.list_abastecimiento_quality_products_for_merma(uuid, date, uuid)
  set search_path = '';
revoke all on function abastecimiento.list_abastecimiento_quality_products_for_merma(uuid, date, uuid)
  from public, anon, authenticated;

create function public.list_abastecimiento_quality_products_for_merma(
  p_location_id uuid default null,
  p_date date default null,
  p_verification_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actual_location_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para consultar productos de calidad.'
      using errcode = '28000';
  end if;

  if p_verification_id is not null then
    select verification.location_id
      into v_actual_location_id
    from abastecimiento.quality_verifications verification
    where verification.id = p_verification_id;

    if not found
       or (p_location_id is not null and p_location_id is distinct from v_actual_location_id)
       or not abastecimiento.can_access_location(v_actual_location_id) then
      raise exception 'No se encontró la verificación o no tienes acceso a su sucursal.'
        using errcode = '42501';
    end if;
  elsif p_location_id is not null then
    if not abastecimiento.can_access_location(p_location_id) then
      raise exception 'No tienes permiso para acceder a esta sucursal.'
        using errcode = '42501';
    end if;
  elsif not exists (
    select 1
    from public.user_roles role_assignment
    where role_assignment.user_id = auth.uid()
      and role_assignment.role = 'super_admin'::public.app_role
  ) then
    raise exception 'Selecciona una sucursal para consultar productos de calidad.'
      using errcode = '42501';
  end if;

  return abastecimiento.list_abastecimiento_quality_products_for_merma(
    p_location_id, p_date, p_verification_id
  );
end;
$function$;

revoke all on function public.list_abastecimiento_pending_quality_items(uuid, date, uuid)
  from public, anon;
revoke all on function public.list_abastecimiento_quality_products_for_merma(uuid, date, uuid)
  from public, anon;
grant execute on function public.list_abastecimiento_pending_quality_items(uuid, date, uuid)
  to authenticated;
grant execute on function public.list_abastecimiento_quality_products_for_merma(uuid, date, uuid)
  to authenticated;

-- The public reader surface is authenticated-only. These inherited functions
-- already enforce location access in their query bodies; fix their execution
-- grants and remove mutable search paths without changing their contracts.
alter function public.get_abastecimiento_merma_pv_record(uuid)
  set search_path = '';
alter function public.get_abastecimiento_production_lot(uuid)
  set search_path = '';
alter function public.get_abastecimiento_quality_verification(uuid)
  set search_path = '';
alter function public.list_abastecimiento_merma_pv_records(uuid, date, date, integer)
  set search_path = '';
alter function public.list_abastecimiento_production_lots(uuid, date, date, integer)
  set search_path = '';
alter function public.list_abastecimiento_quality_verifications(uuid, date, date, integer)
  set search_path = '';

revoke all on function public.get_abastecimiento_merma_pv_record(uuid)
  from public, anon;
revoke all on function public.get_abastecimiento_production_lot(uuid)
  from public, anon;
revoke all on function public.get_abastecimiento_quality_verification(uuid)
  from public, anon;
revoke all on function public.list_abastecimiento_merma_pv_records(uuid, date, date, integer)
  from public, anon;
revoke all on function public.list_abastecimiento_production_lots(uuid, date, date, integer)
  from public, anon;
revoke all on function public.list_abastecimiento_quality_verifications(uuid, date, date, integer)
  from public, anon;

grant execute on function public.get_abastecimiento_merma_pv_record(uuid)
  to authenticated;
grant execute on function public.get_abastecimiento_production_lot(uuid)
  to authenticated;
grant execute on function public.get_abastecimiento_quality_verification(uuid)
  to authenticated;
grant execute on function public.list_abastecimiento_merma_pv_records(uuid, date, date, integer)
  to authenticated;
grant execute on function public.list_abastecimiento_production_lots(uuid, date, date, integer)
  to authenticated;
grant execute on function public.list_abastecimiento_quality_verifications(uuid, date, date, integer)
  to authenticated;

-- Preserve the provenance invariant even if another trusted writer calls the
-- inherited implementation directly in the future.
create or replace function abastecimiento.guard_quality_lot_item_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lot_id uuid;
begin
  select verification.lot_id
    into v_lot_id
  from abastecimiento.quality_verifications verification
  where verification.id = new.verification_id;

  if not found then
    raise exception 'No se encontró la verificación de Calidad.' using errcode = '23503';
  end if;

  if v_lot_id is null then
    if new.lot_item_id is not null then
      raise exception 'Una verificación consolidada no puede apuntar a una partida de otro lote.'
        using errcode = '23514';
    end if;
  elsif new.lot_item_id is null or not exists (
    select 1
    from abastecimiento.production_lot_items lot_item
    where lot_item.id = new.lot_item_id
      and lot_item.lot_id = v_lot_id
      and lot_item.finished_product_id is not distinct from new.finished_product_id
  ) then
    raise exception 'La partida verificada no pertenece al lote y producto seleccionados.'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function abastecimiento.guard_quality_lot_item_scope()
  from public, anon, authenticated;

do $quality_provenance$
begin
  if exists (
    select 1
    from abastecimiento.quality_verification_items quality_item
    join abastecimiento.quality_verifications verification
      on verification.id = quality_item.verification_id
    left join abastecimiento.production_lot_items lot_item
      on lot_item.id = quality_item.lot_item_id
    where (verification.lot_id is null and quality_item.lot_item_id is not null)
       or (
         verification.lot_id is not null
         and (
           lot_item.id is null
           or lot_item.lot_id is distinct from verification.lot_id
           or lot_item.finished_product_id is distinct from quality_item.finished_product_id
         )
       )
  ) then
    raise exception 'Existen partidas históricas de Calidad vinculadas a un lote incorrecto.';
  end if;
end;
$quality_provenance$;

create trigger quality_verification_items_guard_lot_scope
before insert on abastecimiento.quality_verification_items
for each row execute function abastecimiento.guard_quality_lot_item_scope();

-- Fail the migration if a later default privilege or signature drift reopens
-- either wrapper or exposes the relocated implementations.
do $verification$
declare
  v_function regprocedure;
  v_security_definer boolean;
  v_configuration text[];
begin
  foreach v_function in array array[
    'public.list_abastecimiento_pending_quality_items(uuid,date,uuid)'::regprocedure,
    'public.list_abastecimiento_quality_products_for_merma(uuid,date,uuid)'::regprocedure,
    'public.get_abastecimiento_merma_pv_record(uuid)'::regprocedure,
    'public.get_abastecimiento_production_lot(uuid)'::regprocedure,
    'public.get_abastecimiento_quality_verification(uuid)'::regprocedure,
    'public.list_abastecimiento_merma_pv_records(uuid,date,date,integer)'::regprocedure,
    'public.list_abastecimiento_production_lots(uuid,date,date,integer)'::regprocedure,
    'public.list_abastecimiento_quality_verifications(uuid,date,date,integer)'::regprocedure
  ] loop
    select procedure.prosecdef, procedure.proconfig
      into v_security_definer, v_configuration
    from pg_catalog.pg_proc procedure
    where procedure.oid = v_function::oid;

    if not v_security_definer
       or not ('search_path=""' = any(coalesce(v_configuration, array[]::text[]))) then
      raise exception 'El RPC % no conserva SECURITY DEFINER con search_path vacío.', v_function;
    end if;
    if pg_catalog.has_function_privilege('public', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE') then
      raise exception 'El RPC % quedó ejecutable sin autenticación.', v_function;
    end if;
    if not pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'El RPC % no quedó disponible para authenticated.', v_function;
    end if;
  end loop;

  foreach v_function in array array[
    'abastecimiento.list_abastecimiento_pending_quality_items(uuid,date,uuid)'::regprocedure,
    'abastecimiento.list_abastecimiento_quality_products_for_merma(uuid,date,uuid)'::regprocedure,
    'abastecimiento.guard_quality_lot_item_scope()'::regprocedure
  ] loop
    if pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('public', v_function, 'EXECUTE') then
      raise exception 'La implementación interna % quedó expuesta.', v_function;
    end if;
  end loop;
end;
$verification$;
