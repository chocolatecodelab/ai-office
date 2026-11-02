import { Canvas } from '@react-three/fiber'
import { useMemo, type ReactNode } from 'react'
import { AGENT_NAMES, AGENT_STATUS_LABELS } from '../office-api.ts'
import { agentSpot, liveBuilding, STATUS_COLORS, STATUS_ICONS } from '../office3d/live.ts'
import { BuildingScene } from '../scene3d/building.tsx'
import { useFurniture } from '../scene3d/furniture.ts'
import { Camera, SeatedAvatar } from './Lab3D.tsx'
import type { OfficeData } from './BlueprintOffice.tsx'

export default function OfficeLive3D({ data, floor, setFloor, fallback }: { fallback: ReactNode; data: OfficeData; floor: number; setFloor: (floor: number) => void }) {
  const { library, error } = useFurniture()
  const layout = useMemo(() => liveBuilding(data.brands), [data.brands])
  const agents = data.brands.flatMap((brand) => brand.agents.filter((agent) => agent.active).map((agent) => ({ ...agent, brand: brand.name })))
  if (error) throw new Error(error)
  if (!library) return <p>Memuat furnitur kantor…</p>
  return <div className="lab-3d">
    <div className="lab-3d-bar" aria-label="Pilih lantai">{layout.floors.map((item) => <button key={item.index} aria-pressed={floor === item.index} onClick={() => setFloor(item.index)}>
      {item.index === 0 ? 'G · Bersama' : `${item.index} · ${item.brand?.name}`}
      {item.brand && ` · ${agents.filter((agent) => agent.brandId === item.brand?.id && agent.status === 'waiting_approval').length} approval`}
    </button>)}</div>
    <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 42, near: 0.5, far: 200 }} fallback={fallback}>
      <color attach="background" args={['#1c211d']}/>
      <hemisphereLight args={['#ffffff', '#445044', 1.1]}/>
      <directionalLight position={[8, 30, 12]} intensity={1.7}/>
      <BuildingScene layout={layout} library={library} floor={floor}/>
      {agents.map((agent, index) => {
        const spot = agentSpot(layout, agent.brandId, agent.agentType, agent.status, index)
        if (!spot || spot.floor !== floor) return null
        const pose = agent.status === 'working' || agent.status === 'revision' ? 'kerja' : agent.status === 'waiting_quota' ? 'tidur' : 'idle'
        return <group key={`${agent.brandId}:${agent.agentType}`}>
          <SeatedAvatar id={`${agent.brandId}:${agent.agentType}`} seat={spot} pose={pose}/>
          <mesh position={[spot.position[0], spot.position[1] + 2, spot.position[2]]}>
            <sphereGeometry args={[0.12, 8, 8]}/><meshBasicMaterial color={STATUS_COLORS[agent.status]}/>
          </mesh>
        </group>
      })}
      <Camera floor={floor}/>
    </Canvas>
    <div className="chip-row" aria-label="Status agen di lantai">{agents.map((agent, index) => {
      if (agentSpot(layout, agent.brandId, agent.agentType, agent.status, index)?.floor !== floor) return null
      const task = data.tasks.find((task) => task.brandId === agent.brandId && task.agentType === agent.agentType && task.status === 'waiting_quota')
      return <span className="chip" key={`${agent.brandId}:${agent.agentType}`}>
        {agent.brand} · {AGENT_NAMES[agent.agentType]} · {STATUS_ICONS[agent.status]} {AGENT_STATUS_LABELS[agent.status]}
        {agent.currentTask && ` · ${agent.currentTask}`}{task?.retryAt && ` · Coba lagi ${new Date(task.retryAt).toLocaleString('id-ID')}`}
      </span>
    })}</div>
  </div>
}
