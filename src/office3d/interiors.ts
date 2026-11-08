/** Architectural finishes complement the official brand accent supplied by visual.json. */
export const INTERIORS: Record<string, { wall: string; floor: string; wood: string; metal: string; soft: string; room: string; motif: 'slats' | 'grid' | 'gallery' | 'shoji' }> = {
  otca: { wall: '#222724', floor: '#d8d0c1', wood: '#553d2b', metal: '#c4a05b', soft: '#263b32', room: 'Executive boardroom', motif: 'slats' },
  infojerman: { wall: '#f3eee2', floor: '#dfdccd', wood: '#ba9469', metal: '#575e58', soft: '#76846c', room: 'Forum Berlin', motif: 'grid' },
  ciaomanda: { wall: '#f3e8e0', floor: '#e3d5ca', wood: '#985f48', metal: '#b77952', soft: '#b96555', room: 'Sala Creativa', motif: 'gallery' },
  jepangkoey: { wall: '#292b2d', floor: '#b9b8ad', wood: '#99846a', metal: '#303436', soft: '#676f65', room: 'Kaizen room', motif: 'shoji' },
}
