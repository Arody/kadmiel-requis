-- Protect retroactive production against an intermediate historical stock dip.
create or replace function abastecimiento.raw_inventory_min_balance_from(
  p_location_id uuid,
  p_inventory_id uuid,
  p_base_unit text,
  p_effective_from date
)
returns numeric
language sql
stable
set search_path = ''
as $function$
  with daily as (
    select movement.effective_date, sum(movement.quantity_delta) as quantity_delta
    from abastecimiento.inventory_movements movement
    where movement.affects_balance
      and movement.inventory_id is not null
      and movement.location_id = p_location_id
      and movement.inventory_id = p_inventory_id
      and movement.unit = p_base_unit
    group by movement.effective_date
  ), running as (
    select effective_date, sum(quantity_delta) over (
      order by effective_date rows unbounded preceding
    ) as balance
    from daily
  ), effective_balance as (
    select abastecimiento.raw_inventory_balance(
      p_location_id, p_inventory_id, p_base_unit, p_effective_from
    ) as balance
  )
  select least(
    effective_balance.balance,
    coalesce(
      (select min(running.balance) from running where running.effective_date >= p_effective_from),
      effective_balance.balance
    )
  )
  from effective_balance;
$function$;

revoke all on function abastecimiento.raw_inventory_min_balance_from(uuid, uuid, text, date)
from public, anon, authenticated;

do $migration$
declare
  v_definition text;
  v_needle text := E'    select least(\n      abastecimiento.raw_inventory_balance(\n        v_lot.location_id, v_required.ingredient_id,\n        v_required.unit, v_lot.production_date\n      ),\n      abastecimiento.raw_inventory_balance(\n        v_lot.location_id, v_required.ingredient_id,\n        v_required.unit, null\n      )\n    ) into v_available;';
  v_replacement text := E'    select abastecimiento.raw_inventory_min_balance_from(\n      v_lot.location_id, v_required.ingredient_id,\n      v_required.unit, v_lot.production_date\n    ) into v_available;';
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'abastecimiento.process_lot_recipe_consumption(uuid)'::regprocedure
  );
  if pg_catalog.strpos(v_definition, 'raw_inventory_min_balance_from') = 0 then
    if pg_catalog.strpos(v_definition, v_needle) = 0 then
      raise exception 'No se encontró la validación temporal de inventario esperada.';
    end if;
    execute pg_catalog.replace(v_definition, v_needle, v_replacement);
  end if;
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_needle text := E'  if p_location_id is null\n     or not abastecimiento.has_workflow_permission(''production'', p_location_id) then\n    raise exception ''No tienes permiso de Producción en la sucursal seleccionada.'' using errcode = ''42501'';\n  end if;';
  v_replacement text := v_needle || E'\n  if coalesce(\n    p_production_date,\n    timezone(''America/Mexico_City'', now())::date\n  ) > timezone(''America/Mexico_City'', now())::date then\n    raise exception ''La producción no puede registrarse con una fecha futura.'' using errcode = ''22023'';\n  end if;';
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.save_abastecimiento_production_lot_v2(uuid,date,jsonb,text,uuid)'::regprocedure
  );
  if pg_catalog.strpos(v_definition, 'fecha futura') = 0 then
    if pg_catalog.strpos(v_definition, v_needle) = 0 then
      raise exception 'No se encontró la autorización de producción esperada.';
    end if;
    execute pg_catalog.replace(v_definition, v_needle, v_replacement);
  end if;
end;
$migration$;
