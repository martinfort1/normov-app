import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'NOR MOV', description: 'Tablero de gestión · Nor Movimiento SAS' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
