create or replace function public.create_abastecimiento_requisition(
  p_location_id uuid,
  p_area_id uuid,
  p_request_type text,
  p_needed_by date,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
set search_path to 'public', 'abastecimiento', 'pg_temp'
as $function$
declare
  new_requisition_id uuid;
  inserted_count integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para crear una requisición.' using errcode = '28000';
  end if;

  if p_location_id is null or not abastecimiento.can_access_location(p_location_id) then
    raise exception 'No tienes acceso a la sucursal seleccionada.' using errcode = '42501';
  end if;

  if coalesce(nullif(p_request_type, ''), 'ordinaria') not in ('ordinaria', 'urgente', 'programada') then
    raise exception 'Tipo de requisición inválido.' using errcode = '22023';
  end if;

  if p_area_id is not null and not exists (
    select 1
    from abastecimiento.areas area
    where area.id = p_area_id
      and area.location_id = p_location_id
      and area.active
  ) then
    raise exception 'El área no pertenece a la sucursal seleccionada.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La requisición necesita al menos un producto.' using errcode = '22023';
  end if;

  insert into abastecimiento.requisitions (location_id, area_id, requested_by, request_type, needed_by, notes)
  values (p_location_id, p_area_id, auth.uid(), coalesce(nullif(p_request_type, ''), 'ordinaria'), p_needed_by, nullif(p_notes, ''))
  returning id into new_requisition_id;

  insert into abastecimiento.requisition_items (requisition_id, product_id, quantity, unit, notes)
  select
    new_requisition_id,
    (item->>'product_id')::uuid,
    (item->>'quantity')::numeric,
    nullif(item->>'unit', ''),
    nullif(item->>'notes', '')
  from jsonb_array_elements(p_items) as item
  where item ? 'product_id'
    and item ? 'quantity'
    and (item->>'quantity')::numeric > 0
    and exists (
      select 1
      from public.inventory_locations inventory_locations
      where inventory_locations.inventory_id = (item->>'product_id')::uuid
        and inventory_locations.location_id = p_location_id
    );

  get diagnostics inserted_count = row_count;

  if inserted_count <> jsonb_array_length(p_items) then
    raise exception 'Todas las partidas necesitan producto disponible para la sucursal y cantidad válida.' using errcode = '22023';
  end if;

  return new_requisition_id;
end;
$function$;

create or replace function public.update_abastecimiento_requisition(
  p_requisition_id uuid,
  p_location_id uuid,
  p_area_id uuid,
  p_request_type text,
  p_needed_by date,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
set search_path to 'public', 'abastecimiento', 'pg_temp'
as $function$
declare
  current_req abastecimiento.requisitions%rowtype;
  inserted_count integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para editar la requisición.' using errcode = '28000';
  end if;

  select * into current_req
  from abastecimiento.requisitions
  where id = p_requisition_id
  for update;

  if not found then
    raise exception 'No se encontró la requisición.' using errcode = '02000';
  end if;

  if current_req.status <> 'pendiente' then
    raise exception 'Solo se puede editar una requisición pendiente de aprobación.' using errcode = '42501';
  end if;

  if not (current_req.requested_by = auth.uid() or abastecimiento.can_manage_location(current_req.location_id)) then
    raise exception 'No tienes permiso para editar esta requisición.' using errcode = '42501';
  end if;

  if p_location_id is null or not abastecimiento.can_access_location(p_location_id) then
    raise exception 'No tienes acceso a la sucursal seleccionada.' using errcode = '42501';
  end if;

  if p_request_type not in ('ordinaria', 'urgente', 'programada') then
    raise exception 'Tipo de requisición inválido.' using errcode = '22023';
  end if;

  if p_area_id is not null and not exists (
    select 1
    from abastecimiento.areas area
    where area.id = p_area_id
      and area.location_id = p_location_id
      and area.active
  ) then
    raise exception 'El área no pertenece a la sucursal seleccionada.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La requisición necesita al menos un producto.' using errcode = '22023';
  end if;

  update abastecimiento.requisitions
  set
    location_id = p_location_id,
    area_id = p_area_id,
    request_type = p_request_type,
    needed_by = p_needed_by,
    notes = nullif(p_notes, '')
  where id = p_requisition_id;

  delete from abastecimiento.requisition_items
  where requisition_id = p_requisition_id;

  insert into abastecimiento.requisition_items (requisition_id, product_id, quantity, unit, notes)
  select
    p_requisition_id,
    (item->>'product_id')::uuid,
    (item->>'quantity')::numeric,
    nullif(item->>'unit', ''),
    nullif(item->>'notes', '')
  from jsonb_array_elements(p_items) as item
  where item ? 'product_id'
    and item ? 'quantity'
    and (item->>'quantity')::numeric > 0
    and exists (
      select 1
      from public.inventory_locations inventory_locations
      where inventory_locations.inventory_id = (item->>'product_id')::uuid
        and inventory_locations.location_id = p_location_id
    );

  get diagnostics inserted_count = row_count;

  if inserted_count <> jsonb_array_length(p_items) then
    raise exception 'Todas las partidas necesitan producto disponible para la sucursal y cantidad válida.' using errcode = '22023';
  end if;

  return public.get_abastecimiento_requisition(p_requisition_id);
end;
$function$;
