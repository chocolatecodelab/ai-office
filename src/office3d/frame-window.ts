/** Keep foreground stalls: dropping long frames would inflate the reported FPS. */
export class FrameWindow {
  private durations:number[]=[]
  private seconds=0
  add(delta:number) {
    if(!Number.isFinite(delta)||delta<=0)return
    this.durations.push(delta);this.seconds+=delta
    if(this.seconds<2)return
    const sorted=[...this.durations].sort((a,b)=>a-b)
    const sample={seconds:this.seconds,frames:sorted.length,fps:sorted.length/this.seconds,p95FrameMs:sorted[Math.ceil(sorted.length*.95)-1]*1000,maxFrameMs:sorted[sorted.length-1]*1000,stalls:sorted.filter(t=>t>.25).length}
    this.durations=[];this.seconds=0
    return sample
  }
}
export type FrameSample = NonNullable<ReturnType<FrameWindow['add']>>
