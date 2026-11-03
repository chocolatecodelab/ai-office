import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { nextVisits, type Visit } from '../office3d/roaming.ts'
import { renderQuality, type OfficeQuality } from '../office3d/quality.ts'
import { LiftQueue } from '../office3d/lift-queue.ts'
import { Lift } from '../scene3d/lift.tsx'
import { agentLook } from '../agents.ts'
import { AGENT_NAMES, AGENT_STATUS_LABELS, type AgentStatus, type OfficeAgent, type OfficeBrand } from '../office-api.ts'
import { agentSpot, liveBuilding, STATUS_COLORS } from '../office3d/live.ts'
import { FLOOR_HEIGHT, LIFT, LIFT_LANE_X, floorAt, route, type BuildingLayout, type Spot } from '../office3d/building.ts'
import { AvatarBody, type AvatarParts } from '../scene3d/character.tsx'
import { defaultRoomControls, idleActivity, roomForSpot, type ActivityRoom, type RoomControls } from '../office3d/activities.ts'
import { RoomEffects } from '../scene3d/room-effects.tsx'
import { BuildingScene } from '../scene3d/building.tsx'
import { OfficeChair, WorkDesk } from '../scene3d/props.tsx'
import { useFurniture } from '../scene3d/furniture.ts'

function Camera({ floor, overview, reset }: { floor: number; overview: boolean; reset: number }) {
  const { camera, gl, size } = useThree()
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl])
  useEffect(() => () => controls.dispose(), [controls])
  useEffect(() => {
    controls.maxPolarAngle = Math.PI / 2.15
    controls.minDistance = 6
    controls.maxDistance = 80
    controls.target.set(-1, floor * FLOOR_HEIGHT + 0.8, 0)
    const aspect = gl.domElement.clientWidth / Math.max(1,gl.domElement.clientHeight)
    const distance = Math.max(22, Math.min(70, 17 / (Math.tan(21*Math.PI/180)*aspect)))
    camera.position.copy(controls.target).add(new THREE.Vector3(0,14,17).setLength(distance))
    // Initial camera position only; floor changes glide below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controls, reset, size.width, size.height, overview])
  useEffect(()=>{
    const element=gl.domElement.closest('.blueprint-scene')
    const key=(event:Event)=>{
      const e=event as KeyboardEvent
      if(e.target instanceof HTMLElement && e.target.matches('button,input,select,textarea,a')) return
      const directions:Record<string,[number,number,number]>={ArrowLeft:[-0.7,0,0],ArrowRight:[0.7,0,0],ArrowUp:[0,0,-0.7],ArrowDown:[0,0,0.7]}
      const direction=directions[e.key];if(!direction)return
      e.preventDefault()
      const x=THREE.MathUtils.clamp(controls.target.x+direction[0],-14,14)-controls.target.x
      const z=THREE.MathUtils.clamp(controls.target.z+direction[2],-8,8)-controls.target.z
      controls.target.x+=x;controls.target.z+=z;camera.position.x+=x;camera.position.z+=z
    }
    element?.addEventListener('keydown',key)
    return()=>element?.removeEventListener('keydown',key)
  },[camera,controls,gl])
  const scratch = useMemo(()=>new THREE.Vector3(),[])
  useFrame((_,delta) => {
    const goal = scratch.set(controls.target.x, overview ? FLOOR_HEIGHT * 2 : floor * FLOOR_HEIGHT + 0.8, controls.target.z)
    const step = goal.sub(controls.target).multiplyScalar(1-Math.exp(-5*Math.min(delta,0.1)))
    controls.target.add(step)
    camera.position.add(step)
    if (overview && camera.position.distanceTo(controls.target) < 43) camera.position.add(scratch.copy(camera.position).sub(controls.target).normalize().multiplyScalar(24*Math.min(delta,0.1)))
    controls.update()
  })
  return null
}

function Agent({ id, agent, spot, layout, floor, activities, motion, onArrive, traffic, liftQueue, onSelect }: { id: string; agent: OfficeAgent; spot: Spot; layout: BuildingLayout; floor: number; activities: RoomControls; motion: boolean; onArrive: (id: string, key: string) => void; traffic: Map<string, THREE.Vector3>; liftQueue: LiftQueue; onSelect: (id: string) => void }) {
  const root = useRef<THREE.Group>(null)
  const parts: AvatarParts = { body: useRef(null), leftLeg: useRef(null), rightLeg: useRef(null), leftArm: useRef(null), rightArm: useRef(null) }
  const limbs=useMemo(()=>[parts.leftLeg,parts.rightLeg,parts.leftArm,parts.rightArm,parts.body],[parts.leftLeg,parts.rightLeg,parts.leftArm,parts.rightArm,parts.body])
  const [start] = useState(() => spot.position)
  const [hovered, setHovered] = useState(false)
  const target = useRef(spot)
  const path = useRef<THREE.Vector3[]>([])
  const reported = useRef<string | undefined>(undefined)
  const lamp = useRef<THREE.Mesh>(null)
  const poseBuffer=useRef(new Float32Array(20))
  const directionBuffer=useMemo(()=>new THREE.Vector3(),[])
  const handProp = useRef<THREE.Group>(null)
  useEffect(() => () => { traffic.delete(id); liftQueue.release(id) }, [traffic,id,liftQueue])
  useEffect(() => {
    if (target.current.key === spot.key && target.current.position.join(',') === spot.position.join(',')) return
    reported.current = undefined
    // Finish the current route before heading to a new destination, even if status changes mid-lift.
    path.current.push(...route(layout, target.current, spot).map((point) => new THREE.Vector3(...point)))
    target.current = spot
  }, [layout, spot])
  useFrame((frame, delta) => {
    const group = root.current
    if (!group) return
    const time = frame.clock.elapsedTime
    let next = path.current[0]
    // Hold the reservation from boarding until the passenger has exited on the destination floor.
    if (liftQueue.has(id) && group.position.x <= LIFT_LANE_X+0.02 && next && next.x < LIFT_LANE_X) liftQueue.release(id)
    let waitingLift = false
    let walkingToQueue = false
    if (next && next.x === LIFT.x && group.position.x <= LIFT_LANE_X+0.02 && (motion || agent.status !== 'idle' || liftQueue.has(id))) {
      if (!liftQueue.request(id,floorAt(group.position.y),floorAt(path.current.find(p => Math.abs(p.y-group.position.y)>0.3)?.y ?? spot.position[1]),time)) {
        waitingLift = true
        const slot = new THREE.Vector3(LIFT_LANE_X,group.position.y,LIFT.z+0.48*(liftQueue.rank(id)+1))
        const offset = slot.sub(group.position)
        const distance=offset.length()
        walkingToQueue=distance>0.03
        // Walk facing the way they go; once in the queue, face the lift door (+x).
        const facing = walkingToQueue ? Math.atan2(offset.x,offset.z) : Math.PI/2
        group.rotation.y += Math.atan2(Math.sin(facing-group.rotation.y),Math.cos(facing-group.rotation.y)) * (1-Math.exp(-12*delta))
        if(walkingToQueue) group.position.add(offset.normalize().multiplyScalar(Math.min(distance,Math.min(delta,0.1)*1.8)))
      } else if (Math.abs(group.position.z-LIFT.z)>0.03) {
        path.current.unshift(new THREE.Vector3(LIFT_LANE_X,group.position.y,LIFT.z))
        next=path.current[0]
      }
    }
    let walking = walkingToQueue
    if (next && !waitingLift && (motion || agent.status !== 'idle' || liftQueue.has(id))) {
      const direction = directionBuffer.copy(next).sub(group.position)
      const distance = direction.length()
      if (distance < 0.03) { group.position.copy(next); path.current.shift() }
      else {
        const vertical = Math.abs(direction.y) > 0.01 && Math.hypot(direction.x,direction.z) < 0.01
        const boarding = vertical && !liftQueue.canDepart(id,time)
        walking = !vertical
        group.position.add(direction.normalize().multiplyScalar(Math.min(distance, Math.min(delta,0.1) * (boarding ? 0 : vertical ? 3.4 : 1.8))))
        if (walking) group.rotation.y += Math.atan2(Math.sin(Math.atan2(direction.x,direction.z)-group.rotation.y),Math.cos(Math.atan2(direction.x,direction.z)-group.rotation.y)) * (1-Math.exp(-12*delta))
      }
    }
    traffic.set(id, group.position)
    if (!path.current.length && reported.current !== spot.key) { reported.current = spot.key; onArrive(id,spot.key) }
    group.visible = floorAt(group.position.y) === floor
    if (!group.visible) return
    const arrived = path.current.length === 0
    const asleep = arrived && agent.status === 'waiting_quota'
    const typing = arrived && ['working', 'revision'].includes(agent.status)
    const seated = arrived && spot.seated && agent.status !== 'error'
    if (arrived) group.rotation.y += Math.atan2(Math.sin(spot.facing-group.rotation.y),Math.cos(spot.facing-group.rotation.y)) * (1-Math.exp(-10*delta))
    limbs.forEach((ref,i)=>{const obj=ref.current;if(obj){const old=poseBuffer.current,n=i*4;old[n]=obj.rotation.x;old[n+1]=obj.rotation.y;old[n+2]=obj.rotation.z;old[n+3]=obj.position.y}})
    const swing = walking ? Math.sin(time * 10) * 0.6 : 0
    const speed = agent.status === 'revision' ? 20 : 14
    if (parts.leftLeg.current) parts.leftLeg.current.rotation.x = seated ? -Math.PI / 2.2 : swing
    if (parts.rightLeg.current) parts.rightLeg.current.rotation.x = seated ? -Math.PI / 2.2 : -swing
    if (parts.leftArm.current) parts.leftArm.current.rotation.x = asleep ? -1.35 : typing ? -1.1 + Math.sin(time * speed) * 0.12 : -swing
    if (parts.rightArm.current) parts.rightArm.current.rotation.x = asleep ? -1.35 : typing ? -1.1 + Math.cos(time * speed) * 0.12 : arrived && agent.status === 'error' ? -2.4 + Math.sin(time * 3) * 0.15 : swing
    if (arrived && agent.status === 'waiting_approval') {
      if (parts.leftArm.current) parts.leftArm.current.rotation.x = -0.7
      if (parts.rightArm.current) parts.rightArm.current.rotation.x = -0.7+Math.sin(time*1.5)*0.04
    }
    if (parts.leftArm.current) parts.leftArm.current.rotation.z = 0
    if (parts.rightArm.current) parts.rightArm.current.rotation.z = 0
    const outside = arrived && agent.status === 'idle' && motion && ['bakso','kopi'].includes(spot.key)
    const activity = spot.key === 'pingpong-watch' ? undefined : idleActivity(agent.status, arrived, spot.key, activities)
    if (handProp.current) { handProp.current.visible = outside || activity === 'cafe' || activity === 'pingpong'; handProp.current.rotation.x = activity === 'pingpong' ? Math.sin(time*(activities.pingpong.mode ? 5 : 2.5))*0.5 : Math.sin(time)*0.2 }
    const tempo = activity ? (activities[activity].mode ? 5 : 2.5) : 0
    if (activity && parts.leftArm.current && parts.rightArm.current) {
      parts.leftArm.current.rotation.x = activity === 'gym' ? Math.sin(time*tempo)*0.65 : activity === 'game' ? -0.9+Math.sin(time*5)*0.12 : activity === 'rest' ? -0.2 : -0.5
      parts.rightArm.current.rotation.x = activity === 'pingpong' ? -0.8+Math.sin(time*tempo)*0.8 : activity === 'cafe' ? -0.9+Math.sin(time)*0.25 : activity === 'gym' ? -Math.sin(time*tempo)*0.65 : activity === 'game' ? -0.9+Math.cos(time*5)*0.12 : activity === 'lounge' ? -0.5+Math.sin(time*2)*0.2 : -0.2
      if (activity === 'gym' && spot.key === 'gym-3') { parts.leftArm.current.rotation.z = -0.9; parts.rightArm.current.rotation.z = 0.9 }
      if (activity === 'gym' && spot.key !== 'gym-3' && parts.leftLeg.current && parts.rightLeg.current) { parts.leftLeg.current.rotation.x = Math.sin(time*tempo)*0.6; parts.rightLeg.current.rotation.x = -Math.sin(time*tempo)*0.6 }
    }
    if (outside && parts.rightArm.current) parts.rightArm.current.rotation.x = -1 + Math.sin(time*1.5)*0.35
    if (parts.body.current) {
      parts.body.current.rotation.x = asleep ? 0.45 + Math.sin(time) * 0.02 : activity === 'rest' ? 0.08+Math.sin(time)*0.02 : activity === 'gym' ? 0.12 : 0
      const cabin = liftQueue.has(id) && group.position.x>7.8
      const slots=[[-0.5,-0.45],[0.5,-0.45],[-0.5,0.45],[0.5,0.45],[0,0]]
      const offset=slots[liftQueue.slot(id)]
      parts.body.current.position.x = cabin ? offset[0] : 0
      parts.body.current.position.z = cabin ? offset[1] : 0
      parts.body.current.position.y = activity === 'gym' && spot.key !== 'gym-3' ? Math.abs(Math.sin(time*tempo))*0.06 : seated ? -0.14 : 0
    }
    const blend=1-Math.exp(-14*Math.min(delta,0.1))
    limbs.forEach((ref,i)=>{const obj=ref.current;if(!obj)return;const old=poseBuffer.current,n=i*4
      obj.rotation.set(THREE.MathUtils.lerp(old[n],obj.rotation.x,blend),THREE.MathUtils.lerp(old[n+1],obj.rotation.y,blend),THREE.MathUtils.lerp(old[n+2],obj.rotation.z,blend))
      obj.position.y=THREE.MathUtils.lerp(old[n+3],obj.position.y,blend)
    })
    if (lamp.current) lamp.current.scale.setScalar(agent.status === 'waiting_approval' ? 1 + Math.sin(time * 4) * 0.2 : 1)
  })
  return <group ref={root} position={start}>
    <AvatarBody parts={parts} colors={agentLook(id)} tint={(color) => agent.status === 'paused' ? '#8b8b8b' : color} onPointerOver={() => setHovered(true)} onPointerOut={() => setHovered(false)} onClick={(event) => { event.stopPropagation(); onSelect(id) }}/>
    {agent.status === 'waiting_approval' && <group position={[0,0.97,0.35]}>
      <mesh><boxGeometry args={[0.28,0.34,0.015]}/><meshStandardMaterial color="#fff6db"/></mesh>
      {[0.08,0,-0.08].map((offset) => <mesh key={offset} position={[0,offset,0.01]}><boxGeometry args={[0.19,0.015,0.01]}/><meshBasicMaterial color="#be9847"/></mesh>)}
    </group>}
    <group ref={handProp} position={[0.4,1.1,0.35]} visible={false}>
      {roomForSpot(spot.key) === 'pingpong' ? <mesh scale={[1,0.15,1]}><sphereGeometry args={[0.15,12,8]}/><meshStandardMaterial color="#ca464c"/></mesh> : <mesh><cylinderGeometry args={[0.07,0.055,0.14,12]}/><meshStandardMaterial color="#f4ead6"/></mesh>}
    </group>
    <mesh ref={lamp} position={[0, 2, 0]} onClick={(event) => { event.stopPropagation(); onSelect(id) }}><sphereGeometry args={[0.12, 10, 8]}/><meshBasicMaterial color={STATUS_COLORS[agent.status]}/></mesh>
    {(agent.status !== 'idle' || hovered || id.startsWith('guide/')) && <AgentLabel agent={agent} label={spot.label}/>}
  </group>
}

function AgentLabel({ agent, label }: { agent: OfficeAgent; label: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512; canvas.height = 112
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#18221ee8'; ctx.fillRect(0, 0, 512, 112)
    ctx.textAlign = 'center'; ctx.font = 'bold 23px sans-serif'; ctx.fillStyle = '#ffffff'
    ctx.fillText(AGENT_NAMES[agent.agentType] ?? agent.agentType, 256, 28, 500)
    ctx.fillStyle = STATUS_COLORS[agent.status]; ctx.font = '21px sans-serif'
    const marker = { idle:'●', working:'▶', revision:'✎', waiting_quota:'Zzz', waiting_approval:'▤', error:'!', paused:'Ⅱ' }[agent.status]
    ctx.fillText(`${marker} ${AGENT_STATUS_LABELS[agent.status]}`, 256, 58)
    ctx.fillStyle = '#ffffff'; ctx.font = '18px sans-serif'
    const detail = agent.status === 'waiting_quota' && agent.retryAt ? `Coba lagi ${new Date(agent.retryAt).toLocaleTimeString('id-ID')}` : agent.currentTask ?? label
    ctx.fillText(detail.length > 45 ? `${detail.slice(0, 42)}…` : detail, 256, 91, 500)
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }, [agent.agentType, agent.status, agent.currentTask, agent.retryAt, label])
  useEffect(() => () => texture.dispose(), [texture])
  return <sprite position={[0, 2.55, 0]} scale={[2.5, 0.55, 1]}><spriteMaterial map={texture} transparent depthWrite={false}/></sprite>
}

