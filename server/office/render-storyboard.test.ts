import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-ignore
import { renderStoryboard } from '../../scripts/render-storyboard.mjs'

describe('renderStoryboard generator', () => {
  it('generates visual storyboard stills, HTML package, and revision props for video plan', async () => {
    const videoRoot = 'D:/KERJAAN/CODING/CLAUDE/VIDEO_EDITOR/video-system'
    const workDir = await mkdtemp(join(tmpdir(), 'sb-test-'))
    try {
      const plan = {
        objective: 'Edukasi S1 Jerman',
        audience: 'Orang tua siswa',
        subtitleStyle: 'full',
        scenes: [
          {
            title: 'Peluang S1',
            duration: 4,
            narration: 'Halo parents, peluang beasiswa S1 di Jerman sangat terbuka.',
            onScreen: 'Peluang S1 Jerman',
            layout: 'split',
            visual: 'Pintu gerbang peluang studi',
            motion: 'Berkas dan lambang jenjang muncul bertahap.',
            audio: 'VO natural',
          },
          {
            title: 'Persyaratan Utama',
            duration: 4,
            narration: 'Ketahui syarat bahasa dan dokumen sebelum mendaftar.',
            onScreen: 'Syarat Bahasa & Dokumen',
            layout: 'full',
            visual: 'Pemeriksaan seleksi dan dokumen',
            motion: 'Kriteria dicek berurutan.',
            audio: 'SFX checkmark',
          },
        ],
        materials: ['Footage talent'],
        risks: ['Konfirmasi jadwal DAAD'],
      }

      const request = {
        brand: 'otca',
        title: 'Video Edukasi S1 Jerman OTCA',
        slug: 'test-sb-' + Date.now(),
        video: {
          preset: 'glass-tech-bukti-sosial',
          plan,
        },
      }

      await writeFile(join(workDir, 'request.json'), JSON.stringify(request, null, 2))

      const result = await renderStoryboard(videoRoot, workDir)
      expect(result.rendered).toBe(true)
      expect(result.scenesCount).toBe(3) // 2 scenes + 1 closing brand scene

      // Check generated files in work/project
      const html = await readFile(join(workDir, 'project', 'storyboard-visual.html'), 'utf8')
      expect(html).toContain('data:image/png;base64,')
      expect(html).toContain('Content-Security-Policy')
      expect(html).toContain('Peluang S1 Jerman')

      const props = JSON.parse(await readFile(join(workDir, 'project', 'revision-props.json'), 'utf8'))
      expect(props.scenes).toHaveLength(3)
      expect(props.scenes[0].heading).toContain('Peluang S1 Jerman')

      const revision = JSON.parse(await readFile(join(workDir, 'project', 'video-revision.json'), 'utf8'))
      expect(revision.stage).toBe('storyboard-visual')
      expect(revision.propsSha256).toBeDefined()
      expect(revision.previewSha256).toBeDefined()

      const srt = await readFile(join(workDir, 'project', 'subtitle.srt'), 'utf8')
      expect(srt).toContain('Halo parents')

      const provenance = JSON.parse(await readFile(join(workDir, 'project', 'storyboard-provenance.json'), 'utf8'))
      expect(provenance.renderedByOffice).toBe(true)
      expect(provenance.images.length).toBeGreaterThanOrEqual(5) // 3 scenes + 3 proof stills
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  }, 180000)
})
