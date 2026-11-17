/* Color para reconocer rápido los materiales más frecuentes (arena, base, 1 al 3); el resto toma un color de la paleta,
   siempre el mismo para el mismo nombre. Se usa en Pedidos y en Planeación. */
const COLORES_MATERIAL: Record<string, string> = { 'ARENA': '#d9b13b', 'BASE': '#8a5a2b', '1 AL 3': '#8b929c' };
const OTROS = ['#3e5c76', '#6f8f72', '#8c6a9e', '#e39b5b', '#b8862f', '#4f8f9c'];

export function colorMaterial(nombre: string): string {
  const k = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (COLORES_MATERIAL[k]) return COLORES_MATERIAL[k];
  let h = 0;
  for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return OTROS[h % OTROS.length];
}
