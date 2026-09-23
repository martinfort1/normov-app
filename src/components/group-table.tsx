import type { Grupo } from '@/lib/agrupar';
import { qtyText, margen } from '@/lib/agrupar';
import { money, num1 } from '@/lib/format';

function Fila({ o, showMargin, maxNeto }: { o: Grupo; showMargin?: boolean; maxNeto: number }) {
  const { mg, pct, clase } = margen(o);
  return (
    <tr>
      <td>{o.k}</td>
      <td className="r">{o.n}</td>
      <td className="r">{qtyText(o, num1)}</td>
      <td className="r">{money(o.neto)}</td>
      {showMargin && (
        <td className="r">
          {money(mg)} {pct != null && <span className={`pill ${clase}`}>{num1(pct)}%</span>}
        </td>
      )}
      <td className="bar"><span style={{ width: `${maxNeto ? Math.max(2, Math.round((o.neto / maxNeto) * 100)) : 0}%` }} /></td>
    </tr>
  );
}

/** Tabla "Por cliente / chofer / camión / cantera / material", con los primeros 12 y el resto en "ver más". */
export function GroupTable({ titulo, rows, showMargin }: { titulo: string; rows: Grupo[]; showMargin?: boolean }) {
  const max = rows.reduce((x, o) => Math.max(x, o.neto), 0);
  const top = rows.slice(0, 12), resto = rows.slice(12);
  const cols = showMargin ? 6 : 5;
  const head = (
    <thead><tr><th>{titulo}</th><th className="r">Viajes</th><th className="r">Cantidad</th><th className="r">Venta neta</th>{showMargin && <th className="r">Margen</th>}<th /></tr></thead>
  );
  return (
    <>
      <div className="tbl-wrap">
        <table>
          {head}
          <tbody>
            {top.length ? top.map((o) => <Fila key={o.k} o={o} showMargin={showMargin} maxNeto={max} />) : <tr><td colSpan={cols} className="empty">Sin viajes en el período</td></tr>}
          </tbody>
        </table>
      </div>
      {resto.length > 0 && (
        <details>
          <summary>Ver {resto.length} más</summary>
          <div className="tbl-wrap">
            <table>
              {head}
              <tbody>{resto.map((o) => <Fila key={o.k} o={o} showMargin={showMargin} maxNeto={max} />)}</tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}
