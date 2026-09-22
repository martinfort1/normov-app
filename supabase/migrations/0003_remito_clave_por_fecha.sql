-- Los números de remito se reutilizan con el tiempo (no son un ID global): la clave real
-- es (número, fecha). Antes de esto, un remito con un número repetido en otra fecha se
-- trataba como duplicado y se descartaba en la importación. Corre después de 0001 y 0002.

alter table remitos drop constraint remitos_numero_key;
alter table remitos add constraint remitos_numero_fecha_key unique (numero, fecha);

-- Ídem para "un remito no puede estar en dos certificados vigentes": ahora se compara por
-- (remito_numero, fecha), no solo por número.
drop index certificado_items_remito_activo;
create unique index certificado_items_remito_activo
  on certificado_items (remito_numero, fecha) where cert_activo;

create or replace view v_remitos_estado with (security_invoker = true) as
select r.*, ci.certificado_id, c.numero as cert_numero, c.estado as cert_estado
from remitos r
left join certificado_items ci on ci.remito_numero = r.numero and ci.fecha = r.fecha and ci.cert_activo
left join certificados c on c.id = ci.certificado_id;

-- Nota: los remitos que ya se habían perdido por este bug (pisados por otro remito con el
-- mismo número en otra fecha) vuelven solos en la próxima corrida del sync o del importador,
-- una vez aplicado este cambio: ya no van a chocar contra la clave vieja.
