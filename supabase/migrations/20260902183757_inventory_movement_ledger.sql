-- Append-only inventory ledger. Raw-material balances are derived exclusively
-- from normalized movements. Finished-product rows remain audit-only until a
-- reliable opening balance and canonical output units exist.

-- PostgREST cannot disambiguate overloads that expose the same named arguments.
drop function if exists public.save_abastecimiento_merma_pv(uuid, date, jsonb, uuid, text);

-- Keep the proven write implementations, but remove them from the public API.
-- Public rolling-deploy wrappers are recreated below after V2 validation exists.
alter function public.save_abastecimiento_quality_verification(uuid, date, jsonb, uuid, text)
  rename to save_abastecimiento_quality_verification_internal;
alter function public.save_abastecimiento_quality_verification_internal(uuid, date, jsonb, uuid, text)
  set schema abastecimiento;
alter function public.save_abastecimiento_merma_pv(uuid, date, uuid, text, jsonb)
  rename to save_abastecimiento_merma_pv_internal;
alter function public.save_abastecimiento_merma_pv_internal(uuid, date, uuid, text, jsonb)
  set schema abastecimiento;

revoke all on function abastecimiento.save_abastecimiento_quality_verification_internal(
  uuid, date, jsonb, uuid, text
) from public, anon, authenticated;
revoke all on function abastecimiento.save_abastecimiento_merma_pv_internal(
  uuid, date, uuid, text, jsonb
) from public, anon, authenticated;

create unique index if not exists quality_verifications_one_lot_idx
  on abastecimiento.quality_verifications(lot_id)
  where lot_id is not null;

create table abastecimiento.merma_pv_product_claims (
  location_id uuid not null references public.locations(id) on delete restrict,
  merma_date date not null,
  product_key text not null check (product_key <> ''),
  merma_record_id uuid not null references abastecimiento.merma_pv_records(id) on delete restrict,
  merma_item_id uuid not null unique references abastecimiento.merma_pv_items(id) on delete restrict,
  claimed_at timestamptz not null default now(),
  primary key (location_id, merma_date, product_key)
);

insert into abastecimiento.merma_pv_product_claims(
  location_id, merma_date, product_key, merma_record_id, merma_item_id, claimed_at
)
select distinct on (record.location_id, record.merma_date, item.finished_product_id::text)
  record.location_id,
  record.merma_date,
  item.finished_product_id::text,
  record.id,
  item.id,
  coalesce(item.created_at, record.created_at, now())
from abastecimiento.merma_pv_items item
join abastecimiento.merma_pv_records record on record.id = item.merma_record_id
where item.finished_product_id is not null
order by record.location_id, record.merma_date, item.finished_product_id::text,
  item.created_at, item.id;

create or replace function abastecimiento.claim_merma_pv_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_record abastecimiento.merma_pv_records%rowtype;
  v_product_key text;
begin
  select * into v_record
  from abastecimiento.merma_pv_records
  where id = new.merma_record_id;

  if not found then
    raise exception 'No se encontró el encabezado de merma PV.' using errcode = '23503';
  end if;

  v_product_key := coalesce(
    new.finished_product_id::text,
    'quality-item:' || new.quality_item_id::text
  );
  if nullif(v_product_key, '') is null then
    raise exception 'La partida de merma no identifica un producto.' using errcode = '22023';
  end if;

  insert into abastecimiento.merma_pv_product_claims(
    location_id, merma_date, product_key, merma_record_id, merma_item_id
  ) values (
    v_record.location_id, v_record.merma_date, v_product_key, v_record.id, new.id
  );
  return new;
end;
$function$;

create trigger merma_pv_items_claim_product
after insert on abastecimiento.merma_pv_items
for each row execute function abastecimiento.claim_merma_pv_product();

alter table abastecimiento.merma_pv_product_claims enable row level security;
revoke all on abastecimiento.merma_pv_product_claims from public, anon, authenticated;
revoke all on function abastecimiento.claim_merma_pv_product() from public;

create or replace function public.save_abastecimiento_quality_verification_v2(
  p_location_id uuid,
  p_verification_date date,
  p_items jsonb,
  p_lot_id uuid,
  p_notes text,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_date date := coalesce(p_verification_date, timezone('America/Mexico_City', now())::date);
  v_lot abastecimiento.production_lots%rowtype;
  v_result jsonb;
begin
  v_claim := abastecimiento.claim_workflow_command(
    'save_quality_verification',
    p_command_id,
    pg_catalog.jsonb_build_object(
      'location_id', p_location_id,
      'verification_date', p_verification_date,
      'items', p_items,
      'lot_id', p_lot_id,
      'notes', p_notes
    )
  );
  if (v_claim->>'replayed')::boolean then
    return v_claim->'result';
  end if;

  if p_location_id is null or not abastecimiento.can_access_location(p_location_id) then
    raise exception 'Selecciona una sucursal válida para registrar la calidad.' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La verificación debe incluir al menos un producto.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      finished_product_id bigint, declared_quantity numeric,
      point_of_sale_quantity numeric, lot_item_id uuid
    )
    where item.finished_product_id is null
      or item.declared_quantity is null or item.declared_quantity <= 0
      or item.point_of_sale_quantity is null or item.point_of_sale_quantity < 0
      or item.point_of_sale_quantity > item.declared_quantity
  ) then
    raise exception 'Las cantidades de Calidad son inválidas.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(finished_product_id bigint)
    group by item.finished_product_id
    having count(*) > 1
  ) then
    raise exception 'Cada producto sólo puede aparecer una vez en la verificación.' using errcode = '22023';
  end if;

  -- This is the same location lock used by production consumption.
  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));

  if p_lot_id is not null then
    select * into v_lot
    from abastecimiento.production_lots
    where id = p_lot_id
    for update;
    if not found or v_lot.location_id <> p_location_id or v_lot.production_date <> v_date then
      raise exception 'El lote no pertenece a la sucursal y fecha seleccionadas.' using errcode = '22023';
    end if;
    if exists (select 1 from abastecimiento.quality_verifications where lot_id = p_lot_id) then
      raise exception 'Este lote ya fue verificado por Calidad.' using errcode = '23505';
    end if;
    if (
      select count(*) from jsonb_to_recordset(p_items) as item(lot_item_id uuid)
    ) <> (
      select count(*) from abastecimiento.production_lot_items where lot_id = p_lot_id
    ) or exists (
      select 1
      from jsonb_to_recordset(p_items) as item(
        lot_item_id uuid, finished_product_id bigint, declared_quantity numeric
      )
      left join abastecimiento.production_lot_items lot_item
        on lot_item.id = item.lot_item_id and lot_item.lot_id = p_lot_id
      where lot_item.id is null
        or lot_item.finished_product_id is distinct from item.finished_product_id
        or lot_item.quantity is distinct from item.declared_quantity
    ) then
      raise exception 'Las partidas ya no coinciden con el lote de producción.' using errcode = '40001';
    end if;
  elsif exists (
    with requested as (
      select item.finished_product_id, sum(item.declared_quantity) as quantity
      from jsonb_to_recordset(p_items) as item(
        finished_product_id bigint, declared_quantity numeric
      )
      group by item.finished_product_id
    ), produced as (
      select lot_item.finished_product_id, sum(lot_item.quantity) as quantity
      from abastecimiento.production_lot_items lot_item
      join abastecimiento.production_lots lot on lot.id = lot_item.lot_id
      where lot.location_id = p_location_id and lot.production_date = v_date
      group by lot_item.finished_product_id
    ), verified as (
      select item.finished_product_id, sum(item.declared_quantity) as quantity
      from abastecimiento.quality_verification_items item
      join abastecimiento.quality_verifications verification on verification.id = item.verification_id
      where verification.location_id = p_location_id and verification.verification_date = v_date
      group by item.finished_product_id
    )
    select 1
    from requested
    left join produced using (finished_product_id)
    left join verified using (finished_product_id)
    where requested.quantity > greatest(coalesce(produced.quantity, 0) - coalesce(verified.quantity, 0), 0) + 0.000001
  ) then
    raise exception 'La producción pendiente cambió; recarga antes de verificar.' using errcode = '40001';
  end if;

  perform pg_catalog.set_config('kadmiel.command_id', p_command_id::text, true);
  v_result := abastecimiento.save_abastecimiento_quality_verification_internal(
    p_location_id, v_date, p_items, p_lot_id, p_notes
  );
  perform abastecimiento.finish_workflow_command(
    'save_quality_verification', p_command_id, v_result
  );
  return v_result;
end;
$function$;

