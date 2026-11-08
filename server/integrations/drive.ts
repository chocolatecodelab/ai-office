import type { OfficeStore } from '../office/store.js'
import type { Connections } from './connections.js'
import { driveTemplate, type Fetcher } from './google.js'
import type { DriveAdapter, IntegrationMode } from './index.js'

/**
 * The Drive adapter the office runs on: for each brand it reads the connected account when that brand's mode is not
 * mock, and returns nothing otherwise, so a stage without a template simply goes on without one (as it did in mock).
 * `mode` is what the dashboards show: live when any brand is connected and asked for it.
 */
export function routedDrive(store: OfficeStore, connections: Connections, fetcher: Fetcher = fetch): DriveAdapter & { refresh(): Promise<void> } {
  let mode: IntegrationMode = 'mock'
  const refresh = async () => {
    const [modes, connected] = await Promise.all([store.integrationModes(), store.connections()])
    mode = connected.some((item) => item.service === 'drive' && item.status === 'active' && (modes.get(item.brandId)?.get('drive') ?? 'mock') !== 'mock') ? 'live' : 'mock'
  }
  return {
    get mode() { return mode },
    refresh,
    async template(brandId, name) {
      const asked = (await store.integrationModes()).get(brandId)?.get('drive') ?? 'mock'
      if (asked === 'mock') return undefined
      try {
        return await driveTemplate(fetcher, await connections.accessToken(brandId, 'drive'), name)
      } catch (cause) {
        console.warn(`Drive: template "${name}" untuk ${brandId} tidak terbaca: ${cause instanceof Error ? cause.message : String(cause)}`)
        return undefined
      }
    },
  }
}
