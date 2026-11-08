import crypto from 'node:crypto'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import type { BinaryLike, BinaryToTextEncoding } from 'node:crypto'

// Polyfill for Node < 20.19 where crypto.hash does not exist
type HashFunction = (algorithm: string, data: BinaryLike, outputEncoding?: BinaryToTextEncoding) => string | Buffer
const legacyCrypto = crypto as unknown as { hash?: HashFunction }
if (typeof legacyCrypto.hash !== 'function') {
  legacyCrypto.hash = (algorithm, data, outputEncoding) => {
    const hash = crypto.createHash(algorithm).update(data)
    return outputEncoding ? hash.digest(outputEncoding) : hash.digest()
  }
}

export default defineConfig({
  plugins: [react()],
  // three.js lives in its own lazily loaded chunk (the 3D office view).
  build: { chunkSizeWarningLimit: 1100 },
  // ws: the office change feed (/api/office/ws) goes through the same proxy.
  server: { proxy: { '/api': { target: `http://127.0.0.1:${process.env.RUANG_PORT || 3001}`, ws: true } } },
})

