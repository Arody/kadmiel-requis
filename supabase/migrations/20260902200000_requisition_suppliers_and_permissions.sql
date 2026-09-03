-- Migration: Requisition item suppliers and multi-supplier pricing support
-- Adds supplier_id to abastecimiento.requisition_items and updates requisition RPCs
-- to handle primary + alternate supplier selection and pricing.

alter table abastecimiento.requisition_items
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

create index if not exists requisition_items_supplier_idx
  on abastecimiento.requisition_items(supplier_id);

-- Update create_abastecimiento_requisition_v2
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
    requisition_id, product_id, quantity, unit, notes, supplier_id
  )
  select
    v_requisition_id,
    item.product_id,
    item.quantity,
    nullif(trim(item.unit), ''),
    nullif(trim(item.notes), ''),
    coalesce(item.supplier_id, inv.supplier_id)
  from jsonb_to_recordset(p_items) as item(
    product_id uuid, quantity numeric, unit text, notes text, supplier_id uuid
  )
  join public.inventory inv on inv.id = item.product_id
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

-- Update update_abastecimiento_requisition_v2
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
    requisition_id, product_id, quantity, unit, notes, selected, revision_note, supplier_id
  )
  select
    p_requisition_id, item.product_id, item.quantity,
    nullif(trim(item.unit), ''), nullif(trim(item.notes), ''),
    coalesce(item.selected, true), nullif(trim(item.revision_note), ''),
    coalesce(item.supplier_id, inv.supplier_id)
  from jsonb_to_recordset(p_items) as item(
    product_id uuid, quantity numeric, unit text, notes text,
    selected boolean, revision_note text, supplier_id uuid
  )
  join public.inventory inv on inv.id = item.product_id
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

-- Update review_abastecimiento_requisition_items_v2
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
     or (select count(distinct x.item_id) from jsonb_to_recordset(p_items) as x(item_id uuid, selected boolean, revision_note text, supplier_id uuid)) <> v_item_count
     or exists (
       select 1
       from jsonb_to_recordset(p_items) as x(item_id uuid, selected boolean, revision_note text, supplier_id uuid)
       left join abastecimiento.requisition_items ri
         on ri.id = x.item_id and ri.requisition_id = p_requisition_id
       where ri.id is null
     ) then
    raise exception 'La revisión debe incluir cada partida exactamente una vez.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from jsonb_to_recordset(p_items) as x(item_id uuid, selected boolean, revision_note text, supplier_id uuid)
    where coalesce(x.selected, false)
  ) then
    raise exception 'Debes conservar al menos una partida seleccionada.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('kadmiel.command_id', p_command_id::text, true);
  update abastecimiento.requisition_items ri
  set selected = coalesce(x.selected, false),
      revision_note = nullif(trim(x.revision_note), ''),
      supplier_id = coalesce(x.supplier_id, ri.supplier_id)
  from jsonb_to_recordset(p_items) as x(item_id uuid, selected boolean, revision_note text, supplier_id uuid)
  where ri.id = x.item_id and ri.requisition_id = p_requisition_id;

  update abastecimiento.requisitions set updated_at = now() where id = p_requisition_id;
  perform abastecimiento.finish_workflow_command(
    'review_requisition_items', p_command_id, jsonb_build_object('id', p_requisition_id)
  );
  return public.get_abastecimiento_requisition(p_requisition_id);
end;
$function$;

