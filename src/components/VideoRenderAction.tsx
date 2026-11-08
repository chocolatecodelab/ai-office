import { useState } from 'react'
import { officeRequest } from '../office-api.ts'

export function VideoRenderAction({ brand, taskId }: { brand: string; taskId: string }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const handleRender = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await officeRequest('POST', `/brands/${encodeURIComponent(brand)}/agents/video-editor/production/render`, {
        sourceTaskId: taskId,
      })
      setMessage('Tugas render telah diajukan. Mesin Remotion sedang memproses encoding video, normalisasi audio, dan thumbnail di antrean.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="delivery-status" aria-label="Aksi render video">
      <div>
        <strong>Pipeline Render Video</strong>
        <span>Storyboard Disetujui</span>
      </div>
      <p style={{ margin: '8px 0', fontSize: '14px', color: '#ccc' }}>
        Storyboard visual telah disetujui. Anda dapat menjalankan rendering Remotion resolusi penuh (1080×1920) dengan normalisasi audio loudness (-14 LUFS) dan ekspor subtitle.
      </p>
      {message && <p role="status" style={{ color: '#4ade80', fontSize: '13px', margin: '6px 0' }}>{message}</p>}
      {error && <p role="alert" style={{ color: '#f87171', fontSize: '13px', margin: '6px 0' }}>{error}</p>}
      <button className="primary-button" disabled={busy} onClick={handleRender} style={{ marginTop: '8px' }}>
        {busy ? 'Mengajukan render…' : 'Render Video MP4 (Remotion)'}
      </button>
    </section>
  )
}