create or replace function public.save_abastecimiento_merma_pv_v2(
  p_location_id uuid,
  p_merma_date date,
  p_verification_id uuid,
  p_notes text,
  p_items jsonb,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_date date := coalesce(p_merma_date, timezone('America/Mexico_City', now())::date);
  v_result jsonb;
begin
  v_claim := abastecimiento.claim_workflow_command(
    'save_merma_pv',
    p_command_id,
    pg_catalog.jsonb_build_object(
      'location_id', p_location_id,
      'merma_date', p_merma_date,
      'verification_id', p_verification_id,
      'notes', p_notes,
      'items', p_items
    )
  );
  if (v_claim->>'replayed')::boolean then
    return v_claim->'result';
  end if;

  if p_location_id is null or not abastecimiento.can_access_location(p_location_id) then
    raise exception 'Selecciona una sucursal válida para registrar la merma.' using errcode = '42501';
  end if;
  if p_verification_id is not null then
    raise exception 'La merma PV se declara sobre el consolidado diario, no sobre una sola verificación.'
      using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La declaración de merma debe incluir al menos un producto.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      finished_product_id bigint, quality_item_id uuid,
      pdv_received_quantity numeric, merma_quantity numeric
    )
    where item.finished_product_id is null or item.quality_item_id is null
      or item.pdv_received_quantity is null or item.pdv_received_quantity < 0
      or item.merma_quantity is null or item.merma_quantity < 0
      or item.merma_quantity > item.pdv_received_quantity
  ) then
    raise exception 'Las partidas de Merma PV son inválidas.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(finished_product_id bigint)
    group by item.finished_product_id
    having count(*) > 1
  ) then
    raise exception 'Cada producto sólo puede aparecer una vez en la declaración de merma.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as input(
      finished_product_id bigint, quality_item_id uuid, pdv_received_quantity numeric
    )
    left join abastecimiento.quality_verification_items quality_item
      on quality_item.id = input.quality_item_id
    left join abastecimiento.quality_verifications verification
      on verification.id = quality_item.verification_id
    where quality_item.id is null
      or quality_item.finished_product_id is distinct from input.finished_product_id
      or verification.location_id is distinct from p_location_id
      or verification.verification_date is distinct from v_date
  ) then
    raise exception 'Los productos ya no coinciden con la verificación de Calidad.' using errcode = '40001';
  end if;

  if exists (
    with requested as (
      select input.finished_product_id, sum(input.pdv_received_quantity) as quantity
      from jsonb_to_recordset(p_items) as input(
        finished_product_id bigint, pdv_received_quantity numeric
      )
      group by input.finished_product_id
    ), verified as (
      select quality_item.finished_product_id, sum(quality_item.point_of_sale_quantity) as quantity
      from abastecimiento.quality_verification_items quality_item
      join abastecimiento.quality_verifications verification
        on verification.id = quality_item.verification_id
      where verification.location_id = p_location_id
        and verification.verification_date = v_date
      group by quality_item.finished_product_id
    )
    select 1
    from requested
    left join verified using (finished_product_id)
    where requested.quantity is distinct from coalesce(verified.quantity, 0)
  ) then
    raise exception 'Las cantidades de Calidad cambiaron; recarga antes de declarar la merma.' using errcode = '40001';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as input(finished_product_id bigint)
    join abastecimiento.merma_pv_product_claims claim
      on claim.location_id = p_location_id
     and claim.merma_date = v_date
     and claim.product_key = input.finished_product_id::text
  ) then
    raise exception 'La merma de uno de los productos ya fue declarada.' using errcode = '23505';
  end if;

  perform pg_catalog.set_config('kadmiel.command_id', p_command_id::text, true);
  v_result := abastecimiento.save_abastecimiento_merma_pv_internal(
    p_location_id, v_date, null, p_notes, p_items
  );
  perform abastecimiento.finish_workflow_command('save_merma_pv', p_command_id, v_result);
  return v_result;
end;
$function$;

-- Rolling-deploy compatibility: old clients receive the same validation and
-- locks, with a server-generated command id. Migration 61650 closes these
-- aliases after the frontend is fully on V2.
create or replace function public.save_abastecimiento_quality_verification(
  p_location_id uuid,
  p_verification_date date,
  p_items jsonb,
  p_lot_id uuid default null,
  p_notes text default null
)
returns jsonb
language sql
set search_path = ''
as $function$
  select public.save_abastecimiento_quality_verification_v2(
    p_location_id, p_verification_date, p_items, p_lot_id, p_notes,
    pg_catalog.gen_random_uuid()
  );
$function$;

