import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Configurazione pensata per Tauri: porta fissa, niente pulizia dello schermo
// (così si vedono gli errori di Rust) e src-tauri escluso dal watcher.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'safari16',
    sourcemap: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
