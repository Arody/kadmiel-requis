-- Existing deployments need the same historical cost cutoff now present in
-- inventory_movement_ledger. Fresh databases no-op here.
do $migration$
declare
  v_definition text;
  v_needle text := E'      and receipt.location_id = v_lot.location_id\n    group by receipt_item.product_id, receipt_item.base_unit';
  v_replacement text := E'      and receipt.location_id = v_lot.location_id\n      and timezone(\n        ''America/Mexico_City'',\n        coalesce(receipt.stored_at, receipt.updated_at, receipt.received_at)\n      )::date <= v_lot.production_date\n    group by receipt_item.product_id, receipt_item.base_unit';
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'abastecimiento.process_lot_recipe_consumption(uuid)'::regprocedure
  );
  if pg_catalog.strpos(v_definition, ')::date <= v_lot.production_date') = 0 then
    if pg_catalog.strpos(v_definition, v_needle) = 0 then
      raise exception 'No se encontró el bloque de costo histórico esperado.';
    end if;
    execute pg_catalog.replace(v_definition, v_needle, v_replacement);
  end if;
end;
$migration$;
