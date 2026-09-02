begin;

create temporary table realtime_smoke_context on commit drop as
select
  first_admin.user_id,
  second_admin.user_id as management_user_id,
  stocked_product.location_id,
  stocked_product.product_id,
  gen_random_uuid() as no_role_user_id
from lateral (
  select ur.user_id
  from public.user_roles ur
  where ur.role = 'super_admin'::public.app_role
  order by ur.created_at
  limit 1
) first_admin
cross join lateral (
  select ur.user_id
  from public.user_roles ur
  where ur.role = 'super_admin'::public.app_role
    and ur.user_id <> first_admin.user_id
  order by ur.created_at
  limit 1
) second_admin
cross join lateral (
  select il.location_id, inv.id as product_id
  from public.inventory_locations il
  join public.inventory inv on inv.id = il.inventory_id
  where inv.base_unit is not null
    and inv.base_quantity_per_presentation is not null
  order by il.location_id, inv.id
  limit 1
) stocked_product;

grant select on realtime_smoke_context to authenticated;

select set_config('request.jwt.claim.sub', context.user_id::text, true)
from realtime_smoke_context context;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', context.user_id, 'role', 'authenticated')::text,
  true
)
from realtime_smoke_context context;

set local role authenticated;

do $test$
declare
  v_user_id uuid;
  v_management_user_id uuid;
  v_location_id uuid;
  v_product_id uuid;
  v_requisition_id uuid;
  v_replayed_id uuid;
  v_purchase_order_id uuid;
  v_cancel_requisition_id uuid;
  v_cancel_purchase_order_id uuid;
  v_receipt_id uuid;
  v_command_id uuid;
  v_payload jsonb;
  v_zero_payload jsonb;
  v_invalid_payload jsonb;
  v_version integer;
  v_status text;
