export const ROOM_ACTIVITIES = [
  { id: 'pingpong', name: 'Ping-pong', modes: ['Latihan santai', 'Rally cepat'], action: 'Ganti tempo' },
  { id: 'cafe', name: 'Office Cafe', modes: ['Espresso', 'Cappuccino'], action: 'Ganti menu' },
  { id: 'gym', name: 'Gym & Fitness', modes: ['Pemanasan', 'Cardio'], action: 'Ganti latihan' },
  { id: 'game', name: 'Game Room', modes: ['Arcade klasik', 'Turnamen neon'], action: 'Ganti permainan' },
  { id: 'rest', name: 'Ruang istirahat', modes: ['Istirahat tenang', 'Latihan napas'], action: 'Ganti suasana' },
  { id: 'lounge', name: 'Lounge', modes: ['Diskusi santai', 'Movie lounge'], action: 'Ganti aktivitas' },
] as const
export type ActivityRoom = typeof ROOM_ACTIVITIES[number]['id']
export type RoomControls = Record<ActivityRoom, { enabled: boolean; mode: number }>
export const defaultRoomControls = (): RoomControls => Object.fromEntries(ROOM_ACTIVITIES.map((room) => [room.id,{ enabled: true, mode: 0 }])) as RoomControls
export function roomForSpot(key: string): ActivityRoom | undefined {
  if (['game-1','game-2','pingpong-watch'].includes(key)) return 'pingpong'
  if (key.startsWith('pantry') || key.startsWith('cafe-seat')) return 'cafe'
  if (key.startsWith('gym')) return 'gym'
  if (key.startsWith('lounge')) return 'lounge'
  if (key.startsWith('rest')) return 'rest'
  if (['game-3','arcade-2','game-seat'].includes(key)) return 'game'
}
/** Activity gestures never override actual work, quota sleep, or travel. */
export function idleActivity(status: string, arrived: boolean, key: string, controls: RoomControls): ActivityRoom | undefined {
  const room = roomForSpot(key)
  return status === 'idle' && arrived && room && controls[room].enabled ? room : undefined
}
