import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Evita que Next confunda la raíz del proyecto con el package-lock.json de la carpeta de arriba.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
