-- Base-unit inventory ledger for production receipts and recipe consumption.

create table if not exists abastecimiento.production_lot_consumptions (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references abastecimiento.production_lots(id) on delete cascade,
  lot_item_id uuid references abastecimiento.production_lot_items(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  production_date date not null,
  finished_product_id bigint,
  product_name text not null,
  recipe_id uuid references public.recipes(id) on delete set null,
  recipe_name text,
  ingredient_id uuid,
  ingredient_name text not null,
  quantity_consumed numeric not null default 0,
  unit text not null default 'pieza',
  unit_cost numeric not null default 0,
  total_cost numeric not null default 0,
  is_subrecipe boolean not null default false,
  subrecipe_id uuid,
  subrecipe_name text,
  created_at timestamptz not null default now()
);

alter table abastecimiento.production_lots
  add column if not exists client_request_id uuid;
alter table abastecimiento.production_lot_items
  add column if not exists unit text not null default 'pieza';
create unique index if not exists production_lots_created_by_client_request_idx
  on abastecimiento.production_lots (created_by, client_request_id)
  where client_request_id is not null;

alter table public.inventory
  add column if not exists base_unit text,
  add column if not exists base_quantity_per_presentation numeric,
  add column if not exists base_unit_cost numeric,
  add column if not exists normalization_source text,
  add column if not exists normalization_model text,
  add column if not exists normalized_at timestamptz;

alter table public.inventory drop constraint if exists inventory_base_unit_check;
alter table public.inventory add constraint inventory_base_unit_check
  check (base_unit is null or base_unit in ('g', 'ml', 'pieza'));
alter table public.inventory drop constraint if exists inventory_base_quantity_check;
alter table public.inventory add constraint inventory_base_quantity_check
  check (base_quantity_per_presentation is null or base_quantity_per_presentation > 0);
alter table public.inventory drop constraint if exists inventory_base_unit_cost_check;
alter table public.inventory add constraint inventory_base_unit_cost_check
  check (base_unit_cost is null or base_unit_cost >= 0);
alter table public.inventory drop constraint if exists inventory_normalization_source_check;
alter table public.inventory add constraint inventory_normalization_source_check
  check (normalization_source is null or normalization_source in ('deterministic', 'minimax', 'manual'));

alter table public.recipes
  add column if not exists normalized_output_unit text,
  add column if not exists normalized_output_quantity numeric,
  add column if not exists output_normalization_source text,
  add column if not exists output_normalization_model text,
  add column if not exists output_normalized_at timestamptz;
alter table public.recipes drop constraint if exists recipes_normalized_output_unit_check;
alter table public.recipes add constraint recipes_normalized_output_unit_check
  check (normalized_output_unit is null or normalized_output_unit in ('g', 'ml', 'pieza'));
alter table public.recipes drop constraint if exists recipes_normalized_output_quantity_check;
alter table public.recipes add constraint recipes_normalized_output_quantity_check
  check (normalized_output_quantity is null or normalized_output_quantity > 0);

with costing_outputs as (
  select distinct on ((costing->>'subrecipe_id')::uuid)
    (costing->>'subrecipe_id')::uuid as recipe_id,
    (costing->>'total_weight_g')::numeric as output_quantity
  from public.recipes parent_recipe
  cross join lateral jsonb_array_elements(coalesce(parent_recipe.ai_costing_breakdown->'subrecipes_costing', '[]'::jsonb)) costing
  where coalesce(costing->>'subrecipe_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and coalesce(costing->>'total_weight_g', '') ~ '^[0-9]+([.][0-9]+)?$'
    and (costing->>'total_weight_g')::numeric > 0
  order by (costing->>'subrecipe_id')::uuid, parent_recipe.updated_at desc nulls last
)
update public.recipes recipe set
  normalized_output_unit = 'g',
  normalized_output_quantity = output.output_quantity,
  output_normalization_source = 'minimax',
  output_normalization_model = 'MiniMax-M3',
  output_normalized_at = now()
from costing_outputs output
where recipe.id = output.recipe_id
  and recipe.normalized_output_quantity is null;

create or replace function abastecimiento.sync_recipe_output_normalizations_from_costing()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'abastecimiento', 'pg_temp'
as $$
declare
  v_costing jsonb;
begin
  for v_costing in
    select value from jsonb_array_elements(coalesce(new.ai_costing_breakdown->'subrecipes_costing', '[]'::jsonb))
  loop
    if coalesce(v_costing->>'subrecipe_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and coalesce(v_costing->>'total_weight_g', '') ~ '^[0-9]+([.][0-9]+)?$'
       and (v_costing->>'total_weight_g')::numeric > 0 then
      update public.recipes set
        normalized_output_unit = 'g',
        normalized_output_quantity = (v_costing->>'total_weight_g')::numeric,
        output_normalization_source = 'minimax',
        output_normalization_model = 'MiniMax-M3',
        output_normalized_at = now()
      where id = (v_costing->>'subrecipe_id')::uuid;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists sync_recipe_output_normalizations_from_costing on public.recipes;
create trigger sync_recipe_output_normalizations_from_costing
after insert or update of ai_costing_breakdown on public.recipes
for each row execute function abastecimiento.sync_recipe_output_normalizations_from_costing();

alter table abastecimiento.receipt_items
  add column if not exists base_unit text,
  add column if not exists base_quantity_per_presentation numeric,
  add column if not exists received_base_quantity numeric,
  add column if not exists base_unit_cost numeric,
  add column if not exists normalization_source text,
  add column if not exists normalized_at timestamptz;

alter table abastecimiento.receipt_items drop constraint if exists receipt_items_base_unit_check;
alter table abastecimiento.receipt_items add constraint receipt_items_base_unit_check
  check (base_unit is null or base_unit in ('g', 'ml', 'pieza'));
alter table abastecimiento.receipt_items drop constraint if exists receipt_items_base_quantity_check;
alter table abastecimiento.receipt_items add constraint receipt_items_base_quantity_check
  check (base_quantity_per_presentation is null or base_quantity_per_presentation > 0);
alter table abastecimiento.receipt_items drop constraint if exists receipt_items_received_base_quantity_check;
alter table abastecimiento.receipt_items add constraint receipt_items_received_base_quantity_check
  check (received_base_quantity is null or received_base_quantity >= 0);
alter table abastecimiento.receipt_items drop constraint if exists receipt_items_base_unit_cost_check;
alter table abastecimiento.receipt_items add constraint receipt_items_base_unit_cost_check
  check (base_unit_cost is null or base_unit_cost >= 0);

alter table abastecimiento.production_lot_consumptions
  add column if not exists affects_inventory boolean not null default false;
alter table abastecimiento.production_lot_consumptions
  alter column affects_inventory set default true;

create index if not exists production_lot_consumptions_inventory_balance_idx
  on abastecimiento.production_lot_consumptions (location_id, ingredient_id, unit)
  where affects_inventory;
create index if not exists receipt_items_inventory_balance_idx
  on abastecimiento.receipt_items (product_id, base_unit)
  where received_base_quantity is not null;

create or replace function abastecimiento.canonical_base_unit(p_unit text)
returns text
language plpgsql
immutable
set search_path = 'pg_catalog', 'pg_temp'
as $$
declare
  v_unit text := lower(regexp_replace(trim(coalesce(p_unit, '')), '[.]', '', 'g'));
begin
  if v_unit in ('mg', 'miligramo', 'miligramos', 'g', 'gr', 'gramo', 'gramos', 'kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos', 'oz', 'onza', 'onzas', 'lb', 'libra', 'libras') then
    return 'g';
  end if;
  if v_unit in ('ml', 'mililitro', 'mililitros', 'cc', 'cl', 'dl', 'l', 'lt', 'lts', 'litro', 'litros') then
    return 'ml';
  end if;
  if v_unit in ('pieza', 'piezas', 'pz', 'pza', 'pzas', 'unidad', 'unidades', 'ud', 'hoja', 'hojas') then
    return 'pieza';
  end if;
  raise exception 'Unidad no compatible: "%". Usa g, ml o pieza.', coalesce(nullif(trim(p_unit), ''), '(vacía)') using errcode = '22023';
end;
$$;

create or replace function abastecimiento.to_base_quantity(p_quantity numeric, p_unit text)
returns numeric
language plpgsql
immutable
set search_path = 'pg_catalog', 'pg_temp'
as $$
declare
  v_unit text := lower(regexp_replace(trim(coalesce(p_unit, '')), '[.]', '', 'g'));
begin
  if p_quantity is null or p_quantity < 0 then
    raise exception 'La cantidad debe ser mayor o igual a cero.' using errcode = '22023';
  end if;
  return p_quantity * case
    when v_unit in ('mg', 'miligramo', 'miligramos') then 0.001
    when v_unit in ('kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos') then 1000
    when v_unit in ('oz', 'onza', 'onzas') then 28.349523125
    when v_unit in ('lb', 'libra', 'libras') then 453.59237
    when v_unit in ('l', 'lt', 'lts', 'litro', 'litros') then 1000
    when v_unit = 'cl' then 10
    when v_unit = 'dl' then 100
    when v_unit in ('g', 'gr', 'gramo', 'gramos', 'ml', 'mililitro', 'mililitros', 'cc', 'pieza', 'piezas', 'pz', 'pza', 'pzas', 'unidad', 'unidades', 'ud', 'hoja', 'hojas') then 1
    else (select 1 where abastecimiento.canonical_base_unit(p_unit) is not null)
  end;
end;
$$;

create or replace function abastecimiento.recipe_output_base_quantity(
  p_recipe_id uuid,
  p_base_unit text,
  p_path uuid[] default '{}'::uuid[],
  p_depth integer default 0
)
returns numeric
language plpgsql
stable
security definer
set search_path = 'public', 'abastecimiento', 'pg_temp'
as $$
declare
  v_recipe public.recipes%rowtype;
  v_total numeric := 0;
begin
  if p_base_unit not in ('g', 'ml', 'pieza') then
    raise exception 'Unidad base de rendimiento inválida: %.', p_base_unit using errcode = '22023';
  end if;
  if p_depth > 8 then
    raise exception 'La receta excede 8 niveles de subrecetas.' using errcode = '22023';
  end if;
  if p_recipe_id = any(p_path) then
    raise exception 'La receta contiene un ciclo de subrecetas.' using errcode = '22023';
  end if;

  select * into v_recipe from public.recipes where id = p_recipe_id;
  if not found then
    raise exception 'No se encontró una receta asociada.' using errcode = '22023';
  end if;

  if p_base_unit = 'pieza' then
    v_total := coalesce(nullif(v_recipe.yield_pieces, 0), nullif(v_recipe.portions, 0), 0);
    if v_total <= 0 then
      raise exception 'La receta "%" no tiene rendimiento en piezas.', v_recipe.name using errcode = '22023';
    end if;
    return v_total;
  end if;

  if v_recipe.normalized_output_unit = p_base_unit and coalesce(v_recipe.normalized_output_quantity, 0) > 0 then
    return v_recipe.normalized_output_quantity;
  end if;
  raise exception 'Normaliza el rendimiento de la subreceta "%" en % antes de guardar el lote.', v_recipe.name, p_base_unit using errcode = '22023';
end;
$$;

create or replace function abastecimiento.expand_recipe_consumption(
  p_lot_id uuid,
  p_lot_item_id uuid,
  p_location_id uuid,
  p_production_date date,
  p_finished_product_id bigint,
  p_product_name text,
  p_recipe_id uuid,
  p_multiplier numeric,
  p_path uuid[] default '{}'::uuid[],
  p_depth integer default 0,
  p_subrecipe_id uuid default null,
  p_subrecipe_name text default null
)
returns void
language plpgsql
security definer
set search_path = 'public', 'abastecimiento', 'pg_temp'
as $$
declare
  v_recipe public.recipes%rowtype;
  v_ingredient jsonb;
  v_subrecipe jsonb;
  v_inventory public.inventory%rowtype;
  v_inventory_id uuid;
  v_matches integer;
  v_quantity numeric;
  v_base_unit text;
  v_subrecipe_id uuid;
  v_subrecipe_record public.recipes%rowtype;
  v_subrecipe_quantity numeric;
  v_subrecipe_yield numeric;
begin
  if p_depth > 8 then
    raise exception 'La receta excede 8 niveles de subrecetas.' using errcode = '22023';
  end if;
  if p_recipe_id = any(p_path) then
    raise exception 'La receta contiene un ciclo de subrecetas.' using errcode = '22023';
  end if;
  select * into v_recipe from public.recipes where id = p_recipe_id;
  if not found then
    raise exception 'No se encontró la receta del producto "%".', p_product_name using errcode = '22023';
  end if;

  if jsonb_typeof(v_recipe.ingredients) = 'array' then
    for v_ingredient in select value from jsonb_array_elements(v_recipe.ingredients)
    loop
      if exists (
        select 1
        from jsonb_array_elements(coalesce(v_recipe.subrecipes, '[]'::jsonb)) sub
        where coalesce(v_ingredient->>'inventory_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and abastecimiento.normalize_branch(sub->>'name') = abastecimiento.normalize_branch(v_ingredient->>'name')
      ) then
        continue;
      end if;

      v_quantity := coalesce(nullif(v_ingredient->>'quantity', '')::numeric, 0);
      if v_quantity <= 0 then continue; end if;
      v_inventory_id := null;

      if coalesce(v_ingredient->>'inventory_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        select * into v_inventory from public.inventory where id = (v_ingredient->>'inventory_id')::uuid;
        if found then v_inventory_id := v_inventory.id; end if;
      end if;

      if v_inventory_id is null then
        select count(*) into v_matches
        from public.inventory
        where abastecimiento.normalize_branch(product) = abastecimiento.normalize_branch(v_ingredient->>'name');
        if v_matches <> 1 then
          raise exception 'Vincula el insumo "%" de la receta "%" con un único producto de inventario.', coalesce(v_ingredient->>'name', 'Insumo'), v_recipe.name using errcode = '22023';
        end if;
        select id into v_inventory_id
        from public.inventory
        where abastecimiento.normalize_branch(product) = abastecimiento.normalize_branch(v_ingredient->>'name')
        limit 1;
        select * into v_inventory from public.inventory where id = v_inventory_id;
      end if;

      v_base_unit := abastecimiento.canonical_base_unit(v_ingredient->>'unit');
      if v_inventory.base_unit is null or v_inventory.base_quantity_per_presentation is null then
        raise exception 'Normaliza la presentación de "%" antes de guardar el lote.', v_inventory.product using errcode = '22023';
      end if;
      if v_inventory.base_unit <> v_base_unit then
        raise exception 'La receta usa "%" en %, pero su inventario está normalizado en %.', v_inventory.product, v_base_unit, v_inventory.base_unit using errcode = '22023';
      end if;

      insert into pg_temp.production_consumption_work (
        lot_id, lot_item_id, location_id, production_date, finished_product_id, product_name,
        recipe_id, recipe_name, ingredient_id, ingredient_name, quantity_consumed, unit,
        is_subrecipe, subrecipe_id, subrecipe_name
      ) values (
        p_lot_id, p_lot_item_id, p_location_id, p_production_date, p_finished_product_id, p_product_name,
        v_recipe.id, v_recipe.name, v_inventory.id, v_inventory.product,
        abastecimiento.to_base_quantity(v_quantity, v_ingredient->>'unit') * p_multiplier, v_base_unit,
        p_depth > 0, p_subrecipe_id, p_subrecipe_name
      );
    end loop;
  end if;

  if jsonb_typeof(v_recipe.subrecipes) = 'array' then
    for v_subrecipe in select value from jsonb_array_elements(v_recipe.subrecipes)
    loop
      if coalesce(v_subrecipe->>'subrecipe_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'La receta "%" contiene una subreceta sin vínculo válido.', v_recipe.name using errcode = '22023';
      end if;
      v_subrecipe_id := (v_subrecipe->>'subrecipe_id')::uuid;
      select * into v_subrecipe_record from public.recipes where id = v_subrecipe_id;
      if not found then
        raise exception 'No se encontró la subreceta "%".', coalesce(v_subrecipe->>'name', '(sin nombre)') using errcode = '22023';
      end if;
      v_subrecipe_quantity := abastecimiento.to_base_quantity(coalesce(nullif(v_subrecipe->>'quantity', '')::numeric, 0), v_subrecipe->>'unit');
      if v_subrecipe_quantity <= 0 then continue; end if;
      v_base_unit := abastecimiento.canonical_base_unit(v_subrecipe->>'unit');
      v_subrecipe_yield := abastecimiento.recipe_output_base_quantity(v_subrecipe_id, v_base_unit, p_path || p_recipe_id, p_depth + 1);
      perform abastecimiento.expand_recipe_consumption(
        p_lot_id, p_lot_item_id, p_location_id, p_production_date, p_finished_product_id, p_product_name,
        v_subrecipe_id, p_multiplier * v_subrecipe_quantity / v_subrecipe_yield,
        p_path || p_recipe_id, p_depth + 1, v_subrecipe_id, v_subrecipe_record.name
      );
    end loop;
  end if;
end;
$$;

create or replace function abastecimiento.process_lot_recipe_consumption(p_lot_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'abastecimiento', 'pg_temp'
as $$
declare
  v_lot abastecimiento.production_lots%rowtype;
  v_item record;
  v_recipe public.recipes%rowtype;
  v_base_unit text;
  v_quantity numeric;
  v_yield numeric;
  v_required record;
  v_available numeric;
begin
  select * into v_lot from abastecimiento.production_lots where id = p_lot_id for update;
  if not found then raise exception 'No se encontró el lote de producción.' using errcode = '02000'; end if;

  -- ponytail: one lock per location; split by product only if production throughput needs it.
  perform pg_advisory_xact_lock(hashtextextended(v_lot.location_id::text, 0));
  delete from abastecimiento.production_lot_consumptions where lot_id = p_lot_id;

  create temporary table if not exists pg_temp.production_consumption_work (
    lot_id uuid, lot_item_id uuid, location_id uuid, production_date date,
    finished_product_id bigint, product_name text, recipe_id uuid, recipe_name text,
    ingredient_id uuid, ingredient_name text, quantity_consumed numeric, unit text,
    is_subrecipe boolean, subrecipe_id uuid, subrecipe_name text
  ) on commit drop;
  truncate pg_temp.production_consumption_work;

  for v_item in
    select pli.*, p.recipe_id
    from abastecimiento.production_lot_items pli
    left join public.productos p on p.id = pli.finished_product_id
    where pli.lot_id = p_lot_id and pli.finished_product_id > 0
  loop
    if v_item.recipe_id is null then continue; end if;
    select * into v_recipe from public.recipes where id = v_item.recipe_id;
    if not found then raise exception 'No se encontró la receta de "%".', v_item.product_name using errcode = '22023'; end if;

    v_base_unit := abastecimiento.canonical_base_unit(v_item.unit);
    v_quantity := abastecimiento.to_base_quantity(v_item.quantity, v_item.unit);
    if v_base_unit = 'g' then
      if coalesce(v_recipe.yield_pieces, 0) <= 0 or coalesce(v_recipe.yield_weight, 0) <= 0 then
        raise exception 'La receta "%" necesita piezas de rendimiento y peso por pieza para producir en g/Kg.', v_recipe.name using errcode = '22023';
      end if;
      v_yield := v_recipe.yield_pieces * v_recipe.yield_weight;
    else
      v_yield := abastecimiento.recipe_output_base_quantity(v_recipe.id, v_base_unit);
    end if;
    perform abastecimiento.expand_recipe_consumption(
      p_lot_id, v_item.id, v_lot.location_id, v_lot.production_date, v_item.finished_product_id,
      v_item.product_name, v_recipe.id, v_quantity / v_yield
    );
  end loop;

  for v_required in
    select ingredient_id, ingredient_name, unit, sum(quantity_consumed) as quantity_consumed
    from pg_temp.production_consumption_work
    group by ingredient_id, ingredient_name, unit
  loop
    select
      coalesce((
        select sum(ri.received_base_quantity)
        from abastecimiento.receipt_items ri
        join abastecimiento.receipts rec on rec.id = ri.receipt_id
        where rec.status = 'en_almacen'
          and rec.location_id = v_lot.location_id
          and ri.product_id = v_required.ingredient_id
          and ri.base_unit = v_required.unit
      ), 0) - coalesce((
        select sum(plc.quantity_consumed)
        from abastecimiento.production_lot_consumptions plc
        where plc.affects_inventory
          and plc.location_id = v_lot.location_id
          and plc.ingredient_id = v_required.ingredient_id
          and plc.unit = v_required.unit
      ), 0)
    into v_available;

    if v_required.quantity_consumed > v_available + 0.000001 then
      raise exception 'Inventario insuficiente para "%": disponible % %, requerido % %.',
        v_required.ingredient_name, round(v_available, 3), v_required.unit,
        round(v_required.quantity_consumed, 3), v_required.unit using errcode = '22023';
    end if;
  end loop;

  insert into abastecimiento.production_lot_consumptions (
    lot_id, lot_item_id, location_id, production_date, finished_product_id, product_name,
    recipe_id, recipe_name, ingredient_id, ingredient_name, quantity_consumed, unit,
    unit_cost, total_cost, is_subrecipe, subrecipe_id, subrecipe_name, affects_inventory
  )
  with receipt_costs as (
    select ri.product_id, ri.base_unit,
      sum(ri.received_base_quantity * ri.base_unit_cost) / nullif(sum(ri.received_base_quantity), 0) as unit_cost
    from abastecimiento.receipt_items ri
    join abastecimiento.receipts rec on rec.id = ri.receipt_id
    where rec.status = 'en_almacen' and rec.location_id = v_lot.location_id
    group by ri.product_id, ri.base_unit
  ), grouped as (
    select lot_id, lot_item_id, location_id, production_date, finished_product_id, product_name,
      recipe_id, recipe_name, ingredient_id, ingredient_name, unit, is_subrecipe, subrecipe_id, subrecipe_name,
      sum(quantity_consumed) as quantity_consumed
    from pg_temp.production_consumption_work
    group by lot_id, lot_item_id, location_id, production_date, finished_product_id, product_name,
      recipe_id, recipe_name, ingredient_id, ingredient_name, unit, is_subrecipe, subrecipe_id, subrecipe_name
  )
  select g.lot_id, g.lot_item_id, g.location_id, g.production_date, g.finished_product_id, g.product_name,
    g.recipe_id, g.recipe_name, g.ingredient_id, g.ingredient_name, round(g.quantity_consumed, 6), g.unit,
    coalesce(rc.unit_cost, 0), round(g.quantity_consumed * coalesce(rc.unit_cost, 0), 4),
    g.is_subrecipe, g.subrecipe_id, g.subrecipe_name, true
  from grouped g
  left join receipt_costs rc on rc.product_id = g.ingredient_id and rc.base_unit = g.unit;
end;
$$;

create or replace function abastecimiento.snapshot_receipt_item_normalization()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'abastecimiento', 'pg_temp'
as $$
declare
  v_inventory public.inventory%rowtype;
  v_receipt_status text;
  v_location_id uuid;
begin
  select * into v_inventory from public.inventory where id = new.product_id;
  select status, location_id into v_receipt_status, v_location_id from abastecimiento.receipts where id = new.receipt_id;
  perform pg_advisory_xact_lock(hashtextextended(v_location_id::text, 0));
  if new.received_quantity > 0 and v_receipt_status = 'en_almacen'
     and (v_inventory.base_unit is null or v_inventory.base_quantity_per_presentation is null) then
    raise exception 'Normaliza la presentación de "%" antes de enviarla a almacén.', v_inventory.product using errcode = '22023';
  end if;
  if v_inventory.base_unit is not null and v_inventory.base_quantity_per_presentation is not null then
    new.base_unit := v_inventory.base_unit;
    new.base_quantity_per_presentation := v_inventory.base_quantity_per_presentation;
    new.received_base_quantity := new.received_quantity * v_inventory.base_quantity_per_presentation;
    new.base_unit_cost := coalesce(new.unit_cost, 0) / v_inventory.base_quantity_per_presentation;
    new.normalization_source := v_inventory.normalization_source;
    new.normalized_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists snapshot_receipt_item_normalization on abastecimiento.receipt_items;
create trigger snapshot_receipt_item_normalization
before insert or update of receipt_id, product_id, received_quantity, unit_cost
on abastecimiento.receipt_items
for each row execute function abastecimiento.snapshot_receipt_item_normalization();

create or replace function abastecimiento.lock_receipt_item_delete()
returns trigger
language plpgsql
set search_path = 'public', 'abastecimiento', 'pg_temp'
as $$
declare
  v_location_id uuid;
begin
  select location_id into v_location_id from abastecimiento.receipts where id = old.receipt_id;
  perform pg_advisory_xact_lock(hashtextextended(v_location_id::text, 0));
  return old;
end;
$$;

drop trigger if exists lock_receipt_item_delete on abastecimiento.receipt_items;
create trigger lock_receipt_item_delete
before delete on abastecimiento.receipt_items
for each row execute function abastecimiento.lock_receipt_item_delete();

create or replace function abastecimiento.lock_receipt_inventory_location()
returns trigger
language plpgsql
set search_path = 'pg_catalog', 'pg_temp'
as $$
begin
  if tg_op = 'DELETE' then
    perform pg_advisory_xact_lock(hashtextextended(old.location_id::text, 0));
    return old;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.location_id::text, 0));
  return new;
end;
$$;

drop trigger if exists lock_receipt_inventory_location on abastecimiento.receipts;
create trigger lock_receipt_inventory_location
before insert or update or delete on abastecimiento.receipts
for each row execute function abastecimiento.lock_receipt_inventory_location();

create or replace function abastecimiento.invalidate_inventory_normalization()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $$
begin
  if old.presentation is distinct from new.presentation or old.unit is distinct from new.unit then
    new.base_unit := null;
    new.base_quantity_per_presentation := null;
    new.base_unit_cost := null;
    new.normalization_source := null;
    new.normalization_model := null;
    new.normalized_at := null;
  elsif new.base_quantity_per_presentation is not null
     and (old.total_price is distinct from new.total_price or old.unit_price is distinct from new.unit_price) then
    new.base_unit_cost := coalesce(new.total_price, new.unit_price, 0) / new.base_quantity_per_presentation;
  end if;
  return new;
end;
$$;

drop trigger if exists invalidate_inventory_normalization on public.inventory;
create trigger invalidate_inventory_normalization
before update of presentation, unit, total_price, unit_price on public.inventory
for each row execute function abastecimiento.invalidate_inventory_normalization();

create or replace function abastecimiento.lock_production_inventory_on_delete()
returns trigger
language plpgsql
set search_path = 'pg_catalog', 'pg_temp'
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(old.location_id::text, 0));
  return old;
end;
$$;

drop trigger if exists lock_production_inventory_on_delete on abastecimiento.production_lots;
create trigger lock_production_inventory_on_delete
before delete on abastecimiento.production_lots
for each row execute function abastecimiento.lock_production_inventory_on_delete();

drop function if exists public.list_abastecimiento_inventory_items(date, date);
create function public.list_abastecimiento_inventory_items(
  p_date_from date default null,
  p_date_to date default null
)
returns table(
  receipt_id uuid, receipt_item_id uuid, receipt_folio text, purchase_order_id uuid, purchase_folio text,
  requisition_id uuid, requisition_folio text, location_id uuid, location_name text, stored_at timestamptz,
  received_at timestamptz, product_id uuid, product text, brand text, presentation text, image_url text,
  unit text, received_quantity numeric, unit_cost numeric, total_cost numeric, lot_code text, expires_at date,
  almacen text, warehouse_id uuid, warehouse_name text, warehouse_address text, rack_id uuid, rack_name text,
  rack_position text, storage_type text, category_id uuid, category_name text, delicate_management boolean,
  product_note text, base_unit text, received_base_quantity numeric, consumed_base_quantity numeric,
  available_base_quantity numeric, base_unit_cost numeric, available_value numeric, normalization_source text
)
language sql
stable
security definer
set search_path = 'public', 'abastecimiento', 'pg_temp'
as $$
  with consumption_totals as (
    select plc.location_id, plc.ingredient_id as product_id, plc.unit as base_unit,
      sum(plc.quantity_consumed) as consumed
    from abastecimiento.production_lot_consumptions plc
    where plc.affects_inventory
      and (p_date_to is null or plc.production_date <= p_date_to)
    group by plc.location_id, plc.ingredient_id, plc.unit
  ), receipt_lines as (
    select rec.id as receipt_id, rit.id as receipt_item_id, rec.folio as receipt_folio,
      po.id as purchase_order_id, po.folio as purchase_folio, req.id as requisition_id,
      req.folio as requisition_folio, rec.location_id, loc.name::text as location_name,
      coalesce(rec.stored_at, rec.updated_at, rec.received_at) as stored_at, rec.received_at,
      rit.product_id, inv.product, inv.brand, inv.presentation, inv.image_url,
      coalesce(rit.unit, inv.unit) as unit, rit.received_quantity,
      coalesce(rit.unit_cost, inv.total_price, inv.unit_price, 0) as unit_cost,
      (rit.received_quantity * coalesce(rit.unit_cost, inv.total_price, inv.unit_price, 0))::numeric as total_cost,
      rit.lot_code, rit.expires_at, inv.almacen, inv.warehouse_id, wh.name as warehouse_name,
      wh.address as warehouse_address, inv.rack_id, rack.name as rack_name, rack.position as rack_position,
      rack.storage_type, inv.category_id, cat.name as category_name,
      coalesce(inv.delicate_management, false) as delicate_management, inv.note as product_note,
      rit.base_unit, rit.received_base_quantity, rit.base_unit_cost, rit.normalization_source,
      coalesce(ct.consumed, 0) as total_consumed
    from abastecimiento.receipts rec
    join abastecimiento.receipt_items rit on rit.receipt_id = rec.id
    join abastecimiento.purchase_orders po on po.id = rec.purchase_order_id
    join abastecimiento.requisitions req on req.id = po.requisition_id
    join public.locations loc on loc.id = rec.location_id
    join public.inventory inv on inv.id = rit.product_id
    left join public.inventory_warehouses wh on wh.id = inv.warehouse_id
    left join public.inventory_racks rack on rack.id = inv.rack_id
    left join public.inventory_categories cat on cat.id = inv.category_id
    left join consumption_totals ct on ct.location_id = rec.location_id
      and ct.product_id = rit.product_id and ct.base_unit = rit.base_unit
    where rec.status = 'en_almacen'
      and abastecimiento.can_access_location(rec.location_id)
      and (p_date_to is null or timezone('America/Mexico_City', coalesce(rec.stored_at, rec.updated_at, rec.received_at))::date <= p_date_to)
  ), allocated as (
    select rl.*,
      coalesce(sum(coalesce(rl.received_base_quantity, 0)) over (
        partition by rl.location_id, rl.product_id, rl.base_unit
        order by rl.expires_at asc nulls last, rl.stored_at, rl.receipt_item_id
        rows between unbounded preceding and 1 preceding
      ), 0) as previous_received,
      sum(coalesce(rl.received_base_quantity, 0) * coalesce(rl.base_unit_cost, 0)) over (
        partition by rl.location_id, rl.product_id, rl.base_unit
      ) / nullif(sum(coalesce(rl.received_base_quantity, 0)) over (
        partition by rl.location_id, rl.product_id, rl.base_unit
      ), 0) as average_base_unit_cost
    from receipt_lines rl
  ), balances as (
    select a.*,
      case when a.received_base_quantity is null then null else
        least(a.received_base_quantity, greatest(a.total_consumed - a.previous_received, 0)) end as line_consumed
    from allocated a
  )
  select b.receipt_id, b.receipt_item_id, b.receipt_folio, b.purchase_order_id, b.purchase_folio,
    b.requisition_id, b.requisition_folio, b.location_id, b.location_name, b.stored_at, b.received_at,
    b.product_id, b.product, b.brand, b.presentation, b.image_url, b.unit, b.received_quantity,
    b.unit_cost, b.total_cost, b.lot_code, b.expires_at, b.almacen, b.warehouse_id, b.warehouse_name,
    b.warehouse_address, b.rack_id, b.rack_name, b.rack_position, b.storage_type, b.category_id,
    b.category_name, b.delicate_management, b.product_note, b.base_unit, b.received_base_quantity,
    b.line_consumed as consumed_base_quantity,
    case when b.received_base_quantity is null then null else greatest(b.received_base_quantity - b.line_consumed, 0) end as available_base_quantity,
    b.average_base_unit_cost as base_unit_cost,
    case when b.received_base_quantity is null then null else greatest(b.received_base_quantity - b.line_consumed, 0) * b.average_base_unit_cost end as available_value,
    b.normalization_source
  from balances b
  where (p_date_from is null or timezone('America/Mexico_City', b.stored_at)::date >= p_date_from)
    and (b.received_base_quantity is null or greatest(b.received_base_quantity - b.line_consumed, 0) > 0)
  order by b.stored_at desc, b.product;
$$;

create or replace function public.get_abastecimiento_minimax_settings_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'abastecimiento', 'vault', 'pg_temp'
as $$
declare
  v_total integer;
  v_normalized integer;
  v_recipe_total integer;
  v_recipe_normalized integer;
  v_configured boolean;
begin
  if not abastecimiento.is_super_admin() then
    raise exception 'Solo super_admin puede configurar MiniMax.' using errcode = '42501';
  end if;
  select count(*), count(*) filter (where base_unit is not null and base_quantity_per_presentation is not null)
    into v_total, v_normalized from public.inventory;
  with recursive recipe_graph(recipe_id, path, depth) as (
    select distinct product.recipe_id, array[product.recipe_id], 0
    from public.productos product
    where product.is_active and product.recipe_id is not null
    union all
    select (subrecipe->>'subrecipe_id')::uuid,
      graph.path || (subrecipe->>'subrecipe_id')::uuid,
      graph.depth + 1
    from recipe_graph graph
    join public.recipes parent_recipe on parent_recipe.id = graph.recipe_id
    cross join lateral jsonb_array_elements(coalesce(parent_recipe.subrecipes, '[]'::jsonb)) subrecipe
    where graph.depth < 8
      and coalesce(subrecipe->>'subrecipe_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and not ((subrecipe->>'subrecipe_id')::uuid = any(graph.path))
  ), usage as (
    select distinct (subrecipe->>'subrecipe_id')::uuid as recipe_id,
      case
        when lower(trim(coalesce(subrecipe->>'unit', ''))) in ('mg', 'g', 'gr', 'kg', 'oz', 'lb', 'miligramo', 'miligramos', 'gramo', 'gramos', 'kilo', 'kilos', 'kilogramo', 'kilogramos', 'onza', 'onzas', 'libra', 'libras') then 'g'
        when lower(trim(coalesce(subrecipe->>'unit', ''))) in ('ml', 'cc', 'cl', 'dl', 'l', 'lt', 'lts', 'mililitro', 'mililitros', 'litro', 'litros') then 'ml'
        when lower(trim(coalesce(subrecipe->>'unit', ''))) in ('pieza', 'piezas', 'pz', 'pza', 'pzas', 'unidad', 'unidades', 'ud') then 'pieza'
      end as base_unit
    from recipe_graph graph
    join public.recipes parent_recipe on parent_recipe.id = graph.recipe_id
    cross join lateral jsonb_array_elements(coalesce(parent_recipe.subrecipes, '[]'::jsonb)) subrecipe
    where coalesce(subrecipe->>'subrecipe_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  select count(*), count(*) filter (
    where recipe.normalized_output_unit = usage.base_unit and recipe.normalized_output_quantity > 0
  ) into v_recipe_total, v_recipe_normalized
  from usage
  join public.recipes recipe on recipe.id = usage.recipe_id
  where usage.base_unit in ('g', 'ml');
  select exists(select 1 from vault.secrets where name = 'abastecimiento_minimax_api_key') into v_configured;
  return jsonb_build_object(
    'model', 'MiniMax-M3', 'configured', v_configured, 'total_count', v_total,
    'normalized_count', v_normalized, 'pending_count', v_total - v_normalized,
    'recipe_output_total_count', v_recipe_total,
    'recipe_output_normalized_count', v_recipe_normalized,
    'recipe_output_pending_count', v_recipe_total - v_recipe_normalized
  );
end;
$$;

create or replace function public.save_abastecimiento_production_lot_idempotent(
  p_location_id uuid,
  p_production_date date,
  p_items jsonb,
  p_notes text,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'abastecimiento', 'pg_temp'
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para guardar producción.' using errcode = '28000';
  end if;
  if p_client_request_id is null then
    raise exception 'La solicitud de producción no tiene identificador.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_client_request_id::text, 1));

  select jsonb_build_object(
    'lot_id', lot.id,
    'folio', lot.folio,
    'items_count', count(item.id),
    'total_quantity', coalesce(sum(item.quantity), 0)
  ) into v_result
  from abastecimiento.production_lots lot
  left join abastecimiento.production_lot_items item on item.lot_id = lot.id
  where lot.created_by = auth.uid() and lot.client_request_id = p_client_request_id
  group by lot.id;
  if v_result is not null then return v_result; end if;

  v_result := public.save_abastecimiento_production_lot(
    p_location_id => p_location_id,
    p_production_date => p_production_date,
    p_items => p_items,
    p_notes => p_notes
  );
  update abastecimiento.production_lots
  set client_request_id = p_client_request_id
  where id = (v_result->>'lot_id')::uuid and created_by = auth.uid();
  return v_result;
end;
$$;

create or replace function public.set_abastecimiento_minimax_api_key(p_api_key text)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'abastecimiento', 'vault', 'pg_temp'
as $$
declare
  v_secret_id uuid;
begin
  if not abastecimiento.is_super_admin() then
    raise exception 'Solo super_admin puede configurar MiniMax.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_api_key, ''))) < 12 then
    raise exception 'La API key de MiniMax no es válida.' using errcode = '22023';
  end if;
  select id into v_secret_id from vault.secrets where name = 'abastecimiento_minimax_api_key';
  if v_secret_id is null then
    perform vault.create_secret(trim(p_api_key), 'abastecimiento_minimax_api_key', 'MiniMax-M3 para normalización de inventario de producción');
  else
    perform vault.update_secret(v_secret_id, trim(p_api_key), 'abastecimiento_minimax_api_key', 'MiniMax-M3 para normalización de inventario de producción');
  end if;
  return jsonb_build_object('model', 'MiniMax-M3', 'configured', true);
end;
$$;

create or replace function public.get_abastecimiento_minimax_api_key()
returns text
language sql
stable
security definer
set search_path = 'vault', 'pg_temp'
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'abastecimiento_minimax_api_key' limit 1;
$$;

create or replace function public.list_abastecimiento_inventory_normalization_candidates(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = 'public', 'abastecimiento', 'pg_temp'
as $$
  select coalesce(jsonb_agg(to_jsonb(candidate)), '[]'::jsonb)
  from (
    select inv.id as inventory_id, inv.product as name, inv.presentation, inv.unit, inv.unit_price, inv.total_price
    from public.inventory inv
    where inv.base_unit is null or inv.base_quantity_per_presentation is null
    order by exists(select 1 from abastecimiento.receipt_items ri where ri.product_id = inv.id) desc,
      inv.updated_at desc nulls last, inv.product
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) candidate;
$$;

create or replace function public.apply_abastecimiento_inventory_normalizations(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'abastecimiento', 'pg_temp'
as $$
declare
  v_item jsonb;
  v_inventory public.inventory%rowtype;
  v_id uuid;
  v_unit text;
  v_quantity numeric;
  v_source text;
  v_count integer := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Las normalizaciones deben enviarse como una lista.' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item->>'inventory_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Una normalización contiene un inventory_id inválido.' using errcode = '22023';
    end if;
    v_id := (v_item->>'inventory_id')::uuid;
    v_unit := v_item->>'base_unit';
    v_quantity := (v_item->>'base_quantity_per_presentation')::numeric;
    v_source := coalesce(nullif(v_item->>'normalization_source', ''), 'minimax');
    if v_unit not in ('g', 'ml', 'pieza') or v_quantity <= 0 or v_source not in ('deterministic', 'minimax', 'manual') then
      raise exception 'Normalización inválida para el inventario %.', v_id using errcode = '22023';
    end if;
    select * into v_inventory from public.inventory where id = v_id for update;
    if not found then raise exception 'No se encontró el inventario %.', v_id using errcode = '02000'; end if;

    update public.inventory set
      base_unit = v_unit,
      base_quantity_per_presentation = v_quantity,
      base_unit_cost = coalesce(total_price, unit_price, 0) / v_quantity,
      normalization_source = v_source,
      normalization_model = case when v_source = 'minimax' then 'MiniMax-M3' else null end,
      normalized_at = now()
    where id = v_id;

    update abastecimiento.receipt_items ri set
      base_unit = v_unit,
      base_quantity_per_presentation = v_quantity,
      received_base_quantity = ri.received_quantity * v_quantity,
      base_unit_cost = coalesce(ri.unit_cost, 0) / v_quantity,
      normalization_source = v_source,
      normalized_at = now()
    where ri.product_id = v_id and ri.base_unit is null;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('applied_count', v_count, 'model', 'MiniMax-M3');
end;
$$;

create or replace function public.list_abastecimiento_production_lot_consumptions(
  p_location_id uuid default null, p_date_from date default null, p_date_to date default null, p_limit integer default 50
)
returns table(lot_id uuid, folio text, location_id uuid, location_name text, production_date date, notes text,
  created_at timestamptz, total_products_count bigint, total_produced_pieces numeric, total_ingredients_count bigint,
  total_ingredient_cost numeric, products_summary text, top_ingredients_summary text)
language sql
stable
security definer
set search_path = 'public', 'abastecimiento', 'pg_temp'
as $$
  with lot_base as (
    select pl.id as lot_id, pl.folio, pl.location_id, loc.name::text as location_name,
      pl.production_date, pl.notes, pl.created_at
    from abastecimiento.production_lots pl join public.locations loc on loc.id = pl.location_id
    where (p_location_id is null or pl.location_id = p_location_id)
      and (p_date_from is null or pl.production_date >= p_date_from)
      and (p_date_to is null or pl.production_date <= p_date_to)
      and abastecimiento.can_access_location(pl.location_id)
    order by pl.production_date desc, pl.created_at desc limit coalesce(p_limit, 50)
  ), lot_items_agg as (
    select pli.lot_id, count(distinct pli.id) as total_products_count,
      sum(coalesce(pli.quantity, 0)) as total_produced_pieces,
      string_agg(pli.product_name || ' (' || pli.quantity || ' ' || coalesce(pli.unit, 'pz') || ')', ', ' order by pli.quantity desc) as products_summary
    from abastecimiento.production_lot_items pli group by pli.lot_id
  ), lot_consumptions_agg as (
    select plc.lot_id, count(plc.id) as total_ingredients_count,
      sum(coalesce(plc.total_cost, 0)) as total_ingredient_cost,
      string_agg(plc.ingredient_name || ': ' || plc.quantity_consumed || ' ' || plc.unit, ' · ' order by plc.total_cost desc) as top_ingredients_summary
    from abastecimiento.production_lot_consumptions plc where plc.affects_inventory group by plc.lot_id
  )
  select lb.lot_id, lb.folio, lb.location_id, lb.location_name, lb.production_date, lb.notes, lb.created_at,
    coalesce(lia.total_products_count, 0), coalesce(lia.total_produced_pieces, 0),
    coalesce(lca.total_ingredients_count, 0), coalesce(lca.total_ingredient_cost, 0),
    coalesce(lia.products_summary, 'Sin productos'), coalesce(lca.top_ingredients_summary, 'Sin consumos normalizados')
  from lot_base lb left join lot_items_agg lia on lia.lot_id = lb.lot_id
  left join lot_consumptions_agg lca on lca.lot_id = lb.lot_id
  order by lb.production_date desc, lb.created_at desc;
$$;

create or replace function public.get_abastecimiento_production_lot_consumption_detail(p_lot_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'abastecimiento', 'pg_temp'
as $$
declare v_result jsonb;
begin
  if not exists(select 1 from abastecimiento.production_lots pl where pl.id = p_lot_id and abastecimiento.can_access_location(pl.location_id)) then
    raise exception 'Lote no encontrado o sin permisos.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'lot_id', pl.id, 'folio', pl.folio, 'location_id', pl.location_id, 'location_name', loc.name,
    'production_date', pl.production_date, 'notes', pl.notes, 'created_at', pl.created_at,
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lot_item_id', pli.id, 'finished_product_id', pli.finished_product_id, 'product_name', pli.product_name,
        'quantity', pli.quantity, 'unit', pli.unit, 'has_recipe', p.recipe_id is not null,
        'recipe_name', r.name, 'recipe_yield_pieces', r.yield_pieces, 'recipe_portions', r.portions,
        'ingredients', coalesce((select jsonb_agg(jsonb_build_object(
          'id', plc.id, 'ingredient_id', plc.ingredient_id, 'ingredient_name', plc.ingredient_name,
          'quantity_consumed', plc.quantity_consumed, 'unit', plc.unit, 'unit_cost', plc.unit_cost,
          'total_cost', plc.total_cost, 'is_subrecipe', plc.is_subrecipe,
          'subrecipe_id', plc.subrecipe_id, 'subrecipe_name', plc.subrecipe_name
        ) order by plc.is_subrecipe, plc.total_cost desc)
        from abastecimiento.production_lot_consumptions plc
        where plc.lot_item_id = pli.id and plc.affects_inventory), '[]'::jsonb)
      ) order by pli.created_at)
      from abastecimiento.production_lot_items pli
      left join public.productos p on p.id = pli.finished_product_id
      left join public.recipes r on r.id = p.recipe_id
      where pli.lot_id = pl.id
    ), '[]'::jsonb),
    'totals', (select jsonb_build_object(
      'total_ingredients_count', count(plc.id), 'total_cost', coalesce(sum(plc.total_cost), 0),
      'total_direct_ingredients', count(*) filter (where not plc.is_subrecipe),
      'total_subrecipe_ingredients', count(*) filter (where plc.is_subrecipe)
    ) from abastecimiento.production_lot_consumptions plc where plc.lot_id = pl.id and plc.affects_inventory)
  ) into v_result
  from abastecimiento.production_lots pl join public.locations loc on loc.id = pl.location_id
  where pl.id = p_lot_id;
  return v_result;
end;
$$;

do $$
begin
  if to_regprocedure('public.save_abastecimiento_production_lot(uuid,date,jsonb,text)') is not null then
    execute 'alter function public.save_abastecimiento_production_lot(uuid, date, jsonb, text) set search_path = public, abastecimiento, pg_temp';
  end if;
  if to_regprocedure('public.save_abastecimiento_production_lot(uuid,jsonb,date,text)') is not null then
    execute 'alter function public.save_abastecimiento_production_lot(uuid, jsonb, date, text) set search_path = public, abastecimiento, pg_temp';
  end if;
end;
$$;
alter function public.update_abastecimiento_production_lot(uuid, jsonb, text)
  set search_path = 'public', 'abastecimiento', 'pg_temp';
alter function public.delete_abastecimiento_production_lot(uuid)
  set search_path = 'public', 'abastecimiento', 'pg_temp';

alter table abastecimiento.production_lot_consumptions enable row level security;
revoke all on abastecimiento.production_lot_consumptions from public, anon, authenticated;
revoke execute on function abastecimiento.process_lot_recipe_consumption(uuid) from public, anon, authenticated;
revoke execute on function abastecimiento.canonical_base_unit(text) from public, anon, authenticated;
revoke execute on function abastecimiento.to_base_quantity(numeric, text) from public, anon, authenticated;
revoke execute on function abastecimiento.sync_recipe_output_normalizations_from_costing() from public, anon, authenticated;
revoke execute on function abastecimiento.recipe_output_base_quantity(uuid, text, uuid[], integer) from public, anon, authenticated;
revoke execute on function abastecimiento.expand_recipe_consumption(uuid, uuid, uuid, date, bigint, text, uuid, numeric, uuid[], integer, uuid, text) from public, anon, authenticated;
revoke execute on function abastecimiento.snapshot_receipt_item_normalization() from public, anon, authenticated;
revoke execute on function abastecimiento.lock_receipt_item_delete() from public, anon, authenticated;
revoke execute on function abastecimiento.lock_receipt_inventory_location() from public, anon, authenticated;
revoke execute on function abastecimiento.invalidate_inventory_normalization() from public, anon, authenticated;
revoke execute on function abastecimiento.lock_production_inventory_on_delete() from public, anon, authenticated;

revoke execute on function public.get_abastecimiento_minimax_settings_status() from public, anon;
grant execute on function public.get_abastecimiento_minimax_settings_status() to authenticated;
revoke execute on function public.save_abastecimiento_production_lot_idempotent(uuid, date, jsonb, text, uuid) from public, anon;
grant execute on function public.save_abastecimiento_production_lot_idempotent(uuid, date, jsonb, text, uuid) to authenticated;
revoke execute on function public.set_abastecimiento_minimax_api_key(text) from public, anon;
grant execute on function public.set_abastecimiento_minimax_api_key(text) to authenticated;
revoke execute on function public.get_abastecimiento_minimax_api_key() from public, anon, authenticated;
grant execute on function public.get_abastecimiento_minimax_api_key() to service_role;
revoke execute on function public.list_abastecimiento_inventory_normalization_candidates(integer) from public, anon, authenticated;
grant execute on function public.list_abastecimiento_inventory_normalization_candidates(integer) to service_role;
revoke execute on function public.apply_abastecimiento_inventory_normalizations(jsonb) from public, anon, authenticated;
grant execute on function public.apply_abastecimiento_inventory_normalizations(jsonb) to service_role;

revoke execute on function public.list_abastecimiento_inventory_items(date, date) from public, anon;
grant execute on function public.list_abastecimiento_inventory_items(date, date) to authenticated;
revoke execute on function public.list_abastecimiento_production_lot_consumptions(uuid, date, date, integer) from public, anon;
grant execute on function public.list_abastecimiento_production_lot_consumptions(uuid, date, date, integer) to authenticated;
revoke execute on function public.get_abastecimiento_production_lot_consumption_detail(uuid) from public, anon;
grant execute on function public.get_abastecimiento_production_lot_consumption_detail(uuid) to authenticated;

notify pgrst, 'reload schema';