export default function Office3D({ brands, floor, night, quality = 'auto', cameraReset = 0, guide = false, motion = true, onLift, overview = false, activities = defaultRoomControls(), onRoomInteract, onFloorSelect, onSelect }: { brands: OfficeBrand[]; floor: number; night: boolean; quality?: OfficeQuality; cameraReset?: number; guide?: boolean; motion?: boolean; onLift?: () => void; overview?: boolean; activities?: RoomControls; onRoomInteract?: (room: ActivityRoom) => void; onFloorSelect?: (floor: number) => void; onSelect: (id: string) => void }) {
  const { library, error } = useFurniture()
  const [visible,setVisible]=useState(()=>!document.hidden)
  const [slow,setSlow]=useState(false)
  const [stats,setStats]=useState('')
  const [monitor,setMonitor]=useState(false)
  const constrained=Boolean(window.matchMedia?.('(pointer: coarse)').matches) || (navigator.hardwareConcurrency>0 && navigator.hardwareConcurrency<=4)
  const rendering=renderQuality(quality,constrained,slow)
  useEffect(()=>{const changed=()=>setVisible(!document.hidden);document.addEventListener('visibilitychange',changed);return()=>document.removeEventListener('visibilitychange',changed)},[])
  const layout = useMemo(() => liveBuilding(brands), [brands])
  const visits = useRef(new Map<string, Visit>())
  const traffic = useRef(new Map<string, THREE.Vector3>())
  const liftQueue = useRef(new LiftQueue())
  const elapsed = useRef(0)
  const [, redraw] = useState(0)
  const [notice,setNotice] = useState('')
  const visitVendor = (key: 'bakso' | 'kopi') => {
    if (!motion) { setNotice('Aktifkan aktivitas terlebih dahulu.'); return }
    const spot = layout.idleSpots.find(s => s.key===key)!
    if ([...visits.current.values()].some(v => v.spot.key===key || v.from?.key===key)) { setNotice('Tempat sedang dipakai; agent lain akan berkunjung bergantian.'); return }
    const candidate = brands.flatMap(b => b.agents.filter(a => a.active && a.status==='idle').map(a => ({id:b.id+'/'+a.agentType,agent:a}))).find(a => {const v=visits.current.get(a.id);return v && !v.from})
    if (!candidate) { setNotice('Belum ada agent idle yang siap berangkat.'); return }
    const previous = visits.current.get(candidate.id)!
    visits.current.set(candidate.id,{spot,from:previous.spot,visits:previous.visits+1})
    setNotice((AGENT_NAMES[candidate.agent.agentType] ?? candidate.agent.agentType)+' menuju '+(key==='bakso' ? 'gerobak bakso.' : 'kopi sepeda.'))
    redraw(n=>n+1)
  }
  useEffect(() => {
    const tick = () => {
      if (document.hidden) return
      if (motion) elapsed.current++
      visits.current = nextVisits(layout,brands,visits.current,elapsed.current,motion)
      redraw(n => n+1)
    }
    tick()
    const timer = setInterval(tick,1000)
    return () => clearInterval(timer)
  }, [layout, brands, motion])
  const arrived = (id: string, key: string) => {
    const visit = visits.current.get(id)
    if (visit?.spot.key === key && visit.arrivedAt === undefined) visits.current.set(id,{ ...visit,from: undefined,arrivedAt: elapsed.current })
  }
  if (error) throw new Error(error)
  if (!library) return <p aria-busy="true">Memuat furnitur kantor…</p>
  const occupied = new Set<ActivityRoom>()
  for (const visit of visits.current.values()) {
    const room = !visit.from && roomForSpot(visit.spot.key)
    if (room) occupied.add(room)
  }
  const players=['game-1','game-2'].every(key => [...visits.current.entries()].some(([id,v]) => v.spot.key===key && !v.from && brands.some(b => b.agents.some(a => b.id+'/'+a.agentType===id && a.status==='idle'))))
  if(!players) occupied.delete('pingpong')
  const sceneActivities={...activities,pingpong:{...activities.pingpong,enabled:activities.pingpong.enabled && players}}
  let agentIndex = 0
  return <div className="blueprint-scene" tabIndex={0} role="region" aria-label="Kantor 3D. Pan dengan tombol panah; Page Up atau Page Down untuk berpindah lantai." onKeyDown={event=>{
    if(event.target!==event.currentTarget || guide)return
    if(event.key==='PageUp' || event.key==='PageDown'){event.preventDefault();onFloorSelect?.(Math.max(0,Math.min(layout.floors.length-1,floor+(event.key==='PageUp'?1:-1))))}
  }}><Canvas frameloop={visible ? 'always' : 'never'} shadows={rendering.shadows} dpr={rendering.dpr} camera={{ fov: 42, near: 0.5, far: 200 }}>
    <FrameMonitor enabled={visible} onSlow={()=>setSlow(true)} onStats={monitor ? setStats : undefined}/>
    <color attach="background" args={[night ? '#121b29' : '#c9e2ec']}/>
    <hemisphereLight args={['#ffffff', '#445044', night ? 0.5 : 1.1]}/>
    <directionalLight position={[8, 30, 12]} intensity={night ? 0.7 : 1.7} castShadow={rendering.shadows} shadow-mapSize={[1024, 1024]} shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14}/>
    <group visible={!guide}><BuildingScene onVendor={visitVendor} onAgentSelect={onSelect} onRoomInteract={onRoomInteract} brands={brands} night={night} layout={layout} library={library} floor={floor} overview={overview} onFloorSelect={onFloorSelect}/>
    {!overview && <Lift floor={floor} traffic={traffic.current} onClick={onLift}/> }
    {!overview && floor === 0 && <RoomEffects controls={activities} occupied={occupied} zones={layout.floors[0].zones} onInteract={onRoomInteract}/>}
    {brands.flatMap((brand) => brand.agents.filter((agent) => agent.active).map((agent) => {
      const spot = visits.current.get(`${brand.id}/${agent.agentType}`)?.spot ?? agentSpot(layout, brand.id, agent.agentType, agent.status, agentIndex)
      agentIndex++
      return spot ? <Agent key={`${brand.id}/${agent.agentType}`} id={`${brand.id}/${agent.agentType}`} agent={agent} spot={spot} layout={layout} floor={overview ? -1 : floor} activities={sceneActivities} motion={motion} traffic={traffic.current} liftQueue={liftQueue.current} onArrive={arrived} onSelect={onSelect}/> : null
    }))}
    </group>{guide && <StatusGuide/>}
    <Camera floor={guide ? 0 : floor} overview={guide ? false : overview} reset={cameraReset}/>
  </Canvas><div className="office-performance"><button aria-pressed={monitor} onClick={()=>setMonitor(!monitor)}>Performa · {rendering.low ? 'Hemat' : 'Detail'}</button>{monitor && <span role="status">{stats || 'Mengukur…'} · pengukuran browser</span>}</div>{!overview && floor===0 && <div className="office-scene-actions"><button onClick={() => visitVendor('bakso')}>Beli bakso</button><button onClick={() => visitVendor('kopi')}>Ngopi di luar</button><span role="status">{notice || 'Seret untuk memutar · scroll untuk zoom · klik agent untuk chat'}</span></div>}</div>
}

