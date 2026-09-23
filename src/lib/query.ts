/** Arma un querystring a partir de los parámetros actuales, cambiando solo los que se pasan. */
export function conParams(sp: object, cambios: Record<string, string | null>): string {
  const sp2 = sp as Record<string, string | undefined>;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp2)) if (v != null && !(k in cambios)) params.set(k, v);
  for (const [k, v] of Object.entries(cambios)) if (v != null) params.set(k, v);
  const qs = params.toString();
  return qs ? `?${qs}` : '?';
}
