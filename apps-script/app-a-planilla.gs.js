/* Instalar como archivo nuevo ("app-a-planilla") en el proyecto de Apps Script de "Planilla NORMOV 2026"
   (el MISMO donde está el script del tablero v9 con insertarFila / insertarTipo / mapViaje…, y donde ya están
   _comun y sync-planilla). Es el sentido contrario del sync: lo que se carga en la app se escribe en las planillas.

   Qué hace: pide a la app (GET SYNC_URL + "/cola") las cargas que todavía no están en las planillas, las escribe
   con las MISMAS funciones que usa el tablero (así respeta fórmulas, filtros, columnas, IDs y el control de lo escrito)
   y le avisa a la app cuáles salieron bien (POST).
     viaje       → Planilla NORMOV 2026 › PRINCIPAL      (con el ID de viaje de la app, A000123, en ID VIAJE)
     combustible → Planilla Combustible › Cargas
     proveedor   → NORMOV Diego 2026 › Cta Cte Proveedores
     cheque      → NORMOV Diego 2026 › Cheques

   Configuración: usa las mismas Propiedades del script que el sync (SYNC_URL = https://tu-dominio/api/sync y SYNC_SECRET).
   Activador: función  llevarCargasDeLaApp  cada 5 minutos (reloj → Agregar activador → Basado en tiempo). */

function llevarCargasDeLaApp() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // otra corrida (o el tablero) está escribiendo: la próxima lo agarra
  try {
    const props = PropertiesService.getScriptProperties();
    const url = props.getProperty('SYNC_URL'), secreto = props.getProperty('SYNC_SECRET');
    if (!url || !secreto) throw new Error('Faltan SYNC_URL o SYNC_SECRET en Propiedades del script.');
    const cola = url.replace(/\/+$/, '') + '/cola';
    const cabecera = { Authorization: 'Bearer ' + secreto };

    const res = UrlFetchApp.fetch(cola, { method: 'get', headers: cabecera, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('La app respondió ' + res.getResponseCode() + ': ' + res.getContentText());
    const filas = JSON.parse(res.getContentText()).filas || [];
    if (!filas.length) return;

    // Ids ya escritos en la planilla cuyo aviso a la app falló: se vuelven a avisar, pero NO se vuelven a escribir.
    const escritas = JSON.parse(props.getProperty('COLA_ESCRITAS') || '[]');
    const ok = [], errores = [];
    filas.forEach(function (f) {
      if (escritas.indexOf(f.id) !== -1) { ok.push(f.id); return; }
      try { escribirCargaDeLaApp_(f.tipo, f.datos || {}); ok.push(f.id); escritas.push(f.id); props.setProperty('COLA_ESCRITAS', JSON.stringify(escritas.slice(-200))); }
      catch (e) { errores.push({ id: f.id, error: String(e && e.message || e) }); }
    });

    const aviso = UrlFetchApp.fetch(cola, {
      method: 'post', contentType: 'application/json', headers: cabecera,
      payload: JSON.stringify({ ok: ok, errores: errores }), muteHttpExceptions: true,
    });
    if (aviso.getResponseCode() !== 200) {
      // Lo escrito ya está en la planilla y quedó anotado (COLA_ESCRITAS): la próxima corrida solo vuelve a avisar, no duplica.
      throw new Error('Se escribieron ' + ok.length + ' filas pero la app no confirmó (' + aviso.getResponseCode() + '): ' + aviso.getContentText());
    }
    if (errores.length) avisarError_('app-a-planilla', errores.length + ' cargas no se pudieron escribir:\n' + errores.map(function (e) { return '#' + e.id + ' ' + e.error; }).join('\n'));
  } finally {
    lock.releaseLock();
  }
}

function escribirCargaDeLaApp_(tipo, d) {
  if (tipo === 'viaje') {
    const valores = mapViaje(d);
    if (d.idViaje) valores['ID VIAJE'] = d.idViaje; // la misma identidad en la app y en la planilla: el sync no lo duplica
    return insertarTipo('viaje', valores);
  }
  if (tipo === 'combustible') return insertarTipo('combustible', mapCombustible(d));
  if (tipo === 'proveedor') return insertarTipo('proveedor', mapProveedor(d));
  if (tipo === 'cheque') return insertarTipo('cheque', mapCheque(d));
  throw new Error('tipo desconocido: ' + tipo);
}
