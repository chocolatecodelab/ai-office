/** Shared world-space anchors for the layout, actors, equipment and their animated effects. */
export const PINGPONG = { x: -7.5, z: -3.4, length: 2.74, width: 1.52, playerOffset: 1.9 }
export const TREADMILLS = { xs: [1.7,3.1], z: -3.5, deckHeight: 0.28, length: 1.65, width: 0.85 }
export const LOUNGE = { sofa: [-8,0,4.7] as [number,number,number], armchair: [-5.7,0,4.65] as [number,number,number], seats: [-8.5,-7.5,-5.7], seatZ: 4.65 }
export const CAFE = { tables: [-3.4,-1.5], z: -2.65, seatZ: [-3.4,-1.9] }
export function equipmentPose(key: string): { x: number; y: number; z: number; facing: number } | undefined {
  if (key === 'game-1' || key === 'game-2') {
    const left = key === 'game-1'
    return { x: PINGPONG.x+(left ? -1 : 1)*PINGPONG.playerOffset, y: 0, z: PINGPONG.z, facing: left ? Math.PI/2 : -Math.PI/2 }
  }
  if (key === 'cafe-seat' || key.startsWith('cafe-seat-')) {
    const index = key === 'cafe-seat' ? 0 : Number(key.slice(-1))-1
    return {x:CAFE.tables[Math.floor(index/2)],y:0,z:CAFE.seatZ[index%2],facing:index%2 ? Math.PI : 0}
  }
  if (key === 'gym-1' || key === 'gym-2') return { x: TREADMILLS.xs[key === 'gym-1' ? 0 : 1], y: TREADMILLS.deckHeight, z: TREADMILLS.z, facing: Math.PI }
  if (key === 'gym-3') return { x: 4.4, y: 0.05, z: -3.8, facing: Math.PI }
  if (key.startsWith('lounge-')) {
    const index = Number(key.slice(-1))-1
    if (LOUNGE.seats[index] !== undefined) return { x: LOUNGE.seats[index], y: 0, z: LOUNGE.seatZ, facing: Math.PI }
  }
}
