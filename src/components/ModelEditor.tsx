import { useState } from 'react'
import { CLAUDE_NAMES } from '../model-labels.ts'
import { officeRequest, type AgentRoute, type ModelEntry, type ModelTestResult, type OfficeModels, type Weight } from '../office-api.ts'

const WEIGHT_LABELS: Record<Weight, string> = { simple: 'Sederhana', complex: 'Kompleks', urgent: 'Mendesak' }

function ModelRow({ agentType, weight, route, overridden, models, onChanged }: { agentType: string; weight: Weight; route: AgentRoute; overridden: boolean; models: OfficeModels; onChanged: () => void }) {
  const [source, setSource] = useState(route.source)
  const [model, setModel] = useState(route.model ?? '')
  const [effort, setEffort] = useState(route.reasoningEffort)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string }>()
  const draft = { source, model: model.trim() || undefined, reasoningEffort: effort }
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setNote(undefined)
    try { await work() } catch (failure) { setNote({ ok: false, text: failure instanceof Error ? failure.message : String(failure) }) } finally { setBusy(false) }
  }
  const path = `/models/${encodeURIComponent(agentType)}/${weight}`
  return <fieldset className="model-row" disabled={busy}>
    <legend>{WEIGHT_LABELS[weight]}{overridden ? ' · diubah' : ''}</legend>
    <label>Mesin
      <select value={source} onChange={(event) => { const next = event.target.value as AgentRoute['source']; setSource(next); setModel(next === 'litellm' ? models.claudeAliases[0] ?? '' : '') }}>
        <option value="codex">Codex (ChatGPT Plus)</option>
        {models.claudeAliases.length > 0 && <option value="litellm">Claude (pool LiteLLM)</option>}
      </select>
    </label>
    <label>Model
      {source === 'codex'
        ? <><input list={`codex-${agentType}-${weight}`} value={model} placeholder="bawaan (gpt-6-sol)" onChange={(event) => setModel(event.target.value)}/><datalist id={`codex-${agentType}-${weight}`}>{models.codexModels.map((name) => <option key={name} value={name}/>)}</datalist></>
        : <select value={model} onChange={(event) => setModel(event.target.value)}>{models.claudeAliases.map((alias) => <option key={alias} value={alias}>{CLAUDE_NAMES[alias] ?? alias} ({alias})</option>)}</select>}
    </label>
    <label>Reasoning
      <select value={effort} onChange={(event) => setEffort(event.target.value as AgentRoute['reasoningEffort'])}><option value="low">Rendah</option><option value="high">Tinggi</option></select>
    </label>
    <div className="model-actions">
      <button type="button" className="refresh-button" onClick={() => void run(async () => { await officeRequest('PUT', path, draft); setNote({ ok: true, text: 'Tersimpan.' }); onChanged() })}>Simpan</button>
      <button type="button" className="refresh-button" disabled={!overridden} onClick={() => void run(async () => { await officeRequest('DELETE', path); setNote({ ok: true, text: 'Dikembalikan ke bawaan.' }); onChanged() })}>Reset</button>
      <button type="button" className="refresh-button" title="Menjalankan satu tugas kecil dengan model ini; memakai sedikit kuota" onClick={() => void run(async () => {
        const result = await officeRequest<ModelTestResult>('POST', '/models/test', draft)
        setNote({ ok: result.ok, text: result.ok ? `Berjalan: "${result.reply}" (${(result.durationMs / 1000).toFixed(1)} dtk, ${result.inputTokens + result.outputTokens} token)` : `Gagal: ${result.reply || result.status}` })
      })}>Uji</button>
    </div>
    {note && <p className={note.ok ? 'small-note' : 'form-error'} role={note.ok ? 'status' : 'alert'}>{note.text}</p>}
  </fieldset>
}

/** Per-weight model settings of one agent role. Changes apply to every brand and are audited. */
export function ModelEditor({ entry, models, onChanged }: { entry: ModelEntry; models: OfficeModels; onChanged: () => void }) {
  const weights: Weight[] = models.profile === 'prod' ? ['simple', 'complex', 'urgent'] : ['simple', 'complex']
  return <details className="model-editor">
    <summary>Atur model</summary>
    {weights.map((weight) => <ModelRow key={`${weight}:${JSON.stringify(entry[weight])}`} agentType={entry.agentType} weight={weight} route={entry[weight]} overridden={entry.overridden.includes(weight)} models={models} onChanged={onChanged}/>)}
    <p className="small-note">Berlaku untuk peran ini di semua brand{models.profile === 'dev' ? '. Di profil development hanya Codex yang bisa dipilih' : ''}.</p>
  </details>
}
