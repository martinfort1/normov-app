/* Instalar como archivo nuevo en el proyecto de Apps Script de "NORMOV Diego 2026"
   (Extensiones → Apps Script), junto con _comun.gs.js. Si ya hay otro script en ese proyecto,
   dejalo como está. Después crear un disparador (ícono del reloj) para sincronizar()
   cada 15-30 minutos. */
function sincronizar() {
  const sheets = leerHojas_(['Clientes', 'Cta Cte Proveedores', 'Cheques']);
  if (!Object.keys(sheets).length) throw new Error('No se encontró ninguna de las hojas esperadas.');
  enviar_('diego', sheets);
}
