// Integration adapters (FR-40). Every outside service has three modes: mock (made-up data, for
// development and tests), sandbox (test accounts) and live. A service without credentials runs as
// mock, and the dashboard shows that, so nobody mistakes mock output for the real thing.

export const INTEGRATION_MODES = ['mock', 'sandbox', 'live'] as const
export type IntegrationMode = typeof INTEGRATION_MODES[number]

export interface IntegrationStatus { service: string; label: string; mode: IntegrationMode; note: string }

export interface DocumentTemplate { name: string; content: string; source: string }

/** Google Drive: read official templates (TOR, SKB, LP, campaign) and the content library. */
export interface DriveAdapter {
  readonly mode: IntegrationMode
  template(brandId: string, name: string): Promise<DocumentTemplate | undefined>
}

/** Until the Drive service account is connected there are no official templates to read. */
export function mockDrive(): DriveAdapter {
  return {
    mode: 'mock',
    async template() { return undefined },
  }
}

export interface Integrations { drive: DriveAdapter }

export function integrationStatuses(integrations: Integrations): IntegrationStatus[] {
  return [
    { service: 'drive', label: 'Google Drive (template & library)', mode: integrations.drive.mode, note: integrations.drive.mode === 'mock' ? 'Service account belum disambungkan; template resmi belum terbaca.' : '' },
    { service: 'gpt-image', label: 'GPT Image', mode: 'mock', note: 'OpenAI API key belum ada (L2).' },
    { service: 'meta-ads', label: 'Meta Marketing API', mode: 'mock', note: 'Akun iklan sandbox belum ada (L3).' },
    { service: 'scalev', label: 'Scalev', mode: 'mock', note: 'API Scalev belum tersedia (L3).' },
  ]
}
