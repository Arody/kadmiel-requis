alter table abastecimiento.stock_lots
  add column if not exists production_date date;

alter table abastecimiento.stock_lots
  add column if not exists finished_product_id bigint;

alter table abastecimiento.stock_lots
  alter column production_date set default ((timezone('America/Mexico_City'::text, now()))::date);

alter table abastecimiento.stock_lots
  alter column product_id drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'abastecimiento.stock_lots'::regclass
      and conname = 'stock_lots_finished_product_id_fkey'
  ) then
    alter table abastecimiento.stock_lots
      add constraint stock_lots_finished_product_id_fkey
      foreign key (finished_product_id)
      references public.productos(id)
      on delete restrict;
  end if;
end $$;

drop index if exists abastecimiento.stock_lots_production_daily_key;

create unique index if not exists stock_lots_finished_production_daily_key
  on abastecimiento.stock_lots (location_id, finished_product_id, production_date)
  where source_type = 'produccion'
    and finished_product_id is not null
    and production_date is not null;

create index if not exists stock_lots_production_location_date_idx
  on abastecimiento.stock_lots (location_id, production_date desc)
  where source_type = 'produccion';

create index if not exists stock_lots_finished_product_idx
  on abastecimiento.stock_lots (finished_product_id)
  where finished_product_id is not null;

drop policy if exists stock_lots_update_production_by_location_access on abastecimiento.stock_lots;
create policy stock_lots_update_production_by_location_access
on abastecimiento.stock_lots
for update
to authenticated
using (
  source_type = 'produccion'
  and abastecimiento.can_access_location(location_id)
)
with check (
  source_type = 'produccion'
  and abastecimiento.can_access_location(location_id)
);

drop function if exists public.list_abastecimiento_stock_lots(uuid, date);

create or replace function public.list_abastecimiento_stock_lots(
  p_location_id uuid default null,
  p_production_date date default null
)
returns table(
  stock_lot_id uuid,
  finished_product_id bigint,
  product text,
  description text,
  packaging text,
  category text,
  subcategory text,
  image_url text,
  price numeric,
  location_id uuid,
  location_name text,
  production_date date,
  produced_quantity numeric
)
language sql
stable
set search_path to 'public', 'abastecimiento', 'pg_temp'
as $function$
  with target_date as (
    select coalesce(p_production_date, (timezone('America/Mexico_City'::text, now()))::date) as value
  ),
  location_scope as (
    select loc.id, loc.name::text as name
    from public.locations loc
    where loc.name in ('Teran', 'San Cristobal', 'Aeropuerto')
      and (p_location_id is null or loc.id = p_location_id)
      and abastecimiento.can_access_location(loc.id)
  )
  select
    case when p_location_id is null then null::uuid else (array_agg(sl.id) filter (where sl.id is not null))[1] end as stock_lot_id,
    p.id as finished_product_id,
    p.nombre as product,
    p.descripcion as description,
    p.empaque as packaging,
    p.categoria as category,
    p.subcategoria as subcategory,
    p.imagen_url as image_url,
    p.precio as price,
    case when p_location_id is null then null::uuid else p_location_id end as location_id,
    case when p_location_id is null then 'Todas'::text else max(location_scope.name) end as location_name,
    target_date.value as production_date,
    coalesce(sum(sl.quantity), 0)::numeric as produced_quantity
  from public.productos p
  cross join target_date
  left join location_scope on true
  left join abastecimiento.stock_lots sl
    on sl.finished_product_id = p.id
   and sl.location_id = location_scope.id
   and sl.production_date = target_date.value
   and sl.source_type = 'produccion'
  where p.is_active = true
    and exists (select 1 from location_scope)
    and (
      p_location_id is null
      or exists (
        select 1
        from public.product_locations product_locations
        where product_locations.product_id = p.id
          and product_locations.location_id = p_location_id
      )
    )
  group by
    p.id,
    p.nombre,
    p.descripcion,
    p.empaque,
    p.categoria,
    p.subcategoria,
    p.imagen_url,
    p.precio,
    target_date.value
  order by p.nombre;
$function$;

drop function if exists public.increment_abastecimiento_stock_lot(uuid, uuid, numeric, date);

create or replace function public.increment_abastecimiento_stock_lot(
  p_finished_product_id bigint,
  p_location_id uuid,
  p_delta numeric default 1,
  p_production_date date default null
)
returns jsonb
language plpgsql
set search_path to 'public', 'abastecimiento', 'pg_temp'
as $function$
declare
  current_product record;
  v_stock_lot_id uuid;
  v_production_date date := coalesce(p_production_date, (timezone('America/Mexico_City'::text, now()))::date);
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para registrar producción.' using errcode = '28000';
  end if;

  if coalesce(p_delta, 0) <= 0 then
    raise exception 'La cantidad a incrementar debe ser mayor a cero.' using errcode = '22023';
  end if;

  select
    p.id,
    p.nombre,
    p.descripcion,
    p.empaque,
    p.categoria,
    p.subcategoria,
    p.imagen_url,
    p.precio,
    p_location_id as location_id,
    loc.name::text as location_name
  into current_product
  from public.productos p
  join public.locations loc on loc.id = p_location_id
  where p.id = p_finished_product_id
    and p.is_active = true
    and loc.name in ('Teran', 'San Cristobal', 'Aeropuerto')
    and exists (
      select 1
      from public.product_locations product_locations
      where product_locations.product_id = p.id
        and product_locations.location_id = p_location_id
    );

  if not found then
    raise exception 'No se encontró el producto terminado para esta sucursal.' using errcode = '02000';
  end if;

  if not abastecimiento.can_access_location(current_product.location_id) then
    raise exception 'No tienes acceso a esta sucursal.' using errcode = '42501';
  end if;

  insert into abastecimiento.stock_lots (
    location_id,
    finished_product_id,
    production_date,
    quantity,
    source_type,
    lot_code,
    created_by
  )
  values (
    current_product.location_id,
    current_product.id,
    v_production_date,
    p_delta,
    'produccion',
    'PROD-' || to_char(v_production_date, 'YYYYMMDD'),
    auth.uid()
  )
  on conflict (location_id, finished_product_id, production_date)
    where source_type = 'produccion'
      and finished_product_id is not null
      and production_date is not null
  do update
  set
    quantity = abastecimiento.stock_lots.quantity + excluded.quantity,
    updated_at = now()
  returning id into v_stock_lot_id;

  select jsonb_build_object(
    'stock_lot_id', sl.id,
    'finished_product_id', current_product.id,
    'product', current_product.nombre,
    'description', current_product.descripcion,
    'packaging', current_product.empaque,
    'category', current_product.categoria,
    'subcategory', current_product.subcategoria,
    'image_url', current_product.imagen_url,
    'price', current_product.precio,
    'location_id', current_product.location_id,
    'location_name', current_product.location_name,
    'production_date', sl.production_date,
    'produced_quantity', sl.quantity
  )
  into result
  from abastecimiento.stock_lots sl
  where sl.id = v_stock_lot_id;

  return result;
end;
$function$;
