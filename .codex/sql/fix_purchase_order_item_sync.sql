create or replace function abastecimiento.sync_purchase_order_for_requisition(p_requisition_id uuid)
returns uuid
language plpgsql
set search_path to 'public', 'abastecimiento', 'pg_temp'
as $function$
declare
  current_req abastecimiento.requisitions%rowtype;
  v_purchase_order_id uuid;
  v_purchase_status text;
  purchase_status text;
  subtotal_value numeric;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para preparar la orden de compra.' using errcode = '28000';
  end if;

  select * into current_req
  from abastecimiento.requisitions
  where id = p_requisition_id;

  if not found then
    raise exception 'No se encontró la requisición.' using errcode = '02000';
  end if;

  if current_req.status not in ('aprobado', 'completado') then
    raise exception 'Solo las requisiciones aprobadas pasan a compras.' using errcode = '42501';
  end if;

  if not abastecimiento.can_manage_purchases(current_req.location_id) then
    raise exception 'No tienes permiso para preparar compras de esta sucursal.' using errcode = '42501';
  end if;

  select coalesce(sum(ri.quantity * coalesce(inv.total_price, inv.unit_price, 0)), 0)
  into subtotal_value
  from abastecimiento.requisition_items ri
  join public.inventory inv on inv.id = ri.product_id
  where ri.requisition_id = current_req.id;

  purchase_status := case
    when current_req.status = 'completado' then 'completado'
    when current_req.request_type = 'urgente' then 'urgente'
    else 'pendiente'
  end;

  insert into abastecimiento.purchase_orders (requisition_id, location_id, status, ordered_by, ordered_at, subtotal, tax, notes)
  values (current_req.id, current_req.location_id, purchase_status, auth.uid(), coalesce(current_req.approved_at, now()), subtotal_value, 0, current_req.notes)
  on conflict (requisition_id) do update
  set
    location_id = excluded.location_id,
    subtotal = excluded.subtotal,
    tax = excluded.tax,
    notes = excluded.notes,
    status = case
      when abastecimiento.purchase_orders.status in ('aprobado', 'completado') then abastecimiento.purchase_orders.status
      else excluded.status
    end,
    approved_by = case
      when abastecimiento.purchase_orders.status in ('aprobado', 'completado') then abastecimiento.purchase_orders.approved_by
      else null
    end,
    approved_at = case
      when abastecimiento.purchase_orders.status in ('aprobado', 'completado') then abastecimiento.purchase_orders.approved_at
      else null
    end,
    updated_at = now()
  returning id, status into v_purchase_order_id, v_purchase_status;

  if v_purchase_status not in ('aprobado', 'completado') then
    delete from abastecimiento.purchase_order_items poi
    where poi.purchase_order_id = v_purchase_order_id;

    insert into abastecimiento.purchase_order_items (purchase_order_id, requisition_item_id, product_id, quantity, unit, unit_cost)
    select
      v_purchase_order_id,
      ri.id,
      ri.product_id,
      ri.quantity,
      coalesce(ri.unit, inv.unit),
      coalesce(inv.total_price, inv.unit_price, 0)
    from abastecimiento.requisition_items ri
    join public.inventory inv on inv.id = ri.product_id
    where ri.requisition_id = current_req.id;
  else
    insert into abastecimiento.purchase_order_items (purchase_order_id, requisition_item_id, product_id, quantity, unit, unit_cost)
    select
      v_purchase_order_id,
      ri.id,
      ri.product_id,
      ri.quantity,
      coalesce(ri.unit, inv.unit),
      coalesce(inv.total_price, inv.unit_price, 0)
    from abastecimiento.requisition_items ri
    join public.inventory inv on inv.id = ri.product_id
    where ri.requisition_id = current_req.id
      and not exists (
        select 1
        from abastecimiento.purchase_order_items existing
        where existing.purchase_order_id = v_purchase_order_id
          and existing.requisition_item_id = ri.id
      );
  end if;

  return v_purchase_order_id;
end;
$function$;

insert into abastecimiento.purchase_order_items (purchase_order_id, requisition_item_id, product_id, quantity, unit, unit_cost)
select
  po.id,
  ri.id,
  ri.product_id,
  ri.quantity,
  coalesce(ri.unit, inv.unit),
  coalesce(inv.total_price, inv.unit_price, 0)
from abastecimiento.purchase_orders po
join abastecimiento.requisitions req on req.id = po.requisition_id
join abastecimiento.requisition_items ri on ri.requisition_id = req.id
join public.inventory inv on inv.id = ri.product_id
where req.status in ('aprobado', 'completado')
  and po.status in ('aprobado', 'completado')
  and not exists (
    select 1
    from abastecimiento.purchase_order_items existing
    where existing.purchase_order_id = po.id
      and existing.requisition_item_id = ri.id
  );
