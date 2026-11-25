/*
 * Site frame, metres. x = east, z = south.  Origin = UTM 45N (assumed) E 344800, N 2394200.
 * Quarry and dump footprints: IBM inspection report, June 2024 (sourced).
 * Gates, roads, towers, loading zone and drone paths: illustrative.
 */
import { v, Vec, smooth, dist, inPoly, segDist } from './util';

export interface Quarry { name: string; x0: number; x1: number; z0: number; z1: number; top: number; floor: number }
const box = (e0: number, e1: number, n0: number, n1: number) => ({ x0: e0 - 344800, x1: e1 - 344800, z0: -(n1 - 2394200), z1: -(n0 - 2394200) });
export const QUARRIES: Quarry[] = [
  { name: 'Hilltop Quarry', ...box(344655, 345647, 2392915, 2393533), top: 1040, floor: 940 },
  { name: 'Putulupani Quarry', ...box(344483, 344922, 2394883, 2395850), top: 1000, floor: 910 },
];
export const DUMPS = [
  { name: 'Waste dump', ...box(344940, 346210, 2395730, 2396780), h: 40 },
  { name: 'Reject dump K1', ...box(345752, 345871, 2395747, 2395821), h: 12 },
  { name: 'Reject dump K2', ...box(345564, 345688, 2396022, 2396145), h: 12 },
  { name: 'Reject dump J1', ...box(343980, 344185, 2394840, 2394980), h: 14 },
  { name: 'Reject dump J2', ...box(344040, 344154, 2394415, 2394570), h: 12 },
];

export type NodeKind = 'entry' | 'exit' | 'route' | 'zone' | 'check' | 'hidden' | 'load' | 'dest' | 'via';
export interface SiteNode { id: string; kind: NodeKind; pos: Vec; label: string }
const N = (id: string, kind: NodeKind, x: number, z: number, label = id): [string, SiteNode] => [id, { id, kind, pos: v(x, z), label }];
export const NODES: Record<string, SiteNode> = Object.fromEntries([
  N('W1', 'via', -1600, -1020), N('G1', 'entry', -1300, -900, 'Gate G1'), N('C1', 'check', -950, -760, 'Checkpoint C1'),
  N('C2', 'check', -640, -520, 'Checkpoint C2'), N('HW1', 'hidden', -370, -430, 'Hidden weighing HW1'),
  N('R1', 'route', -60, -360, 'Route gate R1'), N('Z1', 'zone', 370, -230, 'Zone gate Z1'),
  N('W2', 'via', -1620, 740), N('G2', 'entry', -1300, 610, 'Gate G2'), N('HW2', 'hidden', -1050, 520, 'Hidden weighing HW2'),
  N('C3', 'check', -780, 420, 'Checkpoint C3'), N('C4', 'check', -440, 345, 'Checkpoint C4'), N('HW3', 'hidden', -140, 340, 'Hidden weighing HW3'),
  N('R2', 'route', 170, 325, 'Route gate R2'), N('Z2', 'zone', 620, 195, 'Zone gate Z2'),
  N('W3', 'via', 1360, 1810), N('G3', 'entry', 1180, 1520, 'Gate G3'), N('R3', 'route', 1090, 1120, 'Route gate R3'),
  N('HW4', 'hidden', 1055, 830, 'Hidden weighing HW4'), N('C5', 'check', 960, 520, 'Checkpoint C5'),
  N('S1', 'load', 635, -80, 'Loading point S1'), N('Z3', 'zone', 940, -60, 'Zone gate Z3'), N('HW5', 'hidden', 1130, 10, 'Hidden weighing HW5'),
  N('C6', 'check', 1340, 85, 'Checkpoint C6'), N('G4', 'exit', 1650, 190, 'Exit gate G4'), N('DEST', 'dest', 2330, 430, 'Destination weighbridge'),
]);

/** Road segments (control points between nodes). */
const SEG: Record<string, Vec[]> = {
  'W1>G1': [], 'G1>C1': [v(-1130, -850)], 'C1>C2': [v(-790, -660)], 'C2>HW1': [v(-500, -455)], 'HW1>R1': [v(-220, -405)], 'R1>Z1': [v(150, -300)],
  'Z1>S1': [v(470, -190), v(575, -100)],
  'W2>G2': [], 'G2>HW2': [], 'HW2>C3': [v(-900, 470)], 'C3>C4': [v(-610, 375)], 'C4>HW3': [], 'HW3>R2': [], 'R2>Z2': [v(420, 285)],
  'Z2>S1': [v(640, 105), v(665, -20)],
  'W3>G3': [], 'G3>R3': [v(1110, 1330)], 'R3>HW4': [], 'HW4>C5': [v(1020, 660)], 'C5>Z2': [v(820, 340)],
  'S1>Z3': [v(720, -110), v(850, -85)], 'Z3>HW5': [], 'HW5>C6': [], 'C6>G4': [v(1500, 135)], 'G4>DEST': [v(1900, 270), v(2130, 380)],
};
export const ROADS: Vec[][] = Object.entries(SEG).map(([k, mid]) => {
  const [a, b] = k.split('>'); return smooth([NODES[a].pos, ...mid, NODES[b].pos]);
});
/** Informal tracks used by vehicles that avoid the gates. */
export const TRACKS: Vec[][] = [
  smooth([v(-1640, -150), v(-1360, -145), v(-1000, -90), v(-700, -40), v(-420, 40), v(-250, 110)]),
  smooth([v(1700, 940), v(1480, 880), v(1260, 640), v(1060, 400), v(900, 285), v(820, 240)]),
];

