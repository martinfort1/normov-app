-- Planeación: punto de retiro ("Desde": la cantera) de cada viaje del itinerario. El "Hasta" es el cliente / obra del pedido.
-- Es texto, igual que la cantera de los viajes cargados. Requiere 0012. Se puede volver a correr.
alter table plan_viajes add column if not exists cantera text;
