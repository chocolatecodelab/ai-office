// Which approval a piece of work needs, from context/_shared/approval-matrix.md (FR-21).
// A task's kind is "<area>.<work>", for example "event.tema" or "konten.carousel".

export const APPROVAL_TYPES = ['konten', 'publikasi', 'iklan', 'budget', 'event', 'consent'] as const
export type ApprovalType = typeof APPROVAL_TYPES[number]

/** Who decides each approval type, as the matrix names them. */
export const APPROVERS: Record<ApprovalType, string> = {
  konten: 'Reviewer / Mbak Nia',
  publikasi: 'Reviewer sesuai SOP',
  iklan: 'Marketing / atasan',
  budget: 'Pemegang otorisasi budget (Budget Approver)',
  event: 'Reviewer event',
  consent: 'Pemilik cerita dan pihak berwenang',
}

const AREA_ROUTES: Record<string, ApprovalType> = {
  event: 'event',
  konten: 'konten',
  video: 'konten',
  publikasi: 'publikasi',
  iklan: 'iklan',
  budget: 'budget',
  testimoni: 'consent',
}

export function approvalTypeFor(kind: string): ApprovalType {
  const area = kind.split('.')[0]
  const route = AREA_ROUTES[area]
  if (!route) throw new Error(`Jenis pekerjaan "${kind}" belum punya jalur approval di approval-matrix.`)
  return route
}