const GUIDE_STATUSES: AgentStatus[]=['idle','working','waiting_quota','waiting_approval','revision','error','paused']
function StatusGuide() {
 const layout=useMemo(()=>liveBuilding([]),[])
 const traffic=useRef(new Map<string,THREE.Vector3>())
 const lift=useRef(new LiftQueue())
 return <group><mesh rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={[24,12]}/><meshStandardMaterial color="#c8d6cc"/></mesh>{GUIDE_STATUSES.map((status,i)=>{
 const x=(i-3)*2.8
 const seated=!['idle','error'].includes(status)
 const spot:Spot={key:'guide-'+status,floor:0,position:[x,0,0],facing:0,seated,label:'Contoh gerakan',exit:[]}
 const agent:OfficeAgent={brandId:'guide',agentType:'manager',active:true,paused:status==='paused',status,currentTask:'Contoh visual · '+AGENT_STATUS_LABELS[status]}
 return <group key={status}>{seated && <OfficeChair position={[x,0,0]}/>}{['working','revision','waiting_quota'].includes(status) && <WorkDesk position={[x,0,1.05]} withChair={false} active={status!=='waiting_quota'}/> }<Agent id={'guide/'+status} agent={agent} spot={spot} layout={layout} floor={0} activities={defaultRoomControls()} motion={true} traffic={traffic.current} liftQueue={lift.current} onArrive={()=>{}} onSelect={()=>{}}/></group>
 })}</group>
}

function FrameMonitor({enabled,onSlow,onStats}:{enabled:boolean;onSlow:()=>void;onStats?: (text:string)=>void}) {
 const frames=useRef(0), elapsed=useRef(0),warmup=useRef(0)
 useEffect(()=>{frames.current=0;elapsed.current=0;warmup.current=0},[enabled])
 useFrame(({gl},delta)=>{
  if(!enabled || delta>0.25)return
  warmup.current+=delta;if(warmup.current<3)return
  frames.current++;elapsed.current+=delta
  if(elapsed.current>=2){const fps=frames.current/elapsed.current
   if(fps<23)onSlow()
   onStats?.(Math.round(fps)+' FPS · '+gl.info.render.calls+' draw calls · '+gl.info.render.triangles.toLocaleString('id-ID')+' segitiga')
   frames.current=0;elapsed.current=0
  }
 })
 return null
}
