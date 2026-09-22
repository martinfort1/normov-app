/* Instalar como archivo nuevo en el proyecto de Apps Script de "Planilla NORMOV 2026"
   (Extensiones → Apps Script), junto con _comun.gs.js. Si ya hay otro script en ese proyecto
   (ej. el que procesa las cargas del artifact), dejalo como está. Después crear un disparador
   (ícono del reloj) para sincronizar() cada 15-30 minutos. */
function sincronizar() {
  const sheets = leerHojas_(['PRINCIPAL', 'Cta Clientes']);
  if (!sheets.PRINCIPAL) throw new Error('No se encontró la hoja PRINCIPAL.');
  enviar_('planilla', sheets);
}
