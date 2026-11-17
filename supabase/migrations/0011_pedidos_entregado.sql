-- Pedidos: metros entregados escritos a mano + columna final "Con remitos".
--
-- Cuando un pedido está en "Realizado" se pueden anotar los metros entregados de cada material sin tener todavía los
-- viajes cargados; cuando el chofer manda los remitos se cargan los viajes y se vinculan. Lo que se muestra como
-- entregado es lo mayor entre lo anotado a mano y lo que suman los viajes vinculados: así, a medida que se vinculan
-- viajes la cifra no baja ni se duplica, y si los viajes superan lo anotado, mandan los viajes.
-- Estado nuevo "remitado": el pedido ya tiene todos sus remitos cargados (última columna antes de completarlo).
-- Se puede volver a correr sin problema.

alter type estado_pedido add value if not exists 'remitado';

alter table pedido_items add column if not exists entregado_declarado numeric(14,2) not null default 0 check (entregado_declarado >= 0);

create or replace view v_pedido_avance as
select i.id as item_id, i.pedido_id, i.material_id, i.cantidad as pedido,
       greatest(i.entregado_declarado, v.s)::numeric(14,2) as entregado,
       i.entregado_declarado as declarado,
       v.s::numeric(14,2) as con_remito
from pedido_items i
left join lateral (
  select coalesce(sum(r.cantidad), 0) as s
  from pedido_remitos pr join remitos r on r.id = pr.remito_id
  where pr.pedido_id = i.pedido_id and r.material_id = i.material_id
) v on true
where (select puede_ver('pedidos'::modulo_app));
