import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The console is served by the FastAPI app in production (ui/server/app.py
// mounts dist/). In dev, `npm run dev` proxies the API to that same server so
// both modes hit identical paths.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8551',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
