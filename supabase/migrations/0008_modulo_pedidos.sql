-- Pedidos, paso 1 de 2: agrega la sección "pedidos" a la lista de módulos con permisos.
-- Va en un archivo aparte porque Postgres no deja usar un valor de enum nuevo dentro de la misma transacción
-- que lo crea: corré esta migración, y después la 0009.
alter type modulo_app add value if not exists 'pedidos';
