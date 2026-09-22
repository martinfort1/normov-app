import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'NOR MOV', description: 'Tablero de gestión · Nor Movimiento SAS' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
