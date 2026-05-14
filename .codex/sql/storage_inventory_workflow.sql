alter table abastecimiento.receipts
  add column if not exists stored_at timestamp with time zone;

update abastecimiento.receipts
set stored_at = coalesce(stored_at, updated_at, received_at)
where status = 'en_almacen'
  and stored_at is null;

create index if not exists receipts_stored_at_idx
  on abastecimiento.receipts (stored_at)
  where status = 'en_almacen';

create or replace function public.get_abastecimiento_receiving_order(p_purchase_order_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'abastecimiento', 'pg_temp'
as $function$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion para ver la recepcion.' using errcode = '28000';
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
    'completed_at', coalesce(r.updated_at, po.updated_at, po.ordered_at),
    'received_at', rec.received_at,
    'stored_at', rec.stored_at,
    'status', coalesce(rec.status, 'pendiente'),
    'notes', rec.notes,
    'items_count', count(poi.id),
    'differences_count', count(poi.id) filter (
      where rec.id is not null
        and coalesce(rit.received_quantity, 0) <> poi.quantity
    ),
    'total_ordered', coalesce(sum(poi.quantity), 0),
    'total_received', coalesce(sum(rit.received_quantity), 0),
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
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
          )
          order by item_po.created_at, item_po.id
        )
        from abastecimiento.purchase_order_items item_po
        left join abastecimiento.requisition_items item_req on item_req.id = item_po.requisition_item_id
        left join abastecimiento.receipt_items item_rec on item_rec.purchase_order_item_id = item_po.id
        join public.inventory inv on inv.id = item_po.product_id
        left join public.inventory_warehouses wh on wh.id = inv.warehouse_id
        left join public.inventory_racks rack on rack.id = inv.rack_id
        left join public.inventory_categories cat on cat.id = inv.category_id
        where item_po.purchase_order_id = po.id
      ),
      '[]'::jsonb
    )
  ) into result
  from abastecimiento.purchase_orders po
  join abastecimiento.requisitions r on r.id = po.requisition_id
  join public.locations l on l.id = po.location_id
  left join abastecimiento.areas a on a.id = r.area_id
  left join public.profiles requester on requester.id = r.requested_by
  left join abastecimiento.receipts rec on rec.purchase_order_id = po.id
  left join abastecimiento.purchase_order_items poi on poi.purchase_order_id = po.id
  left join abastecimiento.receipt_items rit on rit.purchase_order_item_id = poi.id
  where po.id = p_purchase_order_id
    and r.status = 'completado'
    and po.status = 'completado'
    and abastecimiento.can_access_location(po.location_id)
  group by po.id, r.id, l.name, a.name, requester.full_name, requester.email, rec.id;

  if result is null then
    raise exception 'No se encontro la recepcion o no tienes acceso.' using errcode = '42501';
  end if;

  return result;
end;
$function$;

