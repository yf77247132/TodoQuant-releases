import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    hmr: false,
    host: '0.0.0.0',
    port: 3000,
    watch: {
      ignored: [
        '**/trading.db*',
        '**/*.db',
        '**/*.db-wal',
        '**/*.db-shm',
        '**/config.json',
        '**/_test_*',
        '**/logs/**',
        '**/backups/**',
        '**/.workbuddy/**',
        '**/node_modules/**',
      ],
    },
  },
  build: {
    sourcemap: false,
    minify: 'esbuild',
    esbuild: {
      drop: ['console', 'debugger'],
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@binance')) return 'vendor-binance';
            if (id.includes('better-sqlite3')) return 'vendor-sqlite';
            if (id.includes('react') || id.includes('react-dom')) return 'vendor-react';
          }
        },
      },
    },
  },
}));
