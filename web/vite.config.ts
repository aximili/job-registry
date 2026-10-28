import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// The dashboard is built once (npm run build) into web/dist, and the server serves it.
// In development, `npm run dev:web` serves it here and forwards /api to the server.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [svelte()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: {
    port: 5173,
    proxy: {
      // The server only accepts changes from its own origin, so present that origin.
      '/api': { target: 'http://127.0.0.1:4777', changeOrigin: true, headers: { origin: 'http://127.0.0.1:4777' } },
    },
  },
});