create or replace function public.save_abastecimiento_receipt(
  p_purchase_order_id uuid,
  p_status text,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
set search_path to 'public', 'abastecimiento', 'pg_temp'
as $function$
declare
  current_order record;
  v_receipt_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion para guardar la recepcion.' using errcode = '28000';
  end if;

  if p_status not in ('pendiente', 'recibida', 'en_almacen') then
    raise exception 'Estado de recepcion invalido.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'La recepcion necesita partidas validas.' using errcode = '22023';
  end if;

  select po.*, r.status as requisition_status
  into current_order
  from abastecimiento.purchase_orders po
  join abastecimiento.requisitions r on r.id = po.requisition_id
  where po.id = p_purchase_order_id
  for update of po;

  if not found then
    raise exception 'No se encontro la orden de compra.' using errcode = '02000';
  end if;

  if current_order.status <> 'completado' or current_order.requisition_status <> 'completado' then
    raise exception 'Solo se pueden recibir requisiciones completadas.' using errcode = '42501';
  end if;

  if not abastecimiento.can_access_location(current_order.location_id) then
    raise exception 'No tienes acceso a esta sucursal.' using errcode = '42501';
  end if;

  insert into abastecimiento.receipts as rec (purchase_order_id, location_id, status, received_by, received_at, stored_at, has_differences, notes)
  values (
    current_order.id,
    current_order.location_id,
    p_status,
    auth.uid(),
    now(),
    case when p_status = 'en_almacen' then now() else null end,
    false,
    nullif(p_notes, '')
  )
  on conflict (purchase_order_id) do update
  set
    status = excluded.status,
    received_by = auth.uid(),
    received_at = case
      when rec.status = 'pendiente' and excluded.status in ('recibida', 'en_almacen') then now()
      else rec.received_at
    end,
    stored_at = case
      when excluded.status = 'en_almacen' then coalesce(rec.stored_at, now())
      when rec.status = 'en_almacen' then rec.stored_at
      else null
    end,
    notes = excluded.notes,
    updated_at = now()
  returning id into v_receipt_id;

  insert into abastecimiento.receipt_items (
    receipt_id,
    purchase_order_item_id,
    product_id,
    requested_quantity,
    received_quantity,
    unit,
    lot_code,
    expires_at,
    unit_cost
  )
  select
    v_receipt_id,
    poi.id,
    poi.product_id,
    poi.quantity,
    greatest(coalesce(payload.received_quantity, 0), 0),
    poi.unit,
    nullif(payload.lot_code, ''),
    payload.expires_at,
    poi.unit_cost
  from jsonb_to_recordset(p_items) as payload(
    purchase_order_item_id uuid,
    received_quantity numeric,
    lot_code text,
    expires_at date
  )
  join abastecimiento.purchase_order_items poi on poi.id = payload.purchase_order_item_id
  where poi.purchase_order_id = current_order.id
  on conflict (purchase_order_item_id) do update
  set
    receipt_id = excluded.receipt_id,
    requested_quantity = excluded.requested_quantity,
    received_quantity = excluded.received_quantity,
    unit = excluded.unit,
    lot_code = excluded.lot_code,
    expires_at = excluded.expires_at,
    unit_cost = excluded.unit_cost;

  update abastecimiento.receipts rec
  set has_differences = exists (
    select 1
    from abastecimiento.receipt_items rit
    where rit.receipt_id = v_receipt_id
      and coalesce(rit.received_quantity, 0) <> coalesce(rit.requested_quantity, 0)
  )
  where rec.id = v_receipt_id;

  return public.get_abastecimiento_receiving_order(current_order.id);
end;
$function$;

create or replace function public.list_abastecimiento_inventory_items(
  p_date_from date default null,
  p_date_to date default null
)
returns table(
  receipt_id uuid,
  receipt_item_id uuid,
  receipt_folio text,
  purchase_order_id uuid,
  purchase_folio text,
  requisition_id uuid,
  requisition_folio text,
  location_id uuid,
  location_name text,
  stored_at timestamp with time zone,
  received_at timestamp with time zone,
  product_id uuid,
  product text,
  brand text,
  presentation text,
  image_url text,
  unit text,
  received_quantity numeric,
  unit_cost numeric,
  total_cost numeric,
  lot_code text,
  expires_at date,
  almacen text,
  warehouse_id uuid,
  warehouse_name text,
  warehouse_address text,
  rack_id uuid,
  rack_name text,
  rack_position text,
  storage_type text,
  category_id uuid,
  category_name text,
  delicate_management boolean,
  product_note text
)
language sql
stable
set search_path to 'public', 'abastecimiento', 'pg_temp'
as $function$
  select
    rec.id as receipt_id,
    rit.id as receipt_item_id,
    rec.folio as receipt_folio,
    po.id as purchase_order_id,
    po.folio as purchase_folio,
    req.id as requisition_id,
    req.folio as requisition_folio,
    rec.location_id,
    loc.name::text as location_name,
    coalesce(rec.stored_at, rec.updated_at, rec.received_at) as stored_at,
    rec.received_at,
    rit.product_id,
    inv.product,
    inv.brand,
    inv.presentation,
    inv.image_url,
    coalesce(rit.unit, inv.unit) as unit,
    rit.received_quantity,
    coalesce(rit.unit_cost, inv.total_price, inv.unit_price, 0) as unit_cost,
    (rit.received_quantity * coalesce(rit.unit_cost, inv.total_price, inv.unit_price, 0))::numeric as total_cost,
    rit.lot_code,
    rit.expires_at,
    inv.almacen,
    inv.warehouse_id,
    wh.name as warehouse_name,
    wh.address as warehouse_address,
    inv.rack_id,
    rack.name as rack_name,
    rack.position as rack_position,
    rack.storage_type,
    inv.category_id,
    cat.name as category_name,
    coalesce(inv.delicate_management, false) as delicate_management,
    inv.note as product_note
  from abastecimiento.receipts rec
  join abastecimiento.receipt_items rit on rit.receipt_id = rec.id
  join abastecimiento.purchase_orders po on po.id = rec.purchase_order_id
  join abastecimiento.requisitions req on req.id = po.requisition_id
  join public.locations loc on loc.id = rec.location_id
  join public.inventory inv on inv.id = rit.product_id
  left join public.inventory_warehouses wh on wh.id = inv.warehouse_id
  left join public.inventory_racks rack on rack.id = inv.rack_id
  left join public.inventory_categories cat on cat.id = inv.category_id
  where rec.status = 'en_almacen'
    and abastecimiento.can_access_location(rec.location_id)
    and (
      p_date_from is null
      or (timezone('America/Mexico_City', coalesce(rec.stored_at, rec.updated_at, rec.received_at)))::date >= p_date_from
    )
    and (
      p_date_to is null
      or (timezone('America/Mexico_City', coalesce(rec.stored_at, rec.updated_at, rec.received_at)))::date <= p_date_to
    )
  order by coalesce(rec.stored_at, rec.updated_at, rec.received_at) desc, inv.product;
$function$;
