import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// `base` lets the bundle work when served from a subpath like
// https://mattc1987.github.io/hashio-crm/. In dev (`npm run dev`) Vite
// still uses '/' so localhost stays clean.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/hashio-crm/' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
}))
