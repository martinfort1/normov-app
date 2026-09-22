/* Instalar como archivo nuevo en el proyecto de Apps Script de "Planilla Combustible"
   (Extensiones → Apps Script), junto con _comun.gs.js. Si ya hay otro script en ese proyecto,
   dejalo como está. Después crear un disparador (ícono del reloj) para sincronizar()
   cada 15-30 minutos. */
function sincronizar() {
  const sheets = leerHojas_(['Cargas']);
  if (!sheets.Cargas) throw new Error('No se encontró la hoja Cargas.');
  enviar_('comb', sheets);
}