create or replace function public.save_abastecimiento_merma_pv(
  p_location_id uuid,
  p_merma_date date default null,
  p_verification_id uuid default null,
  p_notes text default null,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language sql
set search_path = ''
as $function$
  select public.save_abastecimiento_merma_pv_v2(
    p_location_id, p_merma_date, p_verification_id, p_notes, p_items,
    pg_catalog.gen_random_uuid()
  );
$function$;

revoke all on function public.save_abastecimiento_quality_verification(uuid, date, jsonb, uuid, text) from public, anon;
revoke all on function public.save_abastecimiento_quality_verification_v2(uuid, date, jsonb, uuid, text, uuid) from public, anon;
revoke all on function public.save_abastecimiento_merma_pv(uuid, date, uuid, text, jsonb) from public, anon;
revoke all on function public.save_abastecimiento_merma_pv_v2(uuid, date, uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.save_abastecimiento_quality_verification(uuid, date, jsonb, uuid, text) to authenticated;
grant execute on function public.save_abastecimiento_quality_verification_v2(uuid, date, jsonb, uuid, text, uuid) to authenticated;
grant execute on function public.save_abastecimiento_merma_pv(uuid, date, uuid, text, jsonb) to authenticated;
grant execute on function public.save_abastecimiento_merma_pv_v2(uuid, date, uuid, text, jsonb, uuid) to authenticated;

-- Existing lots start at version 1. The default materializes the historical
-- backfill without issuing UPDATEs (and therefore without inventing events).
alter table abastecimiento.production_lots
  add column version integer not null default 1,
  add constraint production_lots_version_check check (version > 0);

create trigger production_lots_bump_workflow_version
before update on abastecimiento.production_lots
for each row execute function abastecimiento.bump_workflow_version();

create table abastecimiento.inventory_movements (
  sequence_id bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid() unique,
  command_id uuid default nullif(pg_catalog.current_setting('kadmiel.command_id', true), '')::uuid,
  location_id uuid not null references public.locations(id) on delete restrict,
  inventory_id uuid references public.inventory(id) on delete restrict,
  finished_product_id bigint references public.productos(id) on delete restrict,
  special_product_key text check (special_product_key is null or special_product_key <> ''),
  quantity_delta numeric not null check (quantity_delta <> 0),
  unit text,
  effective_date date not null default timezone('America/Mexico_City', now())::date,
  affects_balance boolean not null default false,
  movement_type text not null check (movement_type in (
    'receipt_stored', 'production_consumption', 'stock_lot_adjustment',
    'waste', 'merma_pv', 'transfer_dispatch', 'transfer_receive', 'reversal'
  )),
  source_table text not null,
  source_id uuid not null,
  source_line_id uuid,
  actor_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint inventory_movements_one_product check (
    num_nonnulls(inventory_id, finished_product_id, special_product_key) = 1
  ),
  constraint inventory_movements_raw_balance_only check (
    not affects_balance
    or (
      inventory_id is not null
      and unit is not null
      and unit in ('g', 'ml', 'pieza')
    )
  )
);

create index inventory_movements_raw_balance_idx
  on abastecimiento.inventory_movements(location_id, inventory_id, unit, effective_date)
  include (quantity_delta)
  where inventory_id is not null and affects_balance;
create index inventory_movements_finished_balance_idx
  on abastecimiento.inventory_movements(location_id, finished_product_id, sequence_id)
  where finished_product_id is not null;
create index inventory_movements_special_balance_idx
  on abastecimiento.inventory_movements(location_id, special_product_key, sequence_id)
  where special_product_key is not null;
create index inventory_movements_source_idx
  on abastecimiento.inventory_movements(source_table, source_id, sequence_id);
create index inventory_movements_command_idx
  on abastecimiento.inventory_movements(command_id)
  where command_id is not null;

alter table abastecimiento.inventory_movements enable row level security;
revoke all on abastecimiento.inventory_movements from public, anon, authenticated;
grant select on abastecimiento.inventory_movements to authenticated;

create policy inventory_movements_read_location
on abastecimiento.inventory_movements
for select
to authenticated
using (abastecimiento.has_workflow_permission('inventory', location_id));

create trigger inventory_movements_append_only
before update or delete on abastecimiento.inventory_movements
for each row execute function abastecimiento.prevent_append_only_mutation();

alter table abastecimiento.merma_pv_items
  add constraint merma_pv_items_quantities_check check (
    pdv_received_quantity >= 0
    and merma_quantity >= 0
    and merma_quantity <= pdv_received_quantity
    and sold_quantity = pdv_received_quantity - merma_quantity
  ),
  add constraint merma_pv_items_destination_check check (
    destination in ('desecho', 'recuperacion')
  );

alter table abastecimiento.quality_verification_items
  add constraint quality_verification_items_quantities_check check (
    declared_quantity >= 0
    and point_of_sale_quantity >= 0
    and point_of_sale_quantity <= declared_quantity
    and difference_quantity = declared_quantity - point_of_sale_quantity
  );

alter table abastecimiento.production_lot_consumptions
  add constraint production_lot_consumptions_inventory_effect_check check (
    not affects_inventory
    or (
      location_id is not null
      and ingredient_id is not null
      and quantity_consumed > 0
      and unit is not null
      and unit in ('g', 'ml', 'pieza')
    )
  ) not valid;

alter table abastecimiento.production_lot_consumptions
  validate constraint production_lot_consumptions_inventory_effect_check;

create or replace function abastecimiento.normalize_raw_movement(
  p_inventory_id uuid,
  p_quantity numeric,
  p_unit text,
  out base_quantity numeric,
  out base_unit text
)
returns record
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_expected_unit text;
begin
  if p_quantity is null or p_quantity <= 0 or nullif(trim(p_unit), '') is null then
    raise exception 'Cantidad y unidad del movimiento son obligatorias.' using errcode = '22023';
  end if;

  select inventory.base_unit into v_expected_unit
  from public.inventory inventory
  where inventory.id = p_inventory_id;

  if not found then
    raise exception 'No se encontró el producto de inventario.' using errcode = 'P0002';
  end if;
  if v_expected_unit is null then
    raise exception 'El producto no tiene normalización base.' using errcode = '22023';
  end if;

  base_unit := abastecimiento.canonical_base_unit(p_unit);
  if base_unit <> v_expected_unit then
    raise exception 'La unidad % no coincide con la unidad base %.', p_unit, v_expected_unit
      using errcode = '22023';
  end if;

  base_quantity := abastecimiento.to_base_quantity(p_quantity, p_unit);
  return;
end;
$function$;

revoke all on function abastecimiento.normalize_raw_movement(uuid, numeric, text)
from public, anon, authenticated;

create or replace function abastecimiento.guard_immutable_keys()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_key text;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  foreach v_key in array tg_argv loop
    if v_old->v_key is distinct from v_new->v_key then
      raise exception 'No se puede cambiar % después de crear el registro.', v_key using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$function$;

create trigger quality_verifications_immutable_keys
before update of lot_id, location_id, verification_date on abastecimiento.quality_verifications
for each row execute function abastecimiento.guard_immutable_keys('lot_id', 'location_id', 'verification_date');
create trigger quality_verification_items_immutable_keys
before update of verification_id, lot_item_id, finished_product_id on abastecimiento.quality_verification_items
for each row execute function abastecimiento.guard_immutable_keys('verification_id', 'lot_item_id', 'finished_product_id');
create trigger merma_pv_records_immutable_keys
before update of verification_id, location_id, merma_date on abastecimiento.merma_pv_records
for each row execute function abastecimiento.guard_immutable_keys('verification_id', 'location_id', 'merma_date');
create trigger merma_pv_items_immutable_keys
before update of merma_record_id, quality_item_id, finished_product_id on abastecimiento.merma_pv_items
for each row execute function abastecimiento.guard_immutable_keys('merma_record_id', 'quality_item_id', 'finished_product_id');

revoke all on function abastecimiento.guard_immutable_keys() from public;
revoke insert, update, delete, truncate, references, trigger
on abastecimiento.quality_verifications,
   abastecimiento.quality_verification_items,
   abastecimiento.merma_pv_records,
   abastecimiento.merma_pv_items
from public, anon, authenticated;

-- Establish the opening audit trail from the projections already in use.
insert into abastecimiento.inventory_movements(
  location_id, inventory_id, quantity_delta, unit, movement_type,
  source_table, source_id, source_line_id, actor_id, metadata, occurred_at,
  effective_date, affects_balance
)
select
  r.location_id,
  ri.product_id,
  ri.received_base_quantity,
  ri.base_unit,
  'receipt_stored',
  'abastecimiento.receipts',
  r.id,
  ri.id,
  r.received_by,
  jsonb_build_object(
    'opening_import', true,
    'folio', r.folio,
    'lot_code', ri.lot_code,
    'expires_at', ri.expires_at,
    'base_unit_cost', ri.base_unit_cost,
    'normalization_source', ri.normalization_source
  ),
  coalesce(r.stored_at, r.updated_at, r.received_at),
  timezone('America/Mexico_City', coalesce(r.stored_at, r.updated_at, r.received_at))::date,
  true
from abastecimiento.receipts r
join abastecimiento.receipt_items ri on ri.receipt_id = r.id
where r.status = 'en_almacen' and ri.received_base_quantity > 0;

insert into abastecimiento.inventory_movements(
  location_id, inventory_id, quantity_delta, unit, movement_type,
  source_table, source_id, source_line_id, metadata, occurred_at,
  effective_date, affects_balance
)
select
  plc.location_id,
  plc.ingredient_id,
  -plc.quantity_consumed,
  plc.unit,
  'production_consumption',
  'abastecimiento.production_lot_consumptions',
  plc.lot_id,
  plc.id,
  jsonb_build_object(
    'opening_import', true,
    'ingredient', plc.ingredient_name,
    'production_date', plc.production_date
  ),
  plc.created_at,
  plc.production_date,
  true
from abastecimiento.production_lot_consumptions plc
where plc.affects_inventory
  and plc.location_id is not null
  and plc.ingredient_id is not null
  and plc.quantity_consumed <> 0;

insert into abastecimiento.inventory_movements(
  location_id, inventory_id, finished_product_id, quantity_delta, unit,
  movement_type, source_table, source_id, source_line_id, actor_id, metadata, occurred_at,
  effective_date, affects_balance
)
select
  sl.location_id,
  sl.product_id,
  sl.finished_product_id,
  sl.quantity,
  sl.unit,
  'stock_lot_adjustment',
  'abastecimiento.stock_lots',
  sl.id,
  sl.id,
  sl.created_by,
  jsonb_build_object(
    'opening_import', true,
    'audit_only', true,
    'source_type', sl.source_type,
    'lot_code', sl.lot_code
  ),
  sl.created_at,
  coalesce(sl.production_date, timezone('America/Mexico_City', sl.created_at)::date),
  false
from abastecimiento.stock_lots sl
where sl.quantity <> 0 and num_nonnulls(sl.product_id, sl.finished_product_id) = 1;

insert into abastecimiento.inventory_movements(
  location_id, inventory_id, quantity_delta, unit, movement_type,
  source_table, source_id, source_line_id, actor_id, metadata, occurred_at,
  effective_date, affects_balance
)
select
  w.location_id,
  w.product_id,
  -normalized.base_quantity,
  normalized.base_unit,
  'waste',
  'abastecimiento.waste_entries',
  w.id,
  w.id,
  w.registered_by,
  jsonb_build_object(
    'opening_import', true,
    'waste_type', w.waste_type,
    'source_quantity', w.quantity,
    'source_unit', w.unit
  ),
  coalesce(w.registered_at, w.created_at),
  timezone('America/Mexico_City', coalesce(w.registered_at, w.created_at))::date,
  true
from abastecimiento.waste_entries w
cross join lateral abastecimiento.normalize_raw_movement(w.product_id, w.quantity, w.unit) normalized
where w.quantity <> 0;

-- Existing transfers are projected according to their current state. Pending
-- and cancelled transfers have no opening balance effect.
insert into abastecimiento.inventory_movements(
  location_id, inventory_id, quantity_delta, unit, movement_type,
  source_table, source_id, source_line_id, actor_id, metadata, occurred_at,
  effective_date, affects_balance
)
select
  transfer.origin_location_id,
  item.product_id,
  -normalized.base_quantity,
  normalized.base_unit,
  'transfer_dispatch',
  'abastecimiento.transfers',
  transfer.id,
  item.id,
  transfer.sent_by,
  jsonb_build_object(
    'opening_import', true,
    'folio', transfer.folio,
    'lot_code', item.lot_code,
    'source_quantity', item.quantity,
    'source_unit', item.unit,
    'destination_location_id', transfer.destination_location_id
  ),
  coalesce(transfer.sent_at, transfer.updated_at, transfer.created_at),
  timezone(
    'America/Mexico_City',
    coalesce(transfer.sent_at, transfer.updated_at, transfer.created_at)
  )::date,
  true
from abastecimiento.transfers transfer
join abastecimiento.transfer_items item on item.transfer_id = transfer.id
cross join lateral abastecimiento.normalize_raw_movement(item.product_id, item.quantity, item.unit) normalized
where transfer.status in ('en_transito', 'completado');

insert into abastecimiento.inventory_movements(
  location_id, inventory_id, quantity_delta, unit, movement_type,
  source_table, source_id, source_line_id, actor_id, metadata, occurred_at,
  effective_date, affects_balance
)
select
  transfer.destination_location_id,
  item.product_id,
  normalized.base_quantity,
  normalized.base_unit,
  'transfer_receive',
  'abastecimiento.transfers',
  transfer.id,
  item.id,
  transfer.received_by,
  jsonb_build_object(
    'opening_import', true,
    'folio', transfer.folio,
    'lot_code', item.lot_code,
    'source_quantity', item.quantity,
    'source_unit', item.unit,
    'origin_location_id', transfer.origin_location_id
  ),
  coalesce(transfer.received_at, transfer.updated_at, transfer.created_at),
  timezone(
    'America/Mexico_City',
    coalesce(transfer.received_at, transfer.updated_at, transfer.created_at)
  )::date,
  true
from abastecimiento.transfers transfer
join abastecimiento.transfer_items item on item.transfer_id = transfer.id
cross join lateral abastecimiento.normalize_raw_movement(item.product_id, item.quantity, item.unit) normalized
where transfer.status = 'completado';

insert into abastecimiento.inventory_movements(
  location_id, finished_product_id, special_product_key, quantity_delta, unit, movement_type,
  source_table, source_id, source_line_id, actor_id, metadata, occurred_at,
  effective_date, affects_balance
)
select
  mr.location_id,
  case when product.id is not null then mi.finished_product_id end,
  case when product.id is null then
    coalesce('custom:' || mi.finished_product_id::text, 'quality-item:' || mi.quality_item_id::text)
  end,
  -mi.merma_quantity,
  mi.unit,
  'merma_pv',
  'abastecimiento.merma_pv_items',
  mr.id,
  mi.id,
  mr.registered_by,
  jsonb_build_object(
    'opening_import', true,
    'audit_only', true,
    'folio', mr.folio,
    'destination', mi.destination,
    'reason', mi.reason
  ),
  coalesce(mi.created_at, mr.created_at),
  mr.merma_date,
  false
from abastecimiento.merma_pv_items mi
join abastecimiento.merma_pv_records mr on mr.id = mi.merma_record_id
left join public.productos product on product.id = mi.finished_product_id
where mi.merma_quantity > 0;

create or replace function abastecimiento.raw_inventory_balance(
  p_location_id uuid,
  p_inventory_id uuid,
  p_base_unit text,
  p_effective_to date default null
)
returns numeric
language sql
stable
set search_path = ''
as $function$
  select coalesce(sum(movement.quantity_delta), 0)::numeric
  from abastecimiento.inventory_movements movement
  where movement.affects_balance
    and movement.inventory_id is not null
    and movement.location_id = p_location_id
    and movement.inventory_id = p_inventory_id
    and movement.unit = p_base_unit
    and (p_effective_to is null or movement.effective_date <= p_effective_to);
$function$;

revoke all on function abastecimiento.raw_inventory_balance(uuid, uuid, text, date)
from public, anon, authenticated;

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

-- The migration must abort rather than silently cut over to a different raw
-- balance. Expected state includes every normalized source enabled above.
do $reconcile$
begin
  if exists (
    with expected_movements as (
      select receipt.location_id, item.product_id as inventory_id,
        item.base_unit as unit, item.received_base_quantity as quantity_delta
      from abastecimiento.receipts receipt
      join abastecimiento.receipt_items item on item.receipt_id = receipt.id
      where receipt.status = 'en_almacen' and item.received_base_quantity > 0

      union all

      select consumption.location_id, consumption.ingredient_id,
        consumption.unit, -consumption.quantity_consumed
      from abastecimiento.production_lot_consumptions consumption
      where consumption.affects_inventory
        and consumption.location_id is not null
        and consumption.ingredient_id is not null
        and consumption.quantity_consumed > 0

      union all

      select waste.location_id, waste.product_id,
        normalized.base_unit, -normalized.base_quantity
      from abastecimiento.waste_entries waste
      cross join lateral abastecimiento.normalize_raw_movement(
        waste.product_id, waste.quantity, waste.unit
      ) normalized
      where waste.quantity > 0

      union all

      select transfer.origin_location_id, item.product_id,
        normalized.base_unit, -normalized.base_quantity
      from abastecimiento.transfers transfer
      join abastecimiento.transfer_items item on item.transfer_id = transfer.id
      cross join lateral abastecimiento.normalize_raw_movement(
        item.product_id, item.quantity, item.unit
      ) normalized
      where transfer.status in ('en_transito', 'completado')

      union all

      select transfer.destination_location_id, item.product_id,
        normalized.base_unit, normalized.base_quantity
      from abastecimiento.transfers transfer
      join abastecimiento.transfer_items item on item.transfer_id = transfer.id
      cross join lateral abastecimiento.normalize_raw_movement(
        item.product_id, item.quantity, item.unit
      ) normalized
      where transfer.status = 'completado'
    ), expected as (
      select location_id, inventory_id, unit, sum(quantity_delta) as balance
      from expected_movements
      group by location_id, inventory_id, unit
    ), projected as (
      select location_id, inventory_id, unit, sum(quantity_delta) as balance
      from abastecimiento.inventory_movements
      where affects_balance and inventory_id is not null
      group by location_id, inventory_id, unit
    )
    select 1
    from expected
    full join projected using (location_id, inventory_id, unit)
    where abs(coalesce(expected.balance, 0) - coalesce(projected.balance, 0)) > 0.000001
  ) then
    raise exception 'El ledger no reconcilia con el inventario raw histórico.';
  end if;
  if exists (
    with daily as (
      select location_id, inventory_id, unit, effective_date,
        sum(quantity_delta) as quantity_delta
      from abastecimiento.inventory_movements
      where affects_balance and inventory_id is not null
      group by location_id, inventory_id, unit, effective_date
    ), running as (
      select sum(quantity_delta) over (
        partition by location_id, inventory_id, unit
        order by effective_date rows unbounded preceding
      ) as balance
      from daily
    )
    select 1 from running where balance < -0.000001
  ) then
    raise exception 'El inventario raw histórico contiene un saldo negativo.';
  end if;
end;
$reconcile$;

create or replace function abastecimiento.ledger_receipt_stored()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'en_almacen' and old.status is distinct from new.status then
    insert into abastecimiento.inventory_movements(
      location_id, inventory_id, quantity_delta, unit, movement_type,
      source_table, source_id, source_line_id, actor_id, metadata, occurred_at,
      effective_date, affects_balance
    )
    select
      new.location_id, ri.product_id, ri.received_base_quantity, ri.base_unit,
      'receipt_stored', 'abastecimiento.receipts', new.id, ri.id, auth.uid(),
      jsonb_build_object(
        'folio', new.folio,
        'lot_code', ri.lot_code,
        'expires_at', ri.expires_at,
        'base_unit_cost', ri.base_unit_cost,
        'normalization_source', ri.normalization_source
      ),
      coalesce(new.stored_at, now()),
      timezone('America/Mexico_City', coalesce(new.stored_at, now()))::date,
      true
    from abastecimiento.receipt_items ri
    where ri.receipt_id = new.id and ri.received_base_quantity > 0;
  end if;
  return new;
end;
$function$;

create trigger receipts_ledger_stored
after update of status on abastecimiento.receipts
for each row execute function abastecimiento.ledger_receipt_stored();

create or replace function abastecimiento.ledger_production_consumption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.affects_inventory
     and old.location_id is not null and old.ingredient_id is not null
     and old.quantity_consumed <> 0 then
    insert into abastecimiento.inventory_movements(
      location_id, inventory_id, quantity_delta, unit, movement_type,
      source_table, source_id, source_line_id, actor_id, metadata, occurred_at,
      effective_date, affects_balance
    ) values (
      old.location_id, old.ingredient_id, old.quantity_consumed, old.unit, 'reversal',
      'abastecimiento.production_lot_consumptions', old.lot_id, old.id, auth.uid(),
      jsonb_build_object(
        'operation', tg_op,
        'ingredient', old.ingredient_name,
        'production_date', old.production_date
      ),
      now(), old.production_date, true
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.affects_inventory
     and new.location_id is not null and new.ingredient_id is not null
     and new.quantity_consumed <> 0 then
    insert into abastecimiento.inventory_movements(
      location_id, inventory_id, quantity_delta, unit, movement_type,
      source_table, source_id, source_line_id, actor_id, metadata, occurred_at,
      effective_date, affects_balance
    ) values (
      new.location_id, new.ingredient_id, -new.quantity_consumed, new.unit,
      'production_consumption', 'abastecimiento.production_lot_consumptions',
      new.lot_id, new.id, auth.uid(),
      jsonb_build_object(
        'operation', tg_op,
        'ingredient', new.ingredient_name,
        'production_date', new.production_date
      ),
      coalesce(new.created_at, now()), new.production_date, true
    );
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create trigger production_consumptions_ledger
after insert or update or delete on abastecimiento.production_lot_consumptions
for each row execute function abastecimiento.ledger_production_consumption();

create or replace function abastecimiento.ledger_stock_lot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.quantity <> 0
     and num_nonnulls(old.product_id, old.finished_product_id) = 1 then
    insert into abastecimiento.inventory_movements(
      location_id, inventory_id, finished_product_id, quantity_delta, unit,
      movement_type, source_table, source_id, source_line_id, actor_id, metadata
    ) values (
      old.location_id, old.product_id, old.finished_product_id, -old.quantity,
      old.unit, 'reversal', 'abastecimiento.stock_lots', old.id, old.id,
      auth.uid(), jsonb_build_object('operation', tg_op, 'source_type', old.source_type)
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.quantity <> 0
     and num_nonnulls(new.product_id, new.finished_product_id) = 1 then
    insert into abastecimiento.inventory_movements(
      location_id, inventory_id, finished_product_id, quantity_delta, unit,
      movement_type, source_table, source_id, source_line_id, actor_id, metadata, occurred_at
    ) values (
      new.location_id, new.product_id, new.finished_product_id, new.quantity,
      new.unit, 'stock_lot_adjustment', 'abastecimiento.stock_lots', new.id, new.id,
      auth.uid(), jsonb_build_object('operation', tg_op, 'source_type', new.source_type),
      coalesce(new.created_at, now())
    );
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create trigger stock_lots_ledger
after insert or update or delete on abastecimiento.stock_lots
for each row execute function abastecimiento.ledger_stock_lot();

create or replace function abastecimiento.guard_waste_inventory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_new_base_quantity numeric;
  v_new_base_unit text;
  v_old_base_quantity numeric;
  v_old_base_unit text;
  v_available numeric;
begin
  -- This is the same location lock used by production recipe consumption.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.location_id::text, 0)
  );

  select normalized.base_quantity, normalized.base_unit
    into v_new_base_quantity, v_new_base_unit
  from abastecimiento.normalize_raw_movement(
    new.product_id, new.quantity, new.unit
  ) normalized;

  v_available := abastecimiento.raw_inventory_balance(
    new.location_id, new.product_id, v_new_base_unit, null
  );

  -- On UPDATE the ledger still contains the old debit. Add it back only when
  -- it belongs to the same canonical balance bucket being replaced.
  if tg_op = 'UPDATE' and old.quantity > 0 then
    select normalized.base_quantity, normalized.base_unit
      into v_old_base_quantity, v_old_base_unit
    from abastecimiento.normalize_raw_movement(
      old.product_id, old.quantity, old.unit
    ) normalized;

    if old.location_id is not distinct from new.location_id
       and old.product_id is not distinct from new.product_id
       and v_old_base_unit is not distinct from v_new_base_unit then
      v_available := v_available + v_old_base_quantity;
    end if;
  end if;

  if v_new_base_quantity > v_available + 0.000001 then
    raise exception 'Inventario insuficiente para registrar la merma: disponible % %, requerido % %.',
      round(v_available, 3), v_new_base_unit,
      round(v_new_base_quantity, 3), v_new_base_unit using errcode = '22023';
  end if;

  return new;
end;
$function$;

create trigger waste_entries_guard_inventory
before insert or update on abastecimiento.waste_entries
for each row execute function abastecimiento.guard_waste_inventory();

create or replace function abastecimiento.ledger_waste_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_base_quantity numeric;
  v_old_base_unit text;
  v_new_base_quantity numeric;
  v_new_base_unit text;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.quantity <> 0 then
    select normalized.base_quantity, normalized.base_unit
      into v_old_base_quantity, v_old_base_unit
    from abastecimiento.normalize_raw_movement(old.product_id, old.quantity, old.unit) normalized;

    insert into abastecimiento.inventory_movements(
      location_id, inventory_id, quantity_delta, unit, movement_type,
      source_table, source_id, source_line_id, actor_id, metadata,
      effective_date, affects_balance
    ) values (
      old.location_id, old.product_id, v_old_base_quantity, v_old_base_unit, 'reversal',
      'abastecimiento.waste_entries', old.id, old.id, auth.uid(),
      jsonb_build_object(
        'operation', tg_op,
        'waste_type', old.waste_type,
        'source_quantity', old.quantity,
        'source_unit', old.unit
      ),
      timezone('America/Mexico_City', coalesce(old.registered_at, old.created_at))::date,
      true
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.quantity <> 0 then
    select normalized.base_quantity, normalized.base_unit
      into v_new_base_quantity, v_new_base_unit
    from abastecimiento.normalize_raw_movement(new.product_id, new.quantity, new.unit) normalized;

    insert into abastecimiento.inventory_movements(
      location_id, inventory_id, quantity_delta, unit, movement_type,
      source_table, source_id, source_line_id, actor_id, metadata, occurred_at,
      effective_date, affects_balance
    ) values (
      new.location_id, new.product_id, -v_new_base_quantity, v_new_base_unit, 'waste',
      'abastecimiento.waste_entries', new.id, new.id, auth.uid(),
      jsonb_build_object(
        'operation', tg_op,
        'waste_type', new.waste_type,
        'source_quantity', new.quantity,
        'source_unit', new.unit
      ),
      coalesce(new.registered_at, new.created_at, now()),
      timezone(
        'America/Mexico_City',
        coalesce(new.registered_at, new.created_at, now())
      )::date,
      true
    );
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create trigger waste_entries_ledger
after insert or update or delete on abastecimiento.waste_entries
for each row execute function abastecimiento.ledger_waste_entry();

create or replace function abastecimiento.ledger_merma_pv_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_record abastecimiento.merma_pv_records%rowtype;
begin
  select * into v_record
  from abastecimiento.merma_pv_records
  where id = case when tg_op = 'DELETE' then old.merma_record_id else new.merma_record_id end;

  if tg_op in ('UPDATE', 'DELETE') and old.merma_quantity > 0
     and (old.finished_product_id is not null or old.quality_item_id is not null) then
    insert into abastecimiento.inventory_movements(
      location_id, finished_product_id, special_product_key, quantity_delta, unit, movement_type,
      source_table, source_id, source_line_id, actor_id, metadata
    ) values (
      v_record.location_id,
      case when exists (select 1 from public.productos where id = old.finished_product_id)
        then old.finished_product_id end,
      case when not exists (select 1 from public.productos where id = old.finished_product_id)
        then coalesce('custom:' || old.finished_product_id::text, 'quality-item:' || old.quality_item_id::text) end,
      old.merma_quantity, old.unit,
      'reversal', 'abastecimiento.merma_pv_items', old.merma_record_id, old.id,
      auth.uid(), jsonb_build_object('operation', tg_op, 'reverses', 'merma_pv')
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.merma_quantity > 0
     and (new.finished_product_id is not null or new.quality_item_id is not null) then
    insert into abastecimiento.inventory_movements(
      location_id, finished_product_id, special_product_key, quantity_delta, unit, movement_type,
      source_table, source_id, source_line_id, actor_id, metadata, occurred_at
    ) values (
      v_record.location_id,
      case when exists (select 1 from public.productos where id = new.finished_product_id)
        then new.finished_product_id end,
      case when not exists (select 1 from public.productos where id = new.finished_product_id)
        then coalesce('custom:' || new.finished_product_id::text, 'quality-item:' || new.quality_item_id::text) end,
      -new.merma_quantity, new.unit,
      'merma_pv', 'abastecimiento.merma_pv_items', new.merma_record_id, new.id,
      coalesce(v_record.registered_by, auth.uid()),
      jsonb_build_object('operation', tg_op, 'destination', new.destination, 'reason', new.reason),
      coalesce(new.created_at, now())
    );
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create trigger merma_pv_items_ledger
after insert or update or delete on abastecimiento.merma_pv_items
for each row execute function abastecimiento.ledger_merma_pv_item();

create or replace function abastecimiento.ledger_transfer_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'en_transito' and old.status = 'pendiente' then
    insert into abastecimiento.inventory_movements(
      location_id, inventory_id, quantity_delta, unit, movement_type,
      source_table, source_id, source_line_id, actor_id, metadata, occurred_at,
      effective_date, affects_balance
    )
    select old.origin_location_id, ti.product_id,
      -normalized.base_quantity, normalized.base_unit,
      'transfer_dispatch', 'abastecimiento.transfers', new.id, ti.id, auth.uid(),
      jsonb_build_object(
        'folio', new.folio,
        'lot_code', ti.lot_code,
        'source_quantity', ti.quantity,
        'source_unit', ti.unit,
        'destination_location_id', new.destination_location_id
      ),
      coalesce(new.sent_at, now()),
      timezone('America/Mexico_City', coalesce(new.sent_at, now()))::date,
      true
    from abastecimiento.transfer_items ti
    cross join lateral abastecimiento.normalize_raw_movement(
      ti.product_id, ti.quantity, ti.unit
    ) normalized
    where ti.transfer_id = new.id;
  elsif new.status = 'completado' and old.status in ('pendiente', 'en_transito') then
    if old.status = 'pendiente' then
      insert into abastecimiento.inventory_movements(
        location_id, inventory_id, quantity_delta, unit, movement_type,
        source_table, source_id, source_line_id, actor_id, metadata, occurred_at,
        effective_date, affects_balance
      )
      select old.origin_location_id, ti.product_id,
        -normalized.base_quantity, normalized.base_unit,
        'transfer_dispatch', 'abastecimiento.transfers', new.id, ti.id, auth.uid(),
        jsonb_build_object(
          'folio', new.folio,
          'lot_code', ti.lot_code,
          'source_quantity', ti.quantity,
          'source_unit', ti.unit,
          'destination_location_id', new.destination_location_id
        ),
        coalesce(new.sent_at, now()),
        timezone('America/Mexico_City', coalesce(new.sent_at, now()))::date,
        true
      from abastecimiento.transfer_items ti
      cross join lateral abastecimiento.normalize_raw_movement(
        ti.product_id, ti.quantity, ti.unit
      ) normalized
      where ti.transfer_id = new.id;
    end if;
    insert into abastecimiento.inventory_movements(
      location_id, inventory_id, quantity_delta, unit, movement_type,
      source_table, source_id, source_line_id, actor_id, metadata, occurred_at,
      effective_date, affects_balance
    )
    select new.destination_location_id, ti.product_id,
      normalized.base_quantity, normalized.base_unit,
      'transfer_receive', 'abastecimiento.transfers', new.id, ti.id, auth.uid(),
      jsonb_build_object(
        'folio', new.folio,
        'lot_code', ti.lot_code,
        'source_quantity', ti.quantity,
        'source_unit', ti.unit,
        'origin_location_id', new.origin_location_id
      ),
      coalesce(new.received_at, now()),
      timezone('America/Mexico_City', coalesce(new.received_at, now()))::date,
      true
    from abastecimiento.transfer_items ti
    cross join lateral abastecimiento.normalize_raw_movement(
      ti.product_id, ti.quantity, ti.unit
    ) normalized
    where ti.transfer_id = new.id;
  elsif new.status = 'cancelado' and old.status = 'en_transito' then
    insert into abastecimiento.inventory_movements(
      location_id, inventory_id, quantity_delta, unit, movement_type,
      source_table, source_id, source_line_id, actor_id, metadata,
      effective_date, affects_balance
    )
    select old.origin_location_id, ti.product_id,
      normalized.base_quantity, normalized.base_unit,
      'reversal', 'abastecimiento.transfers', new.id, ti.id, auth.uid(),
      jsonb_build_object(
        'folio', new.folio,
        'lot_code', ti.lot_code,
        'source_quantity', ti.quantity,
        'source_unit', ti.unit,
        'reverses', 'transfer_dispatch'
      ),
      timezone('America/Mexico_City', now())::date,
      true
    from abastecimiento.transfer_items ti
    cross join lateral abastecimiento.normalize_raw_movement(
      ti.product_id, ti.quantity, ti.unit
    ) normalized
    where ti.transfer_id = new.id;
  end if;
  return new;
end;
$function$;

create or replace function abastecimiento.guard_transfer_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_shortage record;
  v_transfer_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  -- Parent transitions and child-item mutations share this lock. It must be
  -- acquired before the location balance lock below.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('transfer:' || v_transfer_id::text, 0)
  );

  if tg_op = 'INSERT' then
    if new.status <> 'pendiente' then
      raise exception 'Un traspaso nuevo debe iniciar pendiente.' using errcode = '22023';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'pendiente' then
      raise exception 'No se puede eliminar un traspaso que ya salió de pendiente.' using errcode = '42501';
    end if;
    return old;
  end if;

  if old.status in ('completado', 'cancelado') then
    raise exception 'El traspaso está cerrado y es inmutable.' using errcode = '42501';
  end if;
  if old.status = 'en_transito' and new.status not in ('completado', 'cancelado') then
    raise exception 'Un traspaso en tránsito sólo puede completarse o cancelarse.' using errcode = '22023';
  end if;
  if old.status = 'pendiente' and new.status not in ('pendiente', 'en_transito', 'completado', 'cancelado') then
    raise exception 'Transición de traspaso inválida.' using errcode = '22023';
  end if;
  if new.status <> 'pendiente' and (
    new.origin_location_id is distinct from old.origin_location_id
    or new.destination_location_id is distinct from old.destination_location_id
    or new.destination_area_id is distinct from old.destination_area_id
  ) then
    raise exception 'Edita origen y destino antes de despachar el traspaso.' using errcode = '42501';
  end if;

  if old.status is distinct from new.status
     and old.status in ('pendiente', 'en_transito') then
    -- Hold the same location lock as production until the AFTER ledger trigger
    -- has recorded the corresponding debit, credit or reversal.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(old.origin_location_id::text, 0)
    );
  end if;

  if old.status = 'pendiente'
     and new.status in ('en_transito', 'completado') then
    select required.inventory_id, required.base_unit,
      required.required_quantity, required.available_quantity
      into v_shortage
    from (
      select item.product_id as inventory_id, normalized.base_unit,
        sum(normalized.base_quantity) as required_quantity,
        abastecimiento.raw_inventory_balance(
          old.origin_location_id, item.product_id, normalized.base_unit, null
        ) as available_quantity
      from abastecimiento.transfer_items item
      cross join lateral abastecimiento.normalize_raw_movement(
        item.product_id, item.quantity, item.unit
      ) normalized
      where item.transfer_id = old.id
      group by item.product_id, normalized.base_unit
    ) required
    where required.required_quantity > required.available_quantity + 0.000001
    limit 1;

    if found then
      raise exception 'Inventario insuficiente para el traspaso: disponible % %, requerido % % (producto %).',
        round(v_shortage.available_quantity, 3), v_shortage.base_unit,
        round(v_shortage.required_quantity, 3), v_shortage.base_unit,
        v_shortage.inventory_id using errcode = '22023';
    end if;
  end if;

  return new;
end;
$function$;

create trigger transfers_guard_workflow
before insert or update or delete on abastecimiento.transfers
for each row execute function abastecimiento.guard_transfer_workflow();

create or replace function abastecimiento.guard_transfer_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text;
  v_transfer_id uuid;
begin
  if tg_op = 'UPDATE' and new.transfer_id is distinct from old.transfer_id then
    raise exception 'No se puede mover una partida a otro traspaso.' using errcode = '42501';
  end if;

  v_transfer_id := case when tg_op = 'INSERT' then new.transfer_id else old.transfer_id end;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('transfer:' || v_transfer_id::text, 0)
  );

  select status into v_status
  from abastecimiento.transfers
  where id = v_transfer_id;

  if not found and tg_op = 'DELETE' then
    return old;
  end if;
  if v_status is distinct from 'pendiente' then
    raise exception 'Las partidas se congelan al despachar el traspaso.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create trigger transfer_items_guard_workflow
before insert or update or delete on abastecimiento.transfer_items
for each row execute function abastecimiento.guard_transfer_items();

create trigger transfers_ledger
after update of status on abastecimiento.transfers
for each row execute function abastecimiento.ledger_transfer_status();

-- Production keeps its existing recipe expansion and costing behavior, but its
-- availability decision now reads the canonical raw ledger. Deleting the old
-- rows first is safe: production_consumptions_ledger writes their reversals in
-- the same transaction before the balance is checked.
create or replace function abastecimiento.process_lot_recipe_consumption(p_lot_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'abastecimiento', 'pg_temp'
as $function$
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
  select * into v_lot
  from abastecimiento.production_lots
  where id = p_lot_id
  for update;
  if not found then
    raise exception 'No se encontró el lote de producción.' using errcode = '02000';
  end if;

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
    select lot_item.*, product.recipe_id
    from abastecimiento.production_lot_items lot_item
    left join public.productos product on product.id = lot_item.finished_product_id
    where lot_item.lot_id = p_lot_id and lot_item.finished_product_id > 0
  loop
    if v_item.recipe_id is null then
      continue;
    end if;
    select * into v_recipe from public.recipes where id = v_item.recipe_id;
    if not found then
      raise exception 'No se encontró la receta de "%".', v_item.product_name using errcode = '22023';
    end if;

    v_base_unit := abastecimiento.canonical_base_unit(v_item.unit);
    v_quantity := abastecimiento.to_base_quantity(v_item.quantity, v_item.unit);
    if v_base_unit = 'g' then
      if coalesce(v_recipe.yield_pieces, 0) <= 0
         or coalesce(v_recipe.yield_weight, 0) <= 0 then
        raise exception 'La receta "%" necesita piezas de rendimiento y peso por pieza para producir en g/Kg.',
          v_recipe.name using errcode = '22023';
      end if;
      v_yield := v_recipe.yield_pieces * v_recipe.yield_weight;
    else
      v_yield := abastecimiento.recipe_output_base_quantity(v_recipe.id, v_base_unit);
    end if;

    perform abastecimiento.expand_recipe_consumption(
      p_lot_id, v_item.id, v_lot.location_id, v_lot.production_date,
      v_item.finished_product_id, v_item.product_name, v_recipe.id,
      v_quantity / v_yield
    );
  end loop;

  for v_required in
    select ingredient_id, ingredient_name, unit,
      sum(quantity_consumed) as quantity_consumed
    from pg_temp.production_consumption_work
    group by ingredient_id, ingredient_name, unit
  loop
    select abastecimiento.raw_inventory_min_balance_from(
      v_lot.location_id, v_required.ingredient_id,
      v_required.unit, v_lot.production_date
    ) into v_available;

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
    select receipt_item.product_id, receipt_item.base_unit,
      sum(receipt_item.received_base_quantity * receipt_item.base_unit_cost)
        / nullif(sum(receipt_item.received_base_quantity), 0) as unit_cost
    from abastecimiento.receipt_items receipt_item
    join abastecimiento.receipts receipt on receipt.id = receipt_item.receipt_id
    where receipt.status = 'en_almacen'
      and receipt.location_id = v_lot.location_id
      and timezone(
        'America/Mexico_City',
        coalesce(receipt.stored_at, receipt.updated_at, receipt.received_at)
      )::date <= v_lot.production_date
    group by receipt_item.product_id, receipt_item.base_unit
  ), grouped as (
    select lot_id, lot_item_id, location_id, production_date,
      finished_product_id, product_name, recipe_id, recipe_name,
      ingredient_id, ingredient_name, unit, is_subrecipe,
      subrecipe_id, subrecipe_name, sum(quantity_consumed) as quantity_consumed
    from pg_temp.production_consumption_work
    group by lot_id, lot_item_id, location_id, production_date,
      finished_product_id, product_name, recipe_id, recipe_name,
      ingredient_id, ingredient_name, unit, is_subrecipe,
      subrecipe_id, subrecipe_name
  )
  select grouped.lot_id, grouped.lot_item_id, grouped.location_id,
    grouped.production_date, grouped.finished_product_id, grouped.product_name,
    grouped.recipe_id, grouped.recipe_name, grouped.ingredient_id,
    grouped.ingredient_name, round(grouped.quantity_consumed, 6), grouped.unit,
    coalesce(receipt_costs.unit_cost, 0),
    round(grouped.quantity_consumed * coalesce(receipt_costs.unit_cost, 0), 4),
    grouped.is_subrecipe, grouped.subrecipe_id, grouped.subrecipe_name, true
  from grouped
  left join receipt_costs
    on receipt_costs.product_id = grouped.ingredient_id
   and receipt_costs.base_unit = grouped.unit;
end;
$function$;

revoke all on function abastecimiento.process_lot_recipe_consumption(uuid)
from public, anon, authenticated;

-- Hide mutable legacy implementations so both old and new client signatures
-- must pass through the same lock/version/quality guard during rollout.
alter function public.save_abastecimiento_production_lot(uuid, date, jsonb, text)
  rename to save_abastecimiento_production_lot_internal;
alter function public.save_abastecimiento_production_lot_internal(uuid, date, jsonb, text)
  set schema abastecimiento;
alter function public.update_abastecimiento_production_lot(uuid, jsonb, text)
  rename to update_abastecimiento_production_lot_internal;
alter function public.update_abastecimiento_production_lot_internal(uuid, jsonb, text)
  set schema abastecimiento;
alter function public.delete_abastecimiento_production_lot(uuid)
  rename to delete_abastecimiento_production_lot_internal;
alter function public.delete_abastecimiento_production_lot_internal(uuid)
  set schema abastecimiento;

revoke all on function abastecimiento.save_abastecimiento_production_lot_internal(
  uuid, date, jsonb, text
) from public, anon, authenticated;
revoke all on function abastecimiento.update_abastecimiento_production_lot_internal(
  uuid, jsonb, text
) from public, anon, authenticated;
revoke all on function abastecimiento.delete_abastecimiento_production_lot_internal(uuid)
from public, anon, authenticated;

create or replace function public.save_abastecimiento_production_lot_v2(
  p_location_id uuid,
  p_production_date date,
  p_items jsonb,
  p_notes text,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_result jsonb;
  v_version integer;
begin
  v_claim := abastecimiento.claim_workflow_command(
    'save_production_lot',
    p_command_id,
    pg_catalog.jsonb_build_object(
      'location_id', p_location_id,
      'production_date', p_production_date,
      'items', p_items,
      'notes', p_notes
    )
  );
  if (v_claim->>'replayed')::boolean then
    return v_claim->'result';
  end if;

  -- Bridge requests created just before this migration, when idempotency lived
  -- only on production_lots.client_request_id. The first retry seeds the new
  -- fingerprinted command record; subsequent retries compare its payload hash.
  select pg_catalog.jsonb_build_object(
    'lot_id', lot.id,
    'folio', lot.folio,
    'items_count', count(item.id),
    'total_quantity', coalesce(sum(item.quantity), 0),
    'version', lot.version
  ) into v_result
  from abastecimiento.production_lots lot
  left join abastecimiento.production_lot_items item on item.lot_id = lot.id
  where lot.created_by = auth.uid()
    and lot.client_request_id = p_command_id
  group by lot.id;
  if v_result is not null then
    perform abastecimiento.finish_workflow_command(
      'save_production_lot', p_command_id, v_result
    );
    return v_result;
  end if;

  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para guardar producción.' using errcode = '28000';
  end if;
  if p_location_id is null
     or not abastecimiento.has_workflow_permission('production', p_location_id) then
    raise exception 'No tienes permiso de Producción en la sucursal seleccionada.' using errcode = '42501';
  end if;
  if coalesce(
    p_production_date,
    timezone('America/Mexico_City', now())::date
  ) > timezone('America/Mexico_City', now())::date then
    raise exception 'La producción no puede registrarse con una fecha futura.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_location_id::text, 0)
  );
  perform pg_catalog.set_config('kadmiel.command_id', p_command_id::text, true);
  v_result := abastecimiento.save_abastecimiento_production_lot_internal(
    p_location_id, p_production_date, p_items, p_notes
  );
  update abastecimiento.production_lots lot
  set client_request_id = p_command_id
  where lot.id = (v_result->>'lot_id')::uuid
    and lot.created_by = auth.uid()
  returning lot.version into v_version;
  v_result := coalesce(v_result, '{}'::jsonb)
    || pg_catalog.jsonb_build_object('version', v_version);
  perform abastecimiento.finish_workflow_command(
    'save_production_lot', p_command_id, v_result
  );
  return v_result;
end;
$function$;

-- Production updates and deletes remain implemented by the existing RPCs so
-- their authorization, stock-delta and recipe rules stay unchanged. These V2
-- entry points add retry safety and propagate the command id into ledger rows.
create or replace function public.update_abastecimiento_production_lot_v2(
  p_lot_id uuid,
  p_items jsonb,
  p_notes text,
  p_command_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_location_id uuid;
  v_locked_location_id uuid;
  v_version integer;
  v_result jsonb;
begin
  v_claim := abastecimiento.claim_workflow_command(
    'update_production_lot',
    p_command_id,
    pg_catalog.jsonb_build_object(
      'lot_id', p_lot_id,
      'items', p_items,
      'notes', p_notes,
      'expected_version', p_expected_version
    )
  );
  if (v_claim->>'replayed')::boolean then
    return v_claim->'result';
  end if;

  if not abastecimiento.is_super_admin() then
    raise exception 'Solo super_admin puede editar lotes pasados.' using errcode = '42501';
  end if;
  if p_expected_version is null then
    raise exception 'Recarga el lote antes de editarlo.' using errcode = '40001';
  end if;

  -- Read only the lock key first: every production/quality operation acquires
  -- location advisory lock before attempting the production_lots row lock.
  select lot.location_id into v_location_id
  from abastecimiento.production_lots lot
  where lot.id = p_lot_id;
  if not found then
    raise exception 'No se encontró el lote de producción.' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_location_id::text, 0)
  );
  select lot.location_id, lot.version
    into v_locked_location_id, v_version
  from abastecimiento.production_lots lot
  where lot.id = p_lot_id
  for update;

  if not found then
    raise exception 'No se encontró el lote de producción.' using errcode = 'P0002';
  end if;
  if v_locked_location_id is distinct from v_location_id
     or v_version is distinct from p_expected_version then
    raise exception 'El lote cambió; recarga antes de editarlo.' using errcode = '40001';
  end if;
  if exists (
    select 1 from abastecimiento.quality_verifications verification
    where verification.lot_id = p_lot_id
  ) then
    raise exception 'No se puede editar un lote ya verificado por Calidad.' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('kadmiel.command_id', p_command_id::text, true);
  v_result := abastecimiento.update_abastecimiento_production_lot_internal(
    p_lot_id, p_items, p_notes
  );
  select lot.version into v_version
  from abastecimiento.production_lots lot
  where lot.id = p_lot_id;
  v_result := coalesce(v_result, '{}'::jsonb)
    || pg_catalog.jsonb_build_object('version', v_version);
  perform abastecimiento.finish_workflow_command(
    'update_production_lot', p_command_id, v_result
  );
  return v_result;
