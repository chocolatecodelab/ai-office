import { expect, it } from 'vitest'
import { liveBuilding } from './live.ts'
import { nextVisits, type Visit } from './roaming.ts'
import type { OfficeBrand } from '../office-api.ts'

const brands: OfficeBrand[] = ['otca','infojerman','ciaomanda','jepangkoey'].map(id => ({ id,name:id,color:'#fff',paused:false,agents:['manager','content-creator','video-editor','social-media-manager',...(id==='otca' ? ['event-specialist','digital-marketing'] : [])].map(agentType => ({brandId:id,agentType,active:true,paused:false,status:'idle',currentTask:null})) }))
const layout=liveBuilding(brands)
it('reserves seats during travel and visits outside vendors and brand floors over time', () => {
  let visits=new Map<string,Visit>()
  const seen=new Set<string>()
  for(let now=0;now<600;now++) {
    visits=nextVisits(layout,brands,visits,now,true)
    const reservations=[...visits.values()].flatMap(v => [v.spot.key,...(v.from ? [v.from.key] : [])])
    expect(new Set(reservations).size).toBe(reservations.length)
    for(const [id,v] of visits) {
      seen.add(v.spot.key)
      if(v.from && now%10===0) visits.set(id,{...v,from:undefined,arrivedAt:now})
    }
  }
  expect(seen.has('bakso')).toBe(true)
  expect(seen.has('kopi')).toBe(true)
  for(const brand of brands) expect([...seen].some(key => key.startsWith(brand.id+':'))).toBe(true)
})
it('pauses roaming and returns a busy agent to its own desk after the current journey', () => {
  const first=nextVisits(layout,brands,new Map(),0,true)
  expect(nextVisits(layout,brands,first,100,false)).toEqual(first)
  const busy=brands.map(b => ({...b,agents:b.agents.map(a => ({...a,status:'working' as const}))}))
  const next=nextVisits(layout,busy,first,101,true)
  for(const [id,v] of next) { expect(v.spot.key).toBe(id.replace('/',':')); expect(v.from).toBeDefined() }
})
