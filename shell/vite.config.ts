import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5620,
    strictPort: true,
    // Phone companion loads this same dev server over the LAN.
    host: true,
  },
});