-- Update get_abastecimiento_requisition to return supplier info & price based on selected supplier
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
      case when ri.selected then ri.quantity * case
        when ri.supplier_id is not null and ri.supplier_id = inv_total.supplier_2_id then coalesce(inv_total.total_price_2, inv_total.unit_price_2, inv_total.total_price, inv_total.unit_price, 0)
        when ri.supplier_id is not null and ri.supplier_id = inv_total.supplier_3_id then coalesce(inv_total.total_price_3, inv_total.unit_price_3, inv_total.total_price, inv_total.unit_price, 0)
        else coalesce(inv_total.total_price, inv_total.unit_price, 0)
      end else 0 end
    ), 0),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'product_id', item.product_id,
        'product', inv.product,
        'brand', case
          when item.supplier_id is not null and item.supplier_id = inv.supplier_2_id then coalesce(inv.brand_2, inv.brand)
          when item.supplier_id is not null and item.supplier_id = inv.supplier_3_id then coalesce(inv.brand_3, inv.brand)
          else inv.brand
        end,
        'presentation', case
          when item.supplier_id is not null and item.supplier_id = inv.supplier_2_id then coalesce(inv.presentation_2, inv.presentation)
          when item.supplier_id is not null and item.supplier_id = inv.supplier_3_id then coalesce(inv.presentation_3, inv.presentation)
          else inv.presentation
        end,
        'image_url', inv.image_url,
        'quantity', item.quantity,
        'unit', coalesce(item.unit, inv.unit),
        'notes', item.notes,
        'selected', item.selected,
        'revision_note', item.revision_note,
        'supplier_id', coalesce(item.supplier_id, inv.supplier_id),
        'supplier_name', sup.name,
        'unit_price', case
          when item.supplier_id is not null and item.supplier_id = inv.supplier_2_id then coalesce(inv.unit_price_2, inv.unit_price)
          when item.supplier_id is not null and item.supplier_id = inv.supplier_3_id then coalesce(inv.unit_price_3, inv.unit_price)
          else inv.unit_price
        end,
        'total_price', case
          when item.supplier_id is not null and item.supplier_id = inv.supplier_2_id then coalesce(inv.total_price_2, inv.unit_price_2, inv.total_price, inv.unit_price)
          when item.supplier_id is not null and item.supplier_id = inv.supplier_3_id then coalesce(inv.total_price_3, inv.unit_price_3, inv.total_price, inv.unit_price)
          else coalesce(inv.total_price, inv.unit_price)
        end,
        'line_total', item.quantity * case
          when item.supplier_id is not null and item.supplier_id = inv.supplier_2_id then coalesce(inv.total_price_2, inv.unit_price_2, inv.total_price, inv.unit_price, 0)
          when item.supplier_id is not null and item.supplier_id = inv.supplier_3_id then coalesce(inv.total_price_3, inv.unit_price_3, inv.total_price, inv.unit_price, 0)
          else coalesce(inv.total_price, inv.unit_price, 0)
        end,
        'almacen', inv.almacen
      ) order by item.created_at, item.id)
      from abastecimiento.requisition_items item
      join public.inventory inv on inv.id = item.product_id
      left join public.suppliers sup on sup.id = coalesce(item.supplier_id, inv.supplier_id)
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

-- Update sync_purchase_order_for_requisition
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

  select coalesce(sum(ri.quantity * case
    when ri.supplier_id is not null and ri.supplier_id = inv.supplier_2_id then coalesce(inv.total_price_2, inv.unit_price_2, inv.total_price, inv.unit_price, 0)
    when ri.supplier_id is not null and ri.supplier_id = inv.supplier_3_id then coalesce(inv.total_price_3, inv.unit_price_3, inv.total_price, inv.unit_price, 0)
    else coalesce(inv.total_price, inv.unit_price, 0)
  end), 0)
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
    coalesce(ri.unit, inv.unit),
    case
      when ri.supplier_id is not null and ri.supplier_id = inv.supplier_2_id then coalesce(inv.total_price_2, inv.unit_price_2, inv.total_price, inv.unit_price, 0)
      when ri.supplier_id is not null and ri.supplier_id = inv.supplier_3_id then coalesce(inv.total_price_3, inv.unit_price_3, inv.total_price, inv.unit_price, 0)
      else coalesce(inv.total_price, inv.unit_price, 0)
    end
  from abastecimiento.requisition_items ri
  join public.inventory inv on inv.id = ri.product_id
  where ri.requisition_id = p_requisition_id and ri.selected;

  return v_purchase_order_id;
end;
$function$;

-- Update list_abastecimiento_requisitions
create or replace function public.list_abastecimiento_requisitions()
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
  created_at timestamp with time zone,
  items_count bigint,
  estimated_total numeric
)
language sql
stable
set search_path to 'public', 'abastecimiento', 'pg_temp'
as $function$
  select
    r.id,
    r.folio,
    r.location_id,
    l.name::text as location_name,
    r.area_id,
    a.name as area_name,
    r.request_type,
    r.status,
    r.needed_by,
    r.notes,
    r.requested_by,
    coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), r.requested_by::text) as requested_by_name,
    r.created_at,
    count(ri.id) as items_count,
    coalesce(sum(case when ri.selected = true then ri.quantity * case
      when ri.supplier_id is not null and ri.supplier_id = inv.supplier_2_id then coalesce(inv.total_price_2, inv.unit_price_2, inv.total_price, inv.unit_price, 0)
      when ri.supplier_id is not null and ri.supplier_id = inv.supplier_3_id then coalesce(inv.total_price_3, inv.unit_price_3, inv.total_price, inv.unit_price, 0)
      else coalesce(inv.total_price, inv.unit_price, 0)
    end else 0 end), 0)::numeric as estimated_total
  from abastecimiento.requisitions r
  join public.locations l on l.id = r.location_id
  left join abastecimiento.areas a on a.id = r.area_id
  left join public.profiles p on p.id = r.requested_by
  left join abastecimiento.requisition_items ri on ri.requisition_id = r.id
  left join public.inventory inv on inv.id = ri.product_id
  group by r.id, l.name, a.name, p.full_name, p.email
  order by r.created_at desc;
$function$;
