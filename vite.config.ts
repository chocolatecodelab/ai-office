import crypto from 'node:crypto'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Polyfill for Node < 20.19 where crypto.hash does not exist
if (typeof (crypto as any).hash !== 'function') {
  ;(crypto as any).hash = function (algorithm: string, data: any, outputEncoding?: any) {
    return crypto.createHash(algorithm).update(data).digest(outputEncoding)
  }
}

export default defineConfig({
  plugins: [react()],
  // three.js lives in its own lazily loaded chunk (the 3D office view).
  build: { chunkSizeWarningLimit: 1100 },
  // ws: the office change feed (/api/office/ws) goes through the same proxy.
  server: { proxy: { '/api': { target: `http://127.0.0.1:${process.env.RUANG_PORT || 3001}`, ws: true } } },
})

