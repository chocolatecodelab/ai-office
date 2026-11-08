import { EventEmitter } from 'node:events'

// In-process change feed: the store announces every change, and the WebSocket endpoint forwards
// each one only to clients watching that brand (FR-31, FR-63).

export type OfficeChange =
  | { type: 'task'; brandId: string; taskId: string; status: string }
  | { type: 'approval'; brandId: string; approvalId: string; taskId: string; decision: string | null }
  | { type: 'event'; brandId: string; eventId: string; stage: string }
  | { type: 'agent'; brandId: string; agentType: string }

export class OfficeBus {
  private readonly emitter = new EventEmitter()
  constructor() { this.emitter.setMaxListeners(0) }
  publish(change: OfficeChange): void { this.emitter.emit('change', change) }
  subscribe(listener: (change: OfficeChange) => void): () => void {
    this.emitter.on('change', listener)
    return () => { this.emitter.off('change', listener) }
  }
}
