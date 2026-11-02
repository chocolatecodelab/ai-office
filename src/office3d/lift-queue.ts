/** FIFO trips group up to five passengers with the same departure and destination. */
export class LiftQueue {
 private waiting: string[]=[]
 private riders=new Map<string,number>()
 private trip?: {from:number;to:number;departAt:number}
 has(id:string) {return this.riders.has(id)}
 slot(id:string) {return this.riders.get(id) ?? 0}
 request(id:string,from=0,to=1,now=0):boolean {
  if(this.has(id)) return true
  if(!this.waiting.includes(id)) this.waiting.push(id)
  if(!this.trip && this.waiting[0]===id) this.trip={from,to,departAt:now+4}
  if(this.trip && this.trip.from===from && this.trip.to===to && now<this.trip.departAt && this.riders.size<5 && this.waiting[0]===id) {
   const used=new Set(this.riders.values());let slot=0;while(used.has(slot))slot++
   this.riders.set(id,slot);this.waiting.shift();return true
  }
  return false
 }
 canDepart(id:string,now:number) {return this.has(id) && !!this.trip && now>=this.trip.departAt}
 rank(id:string) {return Math.max(0,this.waiting.indexOf(id))}
 release(id:string) {this.riders.delete(id);this.waiting=this.waiting.filter(x=>x!==id);if(!this.riders.size)this.trip=undefined}
}
