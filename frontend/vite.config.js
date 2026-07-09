import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,          // expone el dev server en la red local (acceso desde el móvil)
    port: 5173,
    proxy: {
      // El proxy corre en la PC, así que /api siempre llega al backend en localhost:3000
      '/api': 'http://localhost:3000',
    },
  },
});
