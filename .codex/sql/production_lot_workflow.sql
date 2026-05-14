create or replace function abastecimiento.is_super_admin()
returns boolean
language sql
stable
set search_path to 'public', 'abastecimiento', 'pg_temp'
as $function$
  select auth.uid() is not null
    and exists (
      select 1
      from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role = 'super_admin'::public.app_role
    );
$function$;

create table if not exists abastecimiento.production_lots (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique,
  location_id uuid not null references public.locations(id) on delete restrict,
  production_date date not null default ((timezone('America/Mexico_City'::text, now()))::date),
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists abastecimiento.production_lot_items (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references abastecimiento.production_lots(id) on delete cascade,
  finished_product_id bigint not null references public.productos(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  product_name text not null,
  description text,
  packaging text,
  category text,
  subcategory text,
  image_url text,
  price numeric,
  created_at timestamp with time zone not null default now(),
  unique (lot_id, finished_product_id)
);

create index if not exists production_lots_location_date_idx
  on abastecimiento.production_lots (location_id, production_date desc, created_at desc);

create index if not exists production_lot_items_lot_idx
  on abastecimiento.production_lot_items (lot_id);

create index if not exists production_lot_items_finished_product_idx
  on abastecimiento.production_lot_items (finished_product_id);

alter table abastecimiento.production_lots enable row level security;
alter table abastecimiento.production_lot_items enable row level security;

drop policy if exists production_lots_select_by_location_access on abastecimiento.production_lots;
create policy production_lots_select_by_location_access
on abastecimiento.production_lots
for select
to authenticated
using (abastecimiento.can_access_location(location_id));

drop policy if exists production_lots_insert_by_location_access on abastecimiento.production_lots;
create policy production_lots_insert_by_location_access
on abastecimiento.production_lots
for insert
to authenticated
with check (abastecimiento.can_access_location(location_id));

drop policy if exists production_lots_update_super_admin on abastecimiento.production_lots;
create policy production_lots_update_super_admin
on abastecimiento.production_lots
for update
to authenticated
using (abastecimiento.is_super_admin())
with check (abastecimiento.is_super_admin());

drop policy if exists production_lots_delete_super_admin on abastecimiento.production_lots;
create policy production_lots_delete_super_admin
on abastecimiento.production_lots
for delete
to authenticated
using (abastecimiento.is_super_admin());

drop policy if exists production_lot_items_select_by_lot_access on abastecimiento.production_lot_items;
create policy production_lot_items_select_by_lot_access
on abastecimiento.production_lot_items
for select
to authenticated
using (
  exists (
    select 1
    from abastecimiento.production_lots lot
    where lot.id = abastecimiento.production_lot_items.lot_id
      and abastecimiento.can_access_location(lot.location_id)
  )
);

drop policy if exists production_lot_items_insert_by_lot_access on abastecimiento.production_lot_items;
create policy production_lot_items_insert_by_lot_access
on abastecimiento.production_lot_items
for insert
to authenticated
with check (
  exists (
    select 1
    from abastecimiento.production_lots lot
    where lot.id = abastecimiento.production_lot_items.lot_id
      and abastecimiento.can_access_location(lot.location_id)
  )
);

drop policy if exists production_lot_items_update_super_admin on abastecimiento.production_lot_items;
create policy production_lot_items_update_super_admin
on abastecimiento.production_lot_items
for update
to authenticated
using (abastecimiento.is_super_admin())
with check (abastecimiento.is_super_admin());

drop policy if exists production_lot_items_delete_super_admin on abastecimiento.production_lot_items;
create policy production_lot_items_delete_super_admin
on abastecimiento.production_lot_items
for delete
to authenticated
using (abastecimiento.is_super_admin());

create or replace function abastecimiento.apply_production_stock_delta(
  p_location_id uuid,
  p_finished_product_id bigint,
  p_production_date date,
  p_delta numeric
)
returns void
language plpgsql
set search_path to 'public', 'abastecimiento', 'pg_temp'
as $function$
begin
  if p_delta = 0 then
    return;
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
    p_location_id,
    p_finished_product_id,
    p_production_date,
    greatest(p_delta, 0),
    'produccion',
    'PROD-' || to_char(p_production_date, 'YYYYMMDD'),
    auth.uid()
  )
  on conflict (location_id, finished_product_id, production_date)
    where source_type = 'produccion'
      and finished_product_id is not null
      and production_date is not null
  do update
  set
    quantity = greatest(0, abastecimiento.stock_lots.quantity + p_delta),
    updated_at = now();

  delete from abastecimiento.stock_lots
  where source_type = 'produccion'
    and finished_product_id = p_finished_product_id
    and location_id = p_location_id
    and production_date = p_production_date
    and quantity <= 0;
end;
$function$;

create or replace function public.save_abastecimiento_production_lot(
  p_location_id uuid,
  p_items jsonb,
  p_production_date date default null,
  p_notes text default null
)
returns jsonb
language plpgsql
set search_path to 'public', 'abastecimiento', 'pg_temp'
as $function$
declare
  input_item record;
  product_record record;
  v_folio text;
  v_lot_id uuid;
  v_production_date date := coalesce(p_production_date, (timezone('America/Mexico_City'::text, now()))::date);
  v_items_count integer := 0;
  v_total_quantity numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para guardar producción.' using errcode = '28000';
  end if;

  if p_location_id is null or not abastecimiento.can_access_location(p_location_id) then
    raise exception 'Selecciona una sucursal válida para guardar el lote.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'El lote debe incluir una lista de productos.' using errcode = '22023';
  end if;

  v_folio := 'PROD-' || to_char(v_production_date, 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into abastecimiento.production_lots (folio, location_id, production_date, notes, created_by)
  values (v_folio, p_location_id, v_production_date, nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_lot_id;

  for input_item in
    select finished_product_id, sum(quantity) as quantity
    from jsonb_to_recordset(p_items) as item(finished_product_id bigint, quantity numeric)
    where quantity > 0
    group by finished_product_id
  loop
    select
      p.id,
      p.nombre,
      p.descripcion,
      p.empaque,
      p.categoria,
      p.subcategoria,
      p.imagen_url,
      p.precio
    into product_record
    from public.productos p
    where p.id = input_item.finished_product_id
      and p.is_active = true
      and exists (
        select 1
        from public.product_locations product_locations
        where product_locations.product_id = p.id
          and product_locations.location_id = p_location_id
      );

    if not found then
      raise exception 'Un producto del lote no está activo o no pertenece a la sucursal seleccionada.' using errcode = '22023';
    end if;

    insert into abastecimiento.production_lot_items (
      lot_id,
      finished_product_id,
      quantity,
      product_name,
      description,
      packaging,
      category,
      subcategory,
      image_url,
      price
    )
    values (
      v_lot_id,
      product_record.id,
      input_item.quantity,
      product_record.nombre,
      product_record.descripcion,
      product_record.empaque,
      product_record.categoria,
      product_record.subcategoria,
      product_record.imagen_url,
      product_record.precio
    );

    perform abastecimiento.apply_production_stock_delta(p_location_id, product_record.id, v_production_date, input_item.quantity);
    v_items_count := v_items_count + 1;
    v_total_quantity := v_total_quantity + input_item.quantity;
  end loop;

  if v_items_count = 0 then
    raise exception 'Agrega al menos un producto con cantidad mayor a cero.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'lot_id', v_lot_id,
    'folio', v_folio,
    'items_count', v_items_count,
    'total_quantity', v_total_quantity
  );
end;
$function$;

create or replace function public.list_abastecimiento_production_lots(
  p_location_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_limit integer default 50
)
returns table(
  lot_id uuid,
  folio text,
  location_id uuid,
  location_name text,
  production_date date,
  notes text,
  created_by_name text,
  created_at timestamp with time zone,
  items_count bigint,
  total_quantity numeric
)
language plpgsql
stable
set search_path to 'public', 'abastecimiento', 'pg_temp'
as $function$
begin
  if not abastecimiento.is_super_admin() then
    raise exception 'Solo super_admin puede consultar lotes pasados.' using errcode = '42501';
  end if;

  return query
  select
    lot.id as lot_id,
    lot.folio,
    lot.location_id,
    loc.name::text as location_name,
    lot.production_date,
    lot.notes,
    coalesce(profile.full_name, profile.email, 'Usuario')::text as created_by_name,
    lot.created_at,
    count(item.id) as items_count,
    coalesce(sum(item.quantity), 0)::numeric as total_quantity
  from abastecimiento.production_lots lot
  join public.locations loc on loc.id = lot.location_id
  left join abastecimiento.production_lot_items item on item.lot_id = lot.id
  left join public.profiles profile on profile.id = lot.created_by
  where (p_location_id is null or lot.location_id = p_location_id)
    and (p_date_from is null or lot.production_date >= p_date_from)
    and (p_date_to is null or lot.production_date <= p_date_to)
    and abastecimiento.can_access_location(lot.location_id)
  group by lot.id, loc.name, profile.full_name, profile.email
  order by lot.production_date desc, lot.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$function$;

create or replace function public.get_abastecimiento_production_lot(p_lot_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'abastecimiento', 'pg_temp'
as $function$
declare
  result jsonb;
begin
  if not abastecimiento.is_super_admin() then
    raise exception 'Solo super_admin puede consultar el detalle de lotes pasados.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'lot_id', lot.id,
    'folio', lot.folio,
    'location_id', lot.location_id,
    'location_name', loc.name,
    'production_date', lot.production_date,
    'notes', lot.notes,
    'created_at', lot.created_at,
    'items', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'finished_product_id', item.finished_product_id,
          'product', item.product_name,
          'description', item.description,
          'packaging', item.packaging,
          'category', item.category,
          'subcategory', item.subcategory,
          'image_url', item.image_url,
          'price', item.price,
          'quantity', item.quantity
        )
        order by item.product_name
      ) filter (where item.id is not null),
      '[]'::jsonb
    )
  )
  into result
  from abastecimiento.production_lots lot
  join public.locations loc on loc.id = lot.location_id
  left join abastecimiento.production_lot_items item on item.lot_id = lot.id
  where lot.id = p_lot_id
    and abastecimiento.can_access_location(lot.location_id)
  group by lot.id, loc.name;

  if result is null then
    raise exception 'No se encontró el lote.' using errcode = '02000';
  end if;

  return result;
