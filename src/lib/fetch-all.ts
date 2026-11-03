/** PostgREST devuelve como máximo 1000 filas por consulta: esto pagina hasta traer todo.
 *  El tipo de las filas lo elige quien llama (T): Supabase tipa los datos embebidos (clientes(razon_social)…) como listas,
 *  aunque en la práctica vengan como objeto, así que no se puede inferir solo. */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  size = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    const filas = (data ?? []) as T[];
    out.push(...filas);
    if (filas.length < size) return out;
  }
}
