/* Subida de adjuntos (fotos de remitos, comprobantes) al almacenamiento de Supabase, desde el navegador.
   Las fotos se achican antes de subir (lado mayor 1600 px, JPEG): una foto de celular pasa de ~4 MB a ~300 KB.
   El permiso lo controla la base: solo se puede subir a la carpeta de una sección en la que se puede cargar. */
import { createClient } from '@/lib/supabase/browser';

export type CarpetaAdjunto = 'viajes' | 'combustible' | 'proveedores' | 'cheques';
const MAX_ORIGINAL = 15 * 1024 * 1024;
const MAX_PDF = 5 * 1024 * 1024;

async function achicar(file: File, lado = 1600, calidad = 0.82): Promise<Blob> {
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const escala = Math.min(1, lado / Math.max(img.width, img.height));
  const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo procesar la imagen.');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  img.close();
  return new Promise((ok, mal) => canvas.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo procesar la imagen.'))), 'image/jpeg', calidad));
}

/** Sube el archivo y devuelve la ruta que se guarda en el registro (campo foto_path). */
export async function subirAdjunto(file: File, carpeta: CarpetaAdjunto): Promise<string> {
  if (file.size > MAX_ORIGINAL) throw new Error('El archivo es demasiado grande (máximo 15 MB).');
  let blob: Blob = file, ext = 'jpg', tipo = 'image/jpeg';
  if (file.type === 'application/pdf') {
    if (file.size > MAX_PDF) throw new Error('El PDF es demasiado grande (máximo 5 MB).');
    ext = 'pdf'; tipo = 'application/pdf';
  } else if (file.type.startsWith('image/')) {
    try { blob = await achicar(file); }
    catch { if (file.size > MAX_PDF) throw new Error('No se pudo leer la imagen. Probá con una foto JPG o PNG.'); ext = file.type.split('/')[1] || 'jpg'; tipo = file.type; }
  } else {
    throw new Error('Solo se aceptan fotos (JPG, PNG…) o PDF.');
  }
  const mes = new Date().toISOString().slice(0, 7);
  const ruta = `${carpeta}/${mes}/${crypto.randomUUID()}.${ext}`;
  const { error } = await createClient().storage.from('adjuntos').upload(ruta, blob, { contentType: tipo, upsert: false });
  if (error) {
    if (/row-level security|not authorized|unauthorized/i.test(error.message)) throw new Error('No tenés permiso para adjuntar archivos en esta sección.');
    if (/bucket not found/i.test(error.message)) throw new Error('Falta crear el almacenamiento de adjuntos: correr la migración 0006_cargar.sql en Supabase.');
    throw new Error(`No se pudo subir el archivo: ${error.message}`);
  }
  return ruta;
}

/** Si el registro no se pudo guardar después de subir el archivo, lo borra para no dejar basura. */
export async function descartarAdjunto(ruta: string) {
  try { await createClient().storage.from('adjuntos').remove([ruta]); } catch { /* no es grave */ }
}