begin
  select context.user_id, context.management_user_id,
         context.location_id, context.product_id
  into v_user_id, v_management_user_id, v_location_id, v_product_id
  from realtime_smoke_context context;

  if v_user_id is null or v_management_user_id is null or v_location_id is null or v_product_id is null then
    raise exception 'El smoke test necesita dos super_admin y un producto normalizado asignado a una sucursal.';
  end if;

  if not exists (select 1 from public.user_roles where user_id = v_user_id) then
    raise exception 'La policy de user_roles ocultó el rol propio.';
  end if;

  v_command_id := gen_random_uuid();
  v_payload := jsonb_build_array(jsonb_build_object(
    'product_id', v_product_id,
    'quantity', 1,
    'unit', '',
    'notes', 'smoke test'
  ));

  begin
    perform public.create_abastecimiento_requisition_v2(
      v_location_id, null, 'ordinaria', current_date, 'smoke null', null, gen_random_uuid()
    );
    raise exception 'Se aceptó una requisición sin partidas.';
  exception when invalid_parameter_value then
    null;
  end;

  v_requisition_id := public.create_abastecimiento_requisition_v2(
    v_location_id, null, 'ordinaria', current_date, 'smoke test', v_payload, v_command_id
  );
  v_replayed_id := public.create_abastecimiento_requisition_v2(
    v_location_id, null, 'ordinaria', current_date, 'smoke test', v_payload, v_command_id
  );
  if v_replayed_id <> v_requisition_id then
    raise exception 'La creación idempotente devolvió dos requisiciones.';
  end if;
  begin
    perform public.create_abastecimiento_requisition_v2(
      v_location_id, null, 'ordinaria', current_date, 'payload distinto', v_payload, v_command_id
    );
    raise exception 'Una clave idempotente aceptó contenido distinto.';
  exception when invalid_parameter_value then
    null;
  end;

  perform public.update_abastecimiento_requisition_status_v2(
    v_requisition_id, 'revisando_compras', null, gen_random_uuid(), 1
  );

  begin
    perform public.update_abastecimiento_requisition_status_v2(
      v_requisition_id, 'aprobada_compras', null, gen_random_uuid(), 1
    );
    raise exception 'Se aceptó una versión obsoleta de requisición.';
  exception when serialization_failure then
    null;
  end;

  begin
    perform public.update_abastecimiento_requisition_status_v2(
      v_requisition_id, 'aprobada_compras', null, gen_random_uuid(), null
    );
    raise exception 'Se aceptó una versión NULL de requisición.';
  exception when serialization_failure then
    null;
  end;

  perform public.update_abastecimiento_requisition_status_v2(
    v_requisition_id, 'aprobada_compras', null, gen_random_uuid(), 2
  );

  select id, version into v_purchase_order_id, v_version
  from abastecimiento.purchase_orders where requisition_id = v_requisition_id;
  if v_purchase_order_id is null or v_version <> 1 then
    raise exception 'La aprobación no creó una orden versionada.';
  end if;

  perform public.update_abastecimiento_purchase_order_status_v2(
    v_purchase_order_id, 'rechazar', 'smoke test', gen_random_uuid(), 1
  );
  select jsonb_agg(jsonb_build_object(
    'purchase_order_item_id', poi.id,
    'quantity', null,
    'unit_cost', poi.unit_cost
  )) into v_invalid_payload
  from abastecimiento.purchase_order_items poi
  where poi.purchase_order_id = v_purchase_order_id;
  begin
    perform public.update_abastecimiento_purchase_order_v2(
      v_purchase_order_id, v_invalid_payload, 'smoke test', gen_random_uuid(), 2
    );
    raise exception 'Se aceptó una partida de compra con cantidad NULL.';
  exception when invalid_parameter_value then
    null;
  end;

  select jsonb_agg(jsonb_build_object(
    'purchase_order_item_id', poi.id,
    'quantity', poi.quantity,
    'unit_cost', poi.unit_cost
  )) into v_payload
  from abastecimiento.purchase_order_items poi
  where poi.purchase_order_id = v_purchase_order_id;
  perform public.update_abastecimiento_purchase_order_v2(
    v_purchase_order_id, v_payload, 'edición tras rechazo', gen_random_uuid(), 2
  );
  perform public.update_abastecimiento_purchase_order_status_v2(
    v_purchase_order_id, 'reenviar', null, gen_random_uuid(), 3
  );

  perform public.update_abastecimiento_purchase_order_status_v2(
    v_purchase_order_id, 'aprobar_contabilidad', null, gen_random_uuid(), 4
  );

  begin
    perform public.update_abastecimiento_purchase_order_status_v2(
      v_purchase_order_id, 'aprobar_gerencia', null, gen_random_uuid(), 5
    );
    raise exception 'Una misma cuenta aprobó Contabilidad y Gerencia.';
  exception when insufficient_privilege then
    null;
  end;

  perform set_config('request.jwt.claim.sub', v_management_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_management_user_id, 'role', 'authenticated')::text,
    true
  );
  perform public.update_abastecimiento_purchase_order_status_v2(
    v_purchase_order_id, 'aprobar_gerencia', null, gen_random_uuid(), 5
  );

  select status into v_status from abastecimiento.purchase_orders where id = v_purchase_order_id;
  if v_status <> 'aprobado' then
    raise exception 'La aprobación dual no dejó la orden aprobada.';
  end if;
  if exists (
    select 1 from abastecimiento.receipts where purchase_order_id = v_purchase_order_id
  ) then
    raise exception 'La aprobación creó una recepción pendiente con fecha ficticia.';
  end if;

  select jsonb_agg(jsonb_build_object(
    'purchase_order_item_id', poi.id,
    'received_quantity', poi.quantity,
    'lot_code', 'SMOKE',
    'expires_at', null
  )) into v_payload
  from abastecimiento.purchase_order_items poi
  where poi.purchase_order_id = v_purchase_order_id;

  v_command_id := gen_random_uuid();
  perform public.save_abastecimiento_receipt_v2(
    v_purchase_order_id, 'recibida', v_payload, 'smoke test', v_command_id, 0
  );
  perform public.save_abastecimiento_receipt_v2(
    v_purchase_order_id, 'recibida', v_payload, 'smoke test', v_command_id, 0
  );

  select id, version into v_receipt_id, v_version
  from abastecimiento.receipts where purchase_order_id = v_purchase_order_id;
  if v_receipt_id is null or v_version <> 1 then
    raise exception 'La recepción inicial no es idempotente o tiene versión incorrecta.';
  end if;

  select jsonb_agg(jsonb_build_object(
    'purchase_order_item_id', poi.id,
    'received_quantity', 0,
    'lot_code', 'SMOKE',
    'expires_at', null
  )) into v_zero_payload
  from abastecimiento.purchase_order_items poi
  where poi.purchase_order_id = v_purchase_order_id;

  begin
    perform public.save_abastecimiento_receipt_v2(
      v_purchase_order_id, 'en_almacen', v_zero_payload, 'smoke test', gen_random_uuid(), 1
    );
    raise exception 'Se cerró una recepción sin mercancía.';
  exception when invalid_parameter_value then
    null;
  end;

  perform public.save_abastecimiento_receipt_v2(
    v_purchase_order_id, 'en_almacen', v_payload, 'smoke test', gen_random_uuid(), 1
  );

  if not exists (
    select 1
    from abastecimiento.purchase_orders po
    join abastecimiento.requisitions r on r.id = po.requisition_id
    where po.id = v_purchase_order_id
      and po.status = 'completado'
      and r.status = 'completado'
  ) then
    raise exception 'El ingreso a almacén no cerró la orden y la requisición.';
  end if;

  v_cancel_requisition_id := public.create_abastecimiento_requisition_v2(
    v_location_id, null, 'ordinaria', current_date, 'smoke cancel',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'quantity', 1,
      'unit', '',
      'notes', 'smoke cancel'
    )),
    gen_random_uuid()
  );
  perform public.update_abastecimiento_requisition_status_v2(
    v_cancel_requisition_id, 'revisando_compras', null, gen_random_uuid(), 1
  );
  perform public.update_abastecimiento_requisition_status_v2(
    v_cancel_requisition_id, 'aprobada_compras', null, gen_random_uuid(), 2
  );
  select id into v_cancel_purchase_order_id
  from abastecimiento.purchase_orders
  where requisition_id = v_cancel_requisition_id;
  perform public.update_abastecimiento_purchase_order_status_v2(
    v_cancel_purchase_order_id, 'cancelar', 'smoke cancel', gen_random_uuid(), 1
  );
  if not exists (
    select 1
    from abastecimiento.purchase_orders po
    join abastecimiento.requisitions req on req.id = po.requisition_id
    where po.id = v_cancel_purchase_order_id
      and po.status = 'cancelado'
      and req.status = 'cancelada_compras'
  ) then
    raise exception 'Cancelar la orden no cerró también la requisición.';
  end if;
  if not exists (
    select 1
    from public.list_abastecimiento_purchase_orders_v2() listed
    where listed.id = v_cancel_purchase_order_id
  ) then
    raise exception 'La orden cancelada desapareció del historial de compras.';
  end if;

  if not exists (
    select 1 from abastecimiento.inventory_movements
    where source_table = 'abastecimiento.receipts'
      and source_id = v_receipt_id
      and movement_type = 'receipt_stored'
      and quantity_delta > 0
      and affects_balance
  ) then
    raise exception 'El ingreso a almacén no quedó en el kardex.';
  end if;
  begin
    update abastecimiento.inventory_movements
    set quantity_delta = quantity_delta + 1
    where source_table = 'abastecimiento.receipts' and source_id = v_receipt_id;
    raise exception 'El kardex permitió modificar su historial.';
  exception when insufficient_privilege or object_not_in_prerequisite_state then
    null;
  end;
  if (select count(*) from abastecimiento.domain_events where aggregate_id = v_requisition_id) < 3 then
    raise exception 'No se capturó el ciclo de eventos de la requisición.';
  end if;
  if exists (
    select 1
    from abastecimiento.merma_pv_items mi
    join public.productos product on product.id = mi.finished_product_id
    where mi.merma_quantity > 0
      and not exists (
        select 1 from abastecimiento.inventory_movements movement
        where movement.source_table = 'abastecimiento.merma_pv_items'
          and movement.source_line_id = mi.id
          and movement.movement_type = 'merma_pv'
          and movement.quantity_delta = -mi.merma_quantity
      )
  ) then
    raise exception 'La merma PV histórica no quedó en el kardex.';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.save_abastecimiento_production_lot(uuid,date,jsonb,text)',
    'EXECUTE'
  ) then
    raise exception 'El RPC legado de producción conserva EXECUTE.';
  end if;
  if has_table_privilege('authenticated', 'abastecimiento.production_lots', 'INSERT,UPDATE,DELETE') then
    raise exception 'Producción conserva DML directo para authenticated.';
  end if;
  if exists (
    select 1
    from unnest(array[
      'abastecimiento.requisitions',
      'abastecimiento.requisition_items',
      'abastecimiento.purchase_orders',
      'abastecimiento.purchase_order_items',
      'abastecimiento.receipts',
      'abastecimiento.receipt_items',
      'abastecimiento.transfers',
      'abastecimiento.transfer_items',
      'abastecimiento.waste_entries',
      'abastecimiento.stock_lots'
    ]) as protected(table_name)
    where has_table_privilege('authenticated', protected.table_name, 'INSERT,UPDATE,DELETE')
  ) then
    raise exception 'Un flujo autoritativo conserva DML directo para authenticated.';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.update_abastecimiento_production_lot_v2(uuid,jsonb,text,uuid,integer)',
    'EXECUTE'
  ) then
    raise exception 'Falta permiso para el RPC V2 de producción.';
  end if;
  if has_function_privilege(
    'authenticated',
    'abastecimiento.emit_domain_event(text,text,uuid,integer,uuid,uuid,uuid,text,text,jsonb,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated puede forjar eventos internos.';
  end if;
  if has_function_privilege(
    'authenticated',
    'abastecimiento.finish_workflow_command(text,uuid,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated puede finalizar comandos internos.';
  end if;
  if not has_function_privilege(
    'authenticated',
    'abastecimiento.has_workflow_permission(text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Las policies perdieron el helper de autorización.';
  end if;
end;
$test$;

reset role;
select set_config('request.jwt.claim.sub', context.no_role_user_id::text, true)
from realtime_smoke_context context;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', context.no_role_user_id, 'role', 'authenticated')::text,
  true
)
from realtime_smoke_context context;
set local role authenticated;

do $test$
begin
  if exists (select 1 from public.user_roles) then
    raise exception 'Un usuario sin rol pudo leer el directorio de roles.';
  end if;
  if exists (select 1 from abastecimiento.domain_events) then
    raise exception 'Un usuario sin rol pudo leer eventos globales.';
  end if;

  begin
    perform public.list_abastecimiento_pending_quality_items(
      null, current_date, gen_random_uuid()
    );
    raise exception 'Un usuario sin rol pudo consultar un lote sin validar su sucursal real.';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.list_abastecimiento_quality_products_for_merma(
      null, current_date, gen_random_uuid()
    );
    raise exception 'Un usuario sin rol pudo consultar una verificación sin validar su sucursal real.';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.list_abastecimiento_quality_products_for_merma(
      null, current_date, null
    );
    raise exception 'Un usuario sin rol pudo consultar el consolidado global de Calidad.';
  exception when insufficient_privilege then
    null;
  end;
end;
$test$;

reset role;

do $test$
declare
  v_location_id uuid;
  v_inventory_id uuid;
  v_unit text;
  v_before numeric;
  v_minimum numeric;
begin
  select il.location_id, inventory.id, inventory.base_unit
  into v_location_id, v_inventory_id, v_unit
  from public.inventory_locations il
  join public.inventory inventory on inventory.id = il.inventory_id
  where inventory.base_unit in ('g', 'ml', 'pieza')
  limit 1;

  v_before := abastecimiento.raw_inventory_balance(
    v_location_id, v_inventory_id, v_unit, null
  );
  insert into abastecimiento.inventory_movements(
    location_id, inventory_id, quantity_delta, unit, effective_date,
    affects_balance, movement_type, source_table, source_id
  ) values
    (v_location_id, v_inventory_id, 10, v_unit, date '9999-12-28', true, 'reversal', 'smoke.temporal', gen_random_uuid()),
    (v_location_id, v_inventory_id, -9, v_unit, date '9999-12-29', true, 'reversal', 'smoke.temporal', gen_random_uuid()),
    (v_location_id, v_inventory_id, 20, v_unit, date '9999-12-30', true, 'reversal', 'smoke.temporal', gen_random_uuid());

  v_minimum := abastecimiento.raw_inventory_min_balance_from(
    v_location_id, v_inventory_id, v_unit, date '9999-12-28'
  );
  if abs(v_minimum - (v_before + 1)) > 0.000001 then
    raise exception 'El guard temporal esperaba %, obtuvo %.', v_before + 1, v_minimum;
  end if;
end;
$test$;

set local role service_role;

do $test$
declare
  v_outbox_id uuid;
  v_claimed_id uuid;
  v_claim_token uuid;
  v_retry_at timestamptz;
begin
  insert into wp_data.message_outbox(to_phone, body, status, created_at)
  values ('520000000000', 'smoke test', 'pending', now() - interval '100 years')
  returning id into v_outbox_id;

  select claimed.id, claimed.claim_token
  into v_claimed_id, v_claim_token
  from public.wp_gw_claim_messages_v2(1, 4) claimed;
  if v_claimed_id is distinct from v_outbox_id or v_claim_token is null then
    raise exception 'La cola no entregó un lease identificable.';
  end if;
  if public.wp_gw_mark_sent_v2(v_outbox_id, gen_random_uuid()) then
    raise exception 'La cola aceptó un token de lease ajeno.';
  end if;
  if not public.wp_gw_mark_sent_v2(v_outbox_id, v_claim_token) then
    raise exception 'La cola no confirmó el lease vigente.';
  end if;

  insert into wp_data.message_outbox(to_phone, body, status, created_at)
  values ('520000000001', 'smoke retry', 'pending', now() - interval '99 years')
  returning id into v_outbox_id;
  select claimed.id, claimed.claim_token
  into v_claimed_id, v_claim_token
  from public.wp_gw_claim_messages_v2(1, 4) claimed;
  if not public.wp_gw_mark_failed_v2(v_claimed_id, v_claim_token, 'smoke retry', 4) then
    raise exception 'La cola no liberó el lease fallido.';
  end if;
  select next_attempt_at into v_retry_at
  from wp_data.message_outbox where id = v_outbox_id and status = 'pending';
  if v_retry_at is null or v_retry_at <= now() then
    raise exception 'La cola reintentaría inmediatamente sin backoff.';
  end if;
end;
$test$;

reset role;
rollback;
