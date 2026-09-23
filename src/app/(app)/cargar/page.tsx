export default function Cargar() {
  return (
    <>
      <h1>Cargar datos</h1>
      <p className="lede">Cargar un viaje, combustible, proveedor, cliente o cheque directo desde acá, sin pasar por la planilla.</p>
      <div className="panel">
        <p>
          Todavía no está armada. En el tablero de FRAN, lo que se carga acá se manda como un archivo a Drive y el
          script de la planilla lo pega en la hoja — así todo queda también en Sheets.
        </p>
        <p>
          Acá tenemos la base directa (Postgres), así que hay dos caminos posibles y quiero que elijas antes de
          construirla:
        </p>
        <ul>
          <li><strong>Directo a la base:</strong> más simple y rápido, pero lo que cargues acá no aparece en la planilla de Google Sheets.</li>
          <li><strong>A la base y también a la planilla:</strong> como en el tablero de FRAN, para que Sheets siga reflejando todo. Es más trabajo (hay que armar el mismo mecanismo de dejar un archivo para que el Apps Script lo procese).</li>
        </ul>
        <p>¿Cuál preferís?</p>
      </div>
    </>
  );
}
