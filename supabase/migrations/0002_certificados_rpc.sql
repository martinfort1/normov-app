-- Crea un certificado y sus ítems en una sola transacción.
-- Si algún remito ya está en otro certificado vigente, todo se revierte
-- (no queda un certificado sin ítems) gracias al índice único de certificado_items.
create function crear_certificado(
  p_cliente_id uuid, p_desde date, p_hasta date, p_unidad unidad_medida, p_emision date, p_items jsonb
) returns certificados
language plpgsql security invoker as $$
declare
  v_cert certificados;
  v_cant numeric := 0;
  v_tot  numeric := 0;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El certificado no tiene remitos';
  end if;

  select coalesce(sum((i->>'cantidad')::numeric), 0), coalesce(sum((i->>'total')::numeric), 0)
    into v_cant, v_tot from jsonb_array_elements(p_items) i;

  insert into certificados (cliente_id, desde, hasta, unidad, emision, cantidad, total, creado_por)
  values (p_cliente_id, p_desde, p_hasta, p_unidad, p_emision, v_cant, v_tot, auth.uid())
  returning * into v_cert;

  insert into certificado_items (certificado_id, remito_id, remito_numero, fecha, cantidad, precio, total, origen)
  select v_cert.id, (i->>'remito_id')::uuid, i->>'remito_numero', (i->>'fecha')::date,
         (i->>'cantidad')::numeric, (i->>'precio')::numeric, (i->>'total')::numeric, (i->>'origen')::origen_remito
  from jsonb_array_elements(p_items) i;

  return v_cert;
end $$;

revoke all on function crear_certificado from public;
grant execute on function crear_certificado to authenticated;