end;
$function$;

create or replace function public.update_abastecimiento_production_lot(
  p_lot_id uuid,
  p_items jsonb,
  p_notes text default null
)
returns jsonb
language plpgsql
set search_path to 'public', 'abastecimiento', 'pg_temp'
as $function$
declare
  lot_record record;
  old_item record;
  input_item record;
  product_record record;
  v_items_count integer := 0;
  v_total_quantity numeric := 0;
begin
  if not abastecimiento.is_super_admin() then
    raise exception 'Solo super_admin puede editar lotes pasados.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'El lote debe incluir una lista de productos.' using errcode = '22023';
  end if;

  select *
  into lot_record
  from abastecimiento.production_lots
  where id = p_lot_id
  for update;

  if not found then
    raise exception 'No se encontró el lote.' using errcode = '02000';
  end if;

  for old_item in
    select finished_product_id, quantity
    from abastecimiento.production_lot_items
    where lot_id = p_lot_id
  loop
    perform abastecimiento.apply_production_stock_delta(lot_record.location_id, old_item.finished_product_id, lot_record.production_date, -old_item.quantity);
  end loop;

  delete from abastecimiento.production_lot_items where lot_id = p_lot_id;

  for input_item in
    select finished_product_id, sum(quantity) as quantity
    from jsonb_to_recordset(p_items) as item(finished_product_id bigint, quantity numeric)
    where quantity > 0
    group by finished_product_id
  loop
    select
      p.id,
      p.nombre,
      p.descripcion,
      p.empaque,
      p.categoria,
      p.subcategoria,
      p.imagen_url,
      p.precio
    into product_record
    from public.productos p
    where p.id = input_item.finished_product_id
      and p.is_active = true
      and exists (
        select 1
        from public.product_locations product_locations
        where product_locations.product_id = p.id
          and product_locations.location_id = lot_record.location_id
      );

    if not found then
      raise exception 'Un producto del lote no está activo o no pertenece a la sucursal del lote.' using errcode = '22023';
    end if;

    insert into abastecimiento.production_lot_items (
      lot_id,
      finished_product_id,
      quantity,
      product_name,
      description,
      packaging,
      category,
      subcategory,
      image_url,
      price
    )
    values (
      p_lot_id,
      product_record.id,
      input_item.quantity,
      product_record.nombre,
      product_record.descripcion,
      product_record.empaque,
      product_record.categoria,
      product_record.subcategoria,
      product_record.imagen_url,
      product_record.precio
    );

    perform abastecimiento.apply_production_stock_delta(lot_record.location_id, product_record.id, lot_record.production_date, input_item.quantity);
    v_items_count := v_items_count + 1;
    v_total_quantity := v_total_quantity + input_item.quantity;
  end loop;

  if v_items_count = 0 then
    raise exception 'Agrega al menos un producto con cantidad mayor a cero.' using errcode = '22023';
  end if;

  update abastecimiento.production_lots
  set
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    updated_at = now()
  where id = p_lot_id;

  return jsonb_build_object(
    'lot_id', p_lot_id,
    'items_count', v_items_count,
    'total_quantity', v_total_quantity
  );
end;
$function$;

create or replace function public.delete_abastecimiento_production_lot(p_lot_id uuid)
returns boolean
language plpgsql
set search_path to 'public', 'abastecimiento', 'pg_temp'
as $function$
declare
  lot_record record;
  old_item record;
begin
  if not abastecimiento.is_super_admin() then
    raise exception 'Solo super_admin puede borrar lotes pasados.' using errcode = '42501';
  end if;

  select *
  into lot_record
  from abastecimiento.production_lots
  where id = p_lot_id
  for update;

  if not found then
    raise exception 'No se encontró el lote.' using errcode = '02000';
  end if;

  for old_item in
    select finished_product_id, quantity
    from abastecimiento.production_lot_items
    where lot_id = p_lot_id
  loop
    perform abastecimiento.apply_production_stock_delta(lot_record.location_id, old_item.finished_product_id, lot_record.production_date, -old_item.quantity);
  end loop;

  delete from abastecimiento.production_lots where id = p_lot_id;
  return true;
end;
$function$;