end;
$function$;

create or replace function public.delete_abastecimiento_production_lot_v2(
  p_lot_id uuid,
  p_command_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_location_id uuid;
  v_locked_location_id uuid;
  v_version integer;
  v_deleted boolean;
  v_result jsonb;
begin
  v_claim := abastecimiento.claim_workflow_command(
    'delete_production_lot',
    p_command_id,
    pg_catalog.jsonb_build_object(
      'lot_id', p_lot_id,
      'expected_version', p_expected_version
    )
  );
  if (v_claim->>'replayed')::boolean then
    return v_claim->'result';
  end if;

  if not abastecimiento.is_super_admin() then
    raise exception 'Solo super_admin puede borrar lotes pasados.' using errcode = '42501';
  end if;
  if p_expected_version is null then
    raise exception 'Recarga el lote antes de eliminarlo.' using errcode = '40001';
  end if;

  select lot.location_id into v_location_id
  from abastecimiento.production_lots lot
  where lot.id = p_lot_id;
  if not found then
    raise exception 'No se encontró el lote de producción.' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_location_id::text, 0)
  );
  select lot.location_id, lot.version
    into v_locked_location_id, v_version
  from abastecimiento.production_lots lot
  where lot.id = p_lot_id
  for update;

  if not found then
    raise exception 'No se encontró el lote de producción.' using errcode = 'P0002';
  end if;
  if v_locked_location_id is distinct from v_location_id
     or v_version is distinct from p_expected_version then
    raise exception 'El lote cambió; recarga antes de eliminarlo.' using errcode = '40001';
  end if;
  if exists (
    select 1 from abastecimiento.quality_verifications verification
    where verification.lot_id = p_lot_id
  ) then
    raise exception 'No se puede eliminar un lote ya verificado por Calidad.' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('kadmiel.command_id', p_command_id::text, true);
  v_deleted := abastecimiento.delete_abastecimiento_production_lot_internal(p_lot_id);
  v_result := pg_catalog.jsonb_build_object(
    'lot_id', p_lot_id,
    'deleted', v_deleted,
    'version', v_version
  );
  perform abastecimiento.finish_workflow_command(
    'delete_production_lot', p_command_id, v_result
  );
  return v_result;
