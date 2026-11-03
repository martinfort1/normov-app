export function SinAcceso({ seccion }: { seccion: string }) {
  return (
    <>
      <h1>{seccion}</h1>
      <div className="banner">
        No tenés acceso a esta sección. Si la necesitás, pedile a un administrador que te la habilite.
      </div>
    </>
  );
}
