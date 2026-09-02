-- Pin the last mutable search paths used by this workflow.
alter function abastecimiento.save_abastecimiento_quality_verification_internal(
  uuid, date, jsonb, uuid, text
) set search_path = '';

alter function wp_data.format_notification_body(
  text, text, text, text, text, text, text, text, text, text
) set search_path = '';

do $verification$
begin
  if not ('search_path=""' = any(coalesce((
    select function.proconfig
    from pg_catalog.pg_proc function
    where function.oid = 'abastecimiento.save_abastecimiento_quality_verification_internal(uuid,date,jsonb,uuid,text)'::regprocedure
  ), array[]::text[]))) then
    raise exception 'El escritor interno de Calidad conserva un search_path mutable.';
  end if;

  if not ('search_path=""' = any(coalesce((
    select function.proconfig
    from pg_catalog.pg_proc function
    where function.oid = 'wp_data.format_notification_body(text,text,text,text,text,text,text,text,text,text)'::regprocedure
  ), array[]::text[]))) then
    raise exception 'El formateador de notificaciones conserva un search_path mutable.';
  end if;
end;
$verification$;
