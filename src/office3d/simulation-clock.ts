/** Independent of the renderer clock, which resets when its frameloop is resumed. */
export class SimulationClock {
  current=0
  advance(delta:number) {
    if(Number.isFinite(delta) && delta>0)this.current+=Math.min(delta,.1)
    return this.current
  }
}
