import { floorAt, LIFT, LIFT_LANE_X, type Vec3 } from './building.ts'

export const QUEUE_PITCH = 0.65
const EXIT_INTERVAL = 1.3
/** FIFO trips group up to five passengers with the same departure and destination. */
export class LiftQueue {
 private waiting: string[]=[]
 private waitingFloors=new Map<string,number>()
 private riders=new Map<string,number>()
 private trip?: {from:number;to:number;departAt:number;exiting:Set<string>;nextExitAt:number}
 has(id:string) {return this.riders.has(id)}
 slot(id:string) {return this.riders.get(id) ?? 0}
 request(id:string,from=0,to=1,now=0):boolean {
  if(this.has(id)) return true
  if(!this.waiting.includes(id)) this.waiting.push(id)
  this.waitingFloors.set(id,from)
  if(!this.trip && this.waiting[0]===id) this.trip={from,to,departAt:now+4,exiting:new Set(),nextExitAt:0}
  if(this.trip && this.trip.from===from && this.trip.to===to && now<this.trip.departAt && this.riders.size<5 && this.waiting[0]===id) {
   const used=new Set(this.riders.values());let slot=0;while(used.has(slot))slot++
   this.riders.set(id,slot);this.waiting.shift();this.waitingFloors.delete(id);return true
  }
  return false
 }
 canDepart(id:string,now:number) {return this.has(id) && !!this.trip && now>=this.trip.departAt}
 /** Passengers ride together, then leave the doorway one at a time instead of merging into one walker. */
 canExit(id:string,now:number) {
  if(!this.has(id)||!this.trip||!this.canDepart(id,now))return false
  if(this.trip.exiting.has(id))return true
  const first=[...this.riders].filter(([key])=>!this.trip!.exiting.has(key)).sort((a,b)=>a[1]-b[1])[0]?.[0]
  if(id!==first || now<this.trip.nextExitAt)return false
  this.trip.exiting.add(id);this.trip.nextExitAt=now+EXIT_INTERVAL
  return true
 }
 rank(id:string) {return Math.max(0,this.waiting.indexOf(id))}
 waitingPosition(id:string,height:number):Vec3 {
  const floor=floorAt(height)
  const rank=this.waiting.filter(key=>this.waitingFloors.get(key)===floor).indexOf(id)
  const index=Math.max(0,rank)
  // Keep overflow in the open lift lobby, rather than extending a line through the front wall.
  return index<3 ? [LIFT_LANE_X,height,LIFT.z+QUEUE_PITCH*(index+1)] : [LIFT_LANE_X+(index-3)%4*0.75,height,-0.8+Math.floor((index-3)/4)*0.75]
 }
 waitingTarget(id:string,position:Vec3):Vec3 {
  const target=this.waitingPosition(id,position[1])
  if(target[0]>LIFT_LANE_X && position[2]<-0.81)return [LIFT_LANE_X,position[1],-0.8]
  if(target[0]===LIFT_LANE_X && position[0]>LIFT_LANE_X+0.03)return [LIFT_LANE_X,position[1],position[2]]
  return target
 }
 release(id:string) {this.riders.delete(id);this.waiting=this.waiting.filter(x=>x!==id);this.waitingFloors.delete(id);if(!this.riders.size)this.trip=undefined}
}
