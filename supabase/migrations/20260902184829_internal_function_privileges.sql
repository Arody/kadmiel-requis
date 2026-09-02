-- Default function grants in this project include authenticated. Internal
-- helpers must only be reachable through policies, triggers and public RPCs.
do $migration$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'abastecimiento'
      and p.proname = any(array[
        'normalized_workflow_text', 'event_location_capabilities',
        'claim_workflow_command', 'finish_workflow_command',
        'prevent_append_only_mutation', 'emit_domain_event',
        'bump_workflow_version', 'capture_domain_event',
        'capture_production_catalog_event', 'prevent_user_role_reassignment',
        'sync_purchase_order_for_requisition', 'claim_merma_pv_product',
        'normalize_raw_movement', 'guard_immutable_keys',
        'raw_inventory_balance', 'raw_inventory_min_balance_from',
        'ledger_receipt_stored', 'ledger_production_consumption',
        'ledger_stock_lot', 'guard_waste_inventory', 'ledger_waste_entry',
        'ledger_merma_pv_item', 'ledger_transfer_status',
        'guard_transfer_workflow', 'guard_transfer_items',
        'process_lot_recipe_consumption',
        'save_abastecimiento_production_lot_internal',
        'update_abastecimiento_production_lot_internal',
        'delete_abastecimiento_production_lot_internal'
      ])
  loop
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated',
      v_function
    );
  end loop;
end;
$migration$;

grant execute on function abastecimiento.has_workflow_permission(text, uuid) to authenticated;
grant execute on function abastecimiento.can_receive_location_event(uuid) to authenticated;
grant execute on function abastecimiento.can_receive_location_event(uuid, text) to authenticated;
grant execute on function abastecimiento.can_access_location(uuid) to authenticated;
grant execute on function abastecimiento.can_manage_location(uuid) to authenticated;
grant execute on function abastecimiento.can_manage_purchases(uuid) to authenticated;
grant execute on function abastecimiento.has_any_workflow_role() to authenticated;