end;
$function$;

create or replace function public.save_abastecimiento_production_lot(
  p_location_id uuid,
  p_production_date date,
  p_items jsonb,
  p_notes text default null
)
returns jsonb
language sql
set search_path = ''
as $function$
  select public.save_abastecimiento_production_lot_v2(
    p_location_id, p_production_date, p_items, p_notes,
    pg_catalog.gen_random_uuid()
  );
$function$;

create or replace function public.save_abastecimiento_production_lot_idempotent(
  p_location_id uuid,
  p_production_date date,
  p_items jsonb,
  p_notes text,
  p_client_request_id uuid
)
returns jsonb
language sql
set search_path = ''
as $function$
  select public.save_abastecimiento_production_lot_v2(
    p_location_id, p_production_date, p_items, p_notes, p_client_request_id
  );
$function$;

create or replace function public.update_abastecimiento_production_lot(
  p_lot_id uuid,
  p_items jsonb,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_version integer;
begin
  if not abastecimiento.is_super_admin() then
    raise exception 'Solo super_admin puede editar lotes pasados.' using errcode = '42501';
  end if;
  select lot.version into v_version
  from abastecimiento.production_lots lot
  where lot.id = p_lot_id;
  if not found then
    raise exception 'No se encontró el lote.' using errcode = '02000';
  end if;

  return public.update_abastecimiento_production_lot_v2(
    p_lot_id, p_items, p_notes, pg_catalog.gen_random_uuid(), v_version
  );
end;
$function$;

create or replace function public.delete_abastecimiento_production_lot(
  p_lot_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_version integer;
  v_result jsonb;
begin
  if not abastecimiento.is_super_admin() then
    raise exception 'Solo super_admin puede borrar lotes pasados.' using errcode = '42501';
  end if;
  select lot.version into v_version
  from abastecimiento.production_lots lot
  where lot.id = p_lot_id;
  if not found then
    raise exception 'No se encontró el lote.' using errcode = '02000';
  end if;

  v_result := public.delete_abastecimiento_production_lot_v2(
    p_lot_id, pg_catalog.gen_random_uuid(), v_version
  );
  return coalesce((v_result->>'deleted')::boolean, false);
end;
$function$;

create or replace function public.get_abastecimiento_production_lot_v2(
  p_lot_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_location_id uuid;
  v_version integer;
begin
  v_result := public.get_abastecimiento_production_lot(p_lot_id);
  if v_result is null then
    return null;
  end if;

  select lot.location_id, lot.version into v_location_id, v_version
  from abastecimiento.production_lots lot
  where lot.id = p_lot_id;
  if not found then
    return null;
  end if;
  if not abastecimiento.can_access_location(v_location_id) then
    raise exception 'No tienes acceso a este lote.' using errcode = '42501';
  end if;

  return v_result || pg_catalog.jsonb_build_object('version', v_version);
end;
$function$;

create or replace function public.list_abastecimiento_production_lots_v2(
  p_location_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_limit integer default 50
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.to_jsonb(summary)
    || pg_catalog.jsonb_build_object('version', lot.version)
  from public.list_abastecimiento_production_lots(
    p_location_id => p_location_id,
    p_date_from => p_date_from,
    p_date_to => p_date_to,
    p_limit => p_limit
  ) summary
  join abastecimiento.production_lots lot on lot.id = summary.lot_id
  where abastecimiento.can_access_location(lot.location_id)
  order by lot.created_at desc;
$function$;

revoke all on function public.save_abastecimiento_production_lot_v2(
  uuid, date, jsonb, text, uuid
) from public, anon;
revoke all on function public.update_abastecimiento_production_lot_v2(
  uuid, jsonb, text, uuid, integer
) from public, anon;
revoke all on function public.delete_abastecimiento_production_lot_v2(
  uuid, uuid, integer
) from public, anon;
revoke all on function public.save_abastecimiento_production_lot(
  uuid, date, jsonb, text
) from public, anon;
revoke all on function public.update_abastecimiento_production_lot(
  uuid, jsonb, text
) from public, anon;
revoke all on function public.delete_abastecimiento_production_lot(uuid)
from public, anon;
revoke all on function public.get_abastecimiento_production_lot_v2(uuid)
from public, anon;
revoke all on function public.list_abastecimiento_production_lots_v2(
  uuid, date, date, integer
) from public, anon;
grant execute on function public.save_abastecimiento_production_lot_v2(
  uuid, date, jsonb, text, uuid
) to authenticated;
grant execute on function public.update_abastecimiento_production_lot_v2(
  uuid, jsonb, text, uuid, integer
) to authenticated;
grant execute on function public.delete_abastecimiento_production_lot_v2(
  uuid, uuid, integer
) to authenticated;
grant execute on function public.save_abastecimiento_production_lot(
  uuid, date, jsonb, text
) to authenticated;
grant execute on function public.update_abastecimiento_production_lot(
  uuid, jsonb, text
) to authenticated;
grant execute on function public.delete_abastecimiento_production_lot(uuid)
to authenticated;
grant execute on function public.get_abastecimiento_production_lot_v2(uuid)
to authenticated;
grant execute on function public.list_abastecimiento_production_lots_v2(
  uuid, date, date, integer
) to authenticated;

revoke all on function abastecimiento.ledger_receipt_stored() from public;
revoke all on function abastecimiento.ledger_production_consumption() from public;
revoke all on function abastecimiento.ledger_stock_lot() from public;
revoke all on function abastecimiento.guard_waste_inventory() from public;
revoke all on function abastecimiento.ledger_waste_entry() from public;
revoke all on function abastecimiento.ledger_merma_pv_item() from public;
revoke all on function abastecimiento.ledger_transfer_status() from public;
revoke all on function abastecimiento.guard_transfer_workflow() from public;
revoke all on function abastecimiento.guard_transfer_items() from public;
revoke all on function abastecimiento.normalize_raw_movement(uuid, numeric, text) from public;
revoke all on function abastecimiento.raw_inventory_balance(uuid, uuid, text, date) from public;

-- Preserve the legacy return contract while sourcing every raw quantity from
-- the ledger. Receipt and received-transfer movements become inbound FEFO rows;
-- every other balance-affecting movement is allocated against those rows.
create or replace function public.list_abastecimiento_inventory_items(
  p_date_from date default null,
  p_date_to date default null
)
returns table(
  receipt_id uuid, receipt_item_id uuid, receipt_folio text, purchase_order_id uuid,
  purchase_folio text, requisition_id uuid, requisition_folio text, location_id uuid,
  location_name text, stored_at timestamptz, received_at timestamptz, product_id uuid,
  product text, brand text, presentation text, image_url text, unit text,
  received_quantity numeric, unit_cost numeric, total_cost numeric, lot_code text,
  expires_at date, almacen text, warehouse_id uuid, warehouse_name text,
  warehouse_address text, rack_id uuid, rack_name text, rack_position text,
  storage_type text, category_id uuid, category_name text, delicate_management boolean,
  product_note text, base_unit text, received_base_quantity numeric,
  consumed_base_quantity numeric, available_base_quantity numeric,
  base_unit_cost numeric, available_value numeric, normalization_source text
)
language sql
stable
security definer
set search_path = 'public', 'abastecimiento', 'pg_temp'
as $function$
  with source_balances as (
    select
      movement.location_id,
      movement.inventory_id as product_id,
      movement.unit as base_unit,
      movement.source_table,
      movement.source_id,
      movement.source_line_id,
      sum(movement.quantity_delta) as received_base_quantity,
      coalesce(
        max(movement.occurred_at) filter (
          where movement.movement_type in ('receipt_stored', 'transfer_receive')
        ),
        max(movement.occurred_at)
      ) as inbound_at
    from abastecimiento.inventory_movements movement
    where movement.affects_balance
      and movement.inventory_id is not null
      and movement.source_line_id is not null
      and movement.source_table in ('abastecimiento.receipts', 'abastecimiento.transfers')
      and (p_date_to is null or movement.effective_date <= p_date_to)
    group by movement.location_id, movement.inventory_id, movement.unit,
      movement.source_table, movement.source_id, movement.source_line_id
    having sum(movement.quantity_delta) > 0
  ), ledger_totals as (
    select movement.location_id, movement.inventory_id as product_id,
      movement.unit as base_unit, sum(movement.quantity_delta) as balance
    from abastecimiento.inventory_movements movement
    where movement.affects_balance
      and movement.inventory_id is not null
      and (p_date_to is null or movement.effective_date <= p_date_to)
    group by movement.location_id, movement.inventory_id, movement.unit
  ), inbound_totals as (
    select source_balance.location_id, source_balance.product_id,
      source_balance.base_unit,
      sum(source_balance.received_base_quantity) as received
    from source_balances source_balance
    group by source_balance.location_id, source_balance.product_id,
      source_balance.base_unit
  ), consumption_totals as (
    select inbound.location_id, inbound.product_id, inbound.base_unit,
      greatest(inbound.received - coalesce(ledger.balance, 0), 0) as consumed
    from inbound_totals inbound
    left join ledger_totals ledger
      on ledger.location_id = inbound.location_id
     and ledger.product_id = inbound.product_id
     and ledger.base_unit = inbound.base_unit
  ), inbound_lines as (
    select
      source_balance.source_id as receipt_id,
      source_balance.source_line_id as receipt_item_id,
      coalesce(receipt.folio, transfer.folio, 'MOV-' || left(source_balance.source_id::text, 8))::text
        as receipt_folio,
      purchase_order.id as purchase_order_id,
      coalesce(purchase_order.folio, case when transfer.id is not null then 'Traspaso' end)::text
        as purchase_folio,
      requisition.id as requisition_id,
      coalesce(requisition.folio, case when transfer.id is not null then 'Traspaso' end)::text
        as requisition_folio,
      source_balance.location_id,
      location.name::text as location_name,
      coalesce(
        receipt.stored_at,
        receipt.updated_at,
        transfer.received_at,
        source_balance.inbound_at
      ) as stored_at,
      coalesce(
        receipt.received_at,
        transfer.received_at,
        source_balance.inbound_at
      ) as received_at,
      source_balance.product_id,
      inventory.product,
      inventory.brand,
      inventory.presentation,
      inventory.image_url,
      coalesce(receipt_item.unit, transfer_item.unit, source_balance.base_unit) as unit,
      case
        when receipt_item.id is not null then receipt_item.received_quantity
        when transfer_item.id is not null then transfer_item.quantity
        else source_balance.received_base_quantity
      end::numeric as received_quantity,
      case
        when receipt_item.id is not null then
          coalesce(receipt_item.unit_cost, inventory.total_price, inventory.unit_price, 0)
        else coalesce(inventory.total_price, inventory.unit_price, 0)
      end::numeric as unit_cost,
      case
        when receipt_item.id is not null then
          receipt_item.received_quantity
            * coalesce(receipt_item.unit_cost, inventory.total_price, inventory.unit_price, 0)
        else source_balance.received_base_quantity * coalesce(inventory.base_unit_cost, 0)
      end::numeric as total_cost,
      coalesce(receipt_item.lot_code, transfer_item.lot_code) as lot_code,
      receipt_item.expires_at,
      inventory.almacen,
      inventory.warehouse_id,
      warehouse.name as warehouse_name,
      warehouse.address as warehouse_address,
      inventory.rack_id,
      rack.name as rack_name,
      rack.position as rack_position,
      rack.storage_type,
      inventory.category_id,
      category.name as category_name,
      coalesce(inventory.delicate_management, false) as delicate_management,
      inventory.note as product_note,
      source_balance.base_unit,
      source_balance.received_base_quantity,
      coalesce(receipt_item.base_unit_cost, inventory.base_unit_cost, 0)::numeric
        as source_base_unit_cost,
      coalesce(receipt_item.normalization_source, inventory.normalization_source)::text
        as normalization_source,
      coalesce(consumption.consumed, 0) as total_consumed
    from source_balances source_balance
    join public.locations location on location.id = source_balance.location_id
    join public.inventory inventory on inventory.id = source_balance.product_id
    left join abastecimiento.receipts receipt
      on source_balance.source_table = 'abastecimiento.receipts'
     and receipt.id = source_balance.source_id
    left join abastecimiento.receipt_items receipt_item
      on source_balance.source_table = 'abastecimiento.receipts'
     and receipt_item.id = source_balance.source_line_id
     and receipt_item.receipt_id = source_balance.source_id
    left join abastecimiento.purchase_orders purchase_order
      on purchase_order.id = receipt.purchase_order_id
    left join abastecimiento.requisitions requisition
      on requisition.id = purchase_order.requisition_id
    left join abastecimiento.transfers transfer
      on source_balance.source_table = 'abastecimiento.transfers'
     and transfer.id = source_balance.source_id
    left join abastecimiento.transfer_items transfer_item
      on source_balance.source_table = 'abastecimiento.transfers'
     and transfer_item.id = source_balance.source_line_id
     and transfer_item.transfer_id = source_balance.source_id
    left join public.inventory_warehouses warehouse on warehouse.id = inventory.warehouse_id
    left join public.inventory_racks rack on rack.id = inventory.rack_id
    left join public.inventory_categories category on category.id = inventory.category_id
    left join consumption_totals consumption
      on consumption.location_id = source_balance.location_id
     and consumption.product_id = source_balance.product_id
     and consumption.base_unit = source_balance.base_unit
    where abastecimiento.can_access_location(source_balance.location_id)
  ), allocated as (
    select inbound_line.*,
      coalesce(sum(inbound_line.received_base_quantity) over (
        partition by inbound_line.location_id, inbound_line.product_id, inbound_line.base_unit
        order by inbound_line.expires_at asc nulls last,
          inbound_line.stored_at, inbound_line.receipt_item_id
        rows between unbounded preceding and 1 preceding
      ), 0) as previous_received,
      sum(inbound_line.received_base_quantity * inbound_line.source_base_unit_cost) over (
        partition by inbound_line.location_id, inbound_line.product_id, inbound_line.base_unit
      ) / nullif(sum(inbound_line.received_base_quantity) over (
        partition by inbound_line.location_id, inbound_line.product_id, inbound_line.base_unit
      ), 0) as average_base_unit_cost
    from inbound_lines inbound_line
  ), balances as (
    select allocated.*,
      least(
        allocated.received_base_quantity,
        greatest(allocated.total_consumed - allocated.previous_received, 0)
      ) as line_consumed
    from allocated
  )
  select
    balance.receipt_id, balance.receipt_item_id, balance.receipt_folio,
    balance.purchase_order_id, balance.purchase_folio, balance.requisition_id,
    balance.requisition_folio, balance.location_id, balance.location_name,
    balance.stored_at, balance.received_at, balance.product_id, balance.product,
    balance.brand, balance.presentation, balance.image_url, balance.unit,
    balance.received_quantity, balance.unit_cost, balance.total_cost, balance.lot_code,
    balance.expires_at, balance.almacen, balance.warehouse_id, balance.warehouse_name,
    balance.warehouse_address, balance.rack_id, balance.rack_name,
    balance.rack_position, balance.storage_type, balance.category_id,
    balance.category_name, balance.delicate_management, balance.product_note,
    balance.base_unit, balance.received_base_quantity,
    balance.line_consumed as consumed_base_quantity,
    greatest(balance.received_base_quantity - balance.line_consumed, 0)
      as available_base_quantity,
    balance.average_base_unit_cost as base_unit_cost,
    greatest(balance.received_base_quantity - balance.line_consumed, 0)
      * balance.average_base_unit_cost as available_value,
    balance.normalization_source
  from balances balance
  where (p_date_from is null
      or timezone('America/Mexico_City', balance.stored_at)::date >= p_date_from)
    and greatest(balance.received_base_quantity - balance.line_consumed, 0) > 0
  order by balance.stored_at desc, balance.product;
$function$;

revoke execute on function public.list_abastecimiento_inventory_items(date, date)
from public, anon;
grant execute on function public.list_abastecimiento_inventory_items(date, date)
to authenticated;
