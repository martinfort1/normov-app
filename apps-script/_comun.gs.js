/*
  Funciones que comparten los tres scripts de sync (sync-planilla, sync-diego, sync-combustible).
  Pegar este archivo COMO UN ARCHIVO NUEVO en el proyecto de Apps Script de cada planilla, junto con
  el que corresponda. Si esa planilla ya tiene otro script instalado (por ejemplo el que hace que el
  artifact pueda escribir remitos/cheques/pagos de vuelta en la hoja), NO LO BORRES: es un mecanismo
  aparte, en el sentido contrario, y no comparte ningún nombre de función con esto.

  Configuración (una vez, en Configuración del proyecto → Propiedades del script):
    SYNC_URL     = https://TU-DOMINIO/api/sync     (la URL de la app ya desplegada)
    SYNC_SECRET  = el mismo valor que SYNC_SECRET en el .env / Vercel de la app
*/

function leerHoja_(nombre) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!sh) return null;
  const rango = sh.getDataRange().getValues();
  // Las fechas llegan como Date de Apps Script: se convierten a "AAAA-MM-DD" para que no haya
  // ambigüedad de huso horario al viajar como JSON. Todo lo demás (texto, número) queda igual.
  const tz = Session.getScriptTimeZone() || 'America/Argentina/Tucuman';
  return rango.map(function (fila) {
    return fila.map(function (celda) {
      return celda instanceof Date ? Utilities.formatDate(celda, tz, 'yyyy-MM-dd') : celda;
    });
  });
}

/** Arma { nombreHoja: filas } con las hojas pedidas que existan en esta planilla. */
function leerHojas_(nombres) {
  const sheets = {};
  nombres.forEach(function (n) {
    const filas = leerHoja_(n);
    if (filas) sheets[n] = filas;
  });
  return sheets;
}

function enviar_(archivo, sheets) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SYNC_URL');
  const secreto = props.getProperty('SYNC_SECRET');
  if (!url || !secreto) {
    throw new Error('Faltan SYNC_URL o SYNC_SECRET en Propiedades del script (Configuración del proyecto).');
  }

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + secreto },
    payload: JSON.stringify({ archivo: archivo, sheets: sheets }),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  const texto = res.getContentText();
  if (code !== 200) {
    avisarError_(archivo, code + ': ' + texto);
    throw new Error('Sync de "' + archivo + '" falló (' + code + '): ' + texto);
  }
  Logger.log('[' + archivo + '] ' + texto);
}

/** Si falla, un mail simple. Poné tu email en Propiedades del script como AVISO_EMAIL (opcional).
 *  El mismo error se avisa una sola vez por día, para que un problema que dura horas no llene la casilla. */
function avisarError_(archivo, detalle) {
  try {
    const props = PropertiesService.getScriptProperties();
    const email = props.getProperty('AVISO_EMAIL');
    if (!email) return;

    const clave = 'ULTIMO_AVISO_' + archivo;
    const hoy = Utilities.formatDate(new Date(), 'America/Argentina/Tucuman', 'yyyy-MM-dd');
    const marca = hoy + '|' + String(detalle).slice(0, 200);
    if (props.getProperty(clave) === marca) return; // mismo error, mismo día: ya se avisó
    props.setProperty(clave, marca);

    MailApp.sendEmail(email, 'NORMOV: falló el sync de ' + archivo, 'Detalle:\n\n' + detalle);
  } catch (e) {
    Logger.log('No se pudo avisar por mail: ' + e);
  }
}
