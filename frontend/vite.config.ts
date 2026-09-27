import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@design': path.resolve(__dirname, '../design'),
    },
  },
  server: {
    host: true, // bind 0.0.0.0 for Headscale reachability
    proxy: {
      '/api': {
        // Backend base URL; override with VITE_PROXY_TARGET when the backend
        // is not on the default port (e.g. :8000 taken by another service).
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