/** Path from one node to the next, with the road's shape. */
export function leg(a: string, b: string): Vec[] {
  const f = SEG[`${a}>${b}`];
  if (f) return smooth([NODES[a].pos, ...f, NODES[b].pos]);
  const r = SEG[`${b}>${a}`];
  if (r) return smooth([NODES[a].pos, ...r.slice().reverse(), NODES[b].pos]);
  return [NODES[a].pos, NODES[b].pos];
}
export const ENTRY_ROUTES: Record<string, string[]> = {
  G1: ['W1', 'G1', 'C1', 'C2', 'HW1', 'R1', 'Z1', 'S1'],
  G2: ['W2', 'G2', 'HW2', 'C3', 'C4', 'HW3', 'R2', 'Z2', 'S1'],
  G3: ['W3', 'G3', 'R3', 'HW4', 'C5', 'Z2', 'S1'],
};
export const EXIT_ROUTE = ['S1', 'Z3', 'HW5', 'C6', 'G4', 'DEST'];

export const LEASE: Vec[] = [v(-1300, -900), v(-800, -1850), v(500, -2750), v(1600, -2550), v(1565, -1200), v(1650, 190), v(1500, 900), v(1180, 1520), v(300, 1800), v(-700, 1560), v(-1300, 610), v(-1385, -150)];
export const PICKUP_ZONE: Vec[] = [v(370, -305), v(860, -325), v(940, -215), v(940, 95), v(830, 185), v(620, 195), v(420, 165), v(370, -55)];
export const ZONE_GATE_IDS = ['Z1', 'Z2', 'Z3'];

export interface PileSpec { id: string; pos: Vec; radius: number; tonnes: number }
export const PILES: PileSpec[] = [
  { id: 'S1', pos: v(625, -171), radius: 52, tonnes: 6200 },
  { id: 'S2', pos: v(799, 11), radius: 50, tonnes: 5000 },
  { id: 'S3', pos: v(705, -240), radius: 40, tonnes: 3400 },
];
export const TOWERS = [
  { id: 'TW1', pos: v(325, -385), range: 480 },
  { id: 'TW2', pos: v(1000, -335), range: 480 },
  { id: 'TW3', pos: v(930, 285), range: 360 },
];
export const DOCK = v(1200, -370);
export const CONTROL_ROOM = v(1415, -430);
export const PLANT = v(455, 95);

export type ZoneId = 'A' | 'B' | 'C' | 'D';
export const ZONE_IDS: ZoneId[] = ['A', 'B', 'C', 'D'];
export const zoneOf = (p: Vec): ZoneId => (p.x < -300 ? 'A' : p.z < -300 ? 'B' : p.z < 420 ? 'C' : 'D');
/** Closed coverage loops: every place a truck can drive. */
export const SWEEPS: Record<ZoneId, Vec[]> = {
  A: [v(-1300, -900), v(-950, -760), v(-640, -520), v(-330, -420), v(-330, -80), v(-780, -70), v(-1000, -90), v(-1370, -145), v(-1330, 250), v(-1300, 610), v(-1050, 520), v(-780, 420), v(-440, 345), v(-330, 330), v(-620, 120), v(-1100, -420), v(-1300, -900)],
  B: [v(-300, -415), v(-60, -360), v(150, -305), v(365, -325), v(330, -520), v(40, -600), v(-280, -560), v(-300, -415)],
  C: [v(-290, 330), v(170, 325), v(420, 280), v(620, 195), v(870, 235), v(1100, 120), v(1340, 85), v(1630, 185), v(1340, 40), v(1130, -40), v(940, -60), v(860, -270), v(600, -285), v(390, -210), v(420, 40), v(640, 20), v(660, -90), v(420, 130), v(100, 130), v(-260, 105), v(-290, 330)],
  D: [v(1180, 1500), v(1090, 1120), v(1055, 830), v(1005, 640), v(960, 520), v(1090, 455), v(870, 470), v(500, 560), v(100, 580), v(-270, 590), v(100, 640), v(560, 650), v(930, 760), v(1120, 960), v(1230, 1300), v(1180, 1500)],
};
/** Positions where registered trucks wait during the shift: [x, z]. */
export const BAYS: Vec[] = [
  v(425, -35), v(430, 5), v(445, 40), v(505, -250), v(548, -262),
  v(-150, -395), v(-205, -408), v(-262, -423),
  v(1010, 705), v(1035, 760), v(985, 640),
  v(-775, -45), v(-835, -55), v(-905, -68),
];
export const nearestNodeLabel = (p: Vec) => Object.values(NODES).filter((n) => n.kind !== 'via' && n.kind !== 'hidden').sort((a, b) => dist(a.pos, p) - dist(b.pos, p))[0].label;
/** Towers report unanswered vehicles only in and around the pickup area they overlook. */
export const inPickupArea = (p: Vec) => inPoly(p, PICKUP_ZONE) || PICKUP_ZONE.some((a, i) => segDist(p, a, PICKUP_ZONE[(i + 1) % PICKUP_ZONE.length]) < 130);
