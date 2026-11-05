interface Position {x:number;y:number;z:number}
export interface WalkingAgent {id:string;position:Position;target?:Position;insideLift:boolean}
export const FOLLOW_GAP = 0.6

/** Slow a following walker on the same heading. Crossings and opposing traffic keep moving.
 * This only shortens a step on its existing route; it never pushes avatars through walls/furniture. */
export function followingStep(id:string,position:Position,target:Position,requested:number,traffic:Iterable<WalkingAgent>) {
  const dx=target.x-position.x,dz=target.z-position.z,length=Math.hypot(dx,dz)
  if(length<0.001 || Math.abs(target.y-position.y)>0.01)return requested
  const ux=dx/length,uz=dz/length
  let allowed=requested
  for(const other of traffic){
    if(other.id===id||other.insideLift||!other.target||Math.abs(other.position.y-position.y)>0.1)continue
    const vx=other.target.x-other.position.x,vz=other.target.z-other.position.z,vl=Math.hypot(vx,vz)
    if(vl<0.001||Math.abs(other.target.y-other.position.y)>0.01||(vx*ux+vz*uz)/vl<0.8)continue
    const rx=other.position.x-position.x,rz=other.position.z-position.z
    const ahead=rx*ux+rz*uz,side=Math.abs(rx*uz-rz*ux)
    if(ahead<-0.001||side>=FOLLOW_GAP)continue
    // When two walkers merge at exactly the same point, let one leave before the other follows.
    if(Math.abs(ahead)<0.001 && id<other.id)continue
    allowed=Math.min(allowed,Math.max(0,ahead-Math.sqrt(FOLLOW_GAP*FOLLOW_GAP-side*side)))
  }
  return allowed
}
