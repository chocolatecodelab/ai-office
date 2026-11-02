#!/usr/bin/env node
// Reads an image on stdin and writes it on stdout as WebP, at most <size> px on its longer side.
// Run as its own process by optimize-models.mjs (see that file's header for why).
import sharp from 'sharp'

const size = Number(process.argv[2]) || 512
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const webp = await sharp(Buffer.concat(chunks)).resize(size, size, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
process.stdout.write(webp)
