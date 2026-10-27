import { PageTitle } from '../ui.tsx'
import { TokenUsage } from './TokenUsage.tsx'

/** Token usage of the whole crew as its own page (also in the Office: Tokens button, and Panel → Stats). */
export function Usage() {
  return <><PageTitle eyebrow="CLAUDE USAGE" title="Token usage">Pemakaian token, sesi, dan estimasi biaya per agen Claude, model AI, dan jenis pekerjaan.</PageTitle>
    <div className="usage-page"><TokenUsage/></div></>
}
