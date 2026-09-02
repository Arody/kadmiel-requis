-- Apply after the Netlify frontend uses the versioned/idempotent RPCs.
-- Notification triggers can now dedupe by the command id set by those RPCs.
do $migration$
declare
  v_definition text;
begin
  for v_definition in
    select pg_get_functiondef(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'wp_data'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ilike '%on conflict (event_type, ref_id, recipient_employee_id) do nothing%'
  loop
    execute regexp_replace(
      v_definition,
      'on conflict\s*\(event_type, ref_id, recipient_employee_id\)\s*do nothing',
      'on conflict do nothing',
      'gi'
    );
  end loop;
end;
$migration$;

alter table wp_data.message_outbox
  drop constraint if exists message_outbox_event_type_ref_id_recipient_employee_id_key;

revoke execute on function public.create_abastecimiento_requisition(uuid, uuid, text, date, text, jsonb) from public, anon, authenticated;
revoke execute on function public.update_abastecimiento_requisition(uuid, uuid, uuid, text, date, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.update_abastecimiento_requisition_status(uuid, text) from public, anon, authenticated;
revoke execute on function public.update_abastecimiento_purchase_order_status(uuid, text) from public, anon, authenticated;
revoke execute on function public.save_abastecimiento_receipt(uuid, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.save_abastecimiento_quality_verification(uuid, date, jsonb, uuid, text) from public, anon, authenticated;
revoke execute on function public.save_abastecimiento_merma_pv(uuid, date, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.save_abastecimiento_production_lot(uuid, date, jsonb, text) from public, anon, authenticated;
revoke execute on function public.save_abastecimiento_production_lot_idempotent(uuid, date, jsonb, text, uuid) from public, anon, authenticated;
revoke execute on function public.update_abastecimiento_production_lot(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.delete_abastecimiento_production_lot(uuid) from public, anon, authenticated;

revoke insert, update, delete on abastecimiento.requisitions from public, anon, authenticated;
revoke insert, update, delete on abastecimiento.requisition_items from public, anon, authenticated;
revoke insert, update, delete on abastecimiento.purchase_orders from public, anon, authenticated;
revoke insert, update, delete on abastecimiento.purchase_order_items from public, anon, authenticated;
revoke insert, update, delete on abastecimiento.receipts from public, anon, authenticated;
revoke insert, update, delete on abastecimiento.receipt_items from public, anon, authenticated;
revoke insert, update, delete on abastecimiento.transfers from public, anon, authenticated;
revoke insert, update, delete on abastecimiento.transfer_items from public, anon, authenticated;
revoke insert, update, delete on abastecimiento.waste_entries from public, anon, authenticated;
revoke insert, update, delete on abastecimiento.production_lots from public, anon, authenticated;
revoke insert, update, delete on abastecimiento.production_lot_items from public, anon, authenticated;
revoke insert, update, delete on abastecimiento.production_lot_consumptions from public, anon, authenticated;
revoke insert, update, delete on abastecimiento.stock_lots from public, anon, authenticated;
