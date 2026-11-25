import type { Vec, ZoneId } from './index';
export type Role = 'AI' | 'AI+person' | 'Person' | 'Sensor' | 'Not acted';
export type Severity = 'high' | 'med' | 'low';
export type Weather = 'clear' | 'dust' | 'monsoon';
export type Command = 'OPEN' | 'HOLD' | 'TURN_AWAY';
export interface Why { rule: string; inputs: [string, string][] }

/* ---- readings: the only things the decision rules ever receive ---- */
export interface DeviceReply { device: string; mac: string }
export interface GateReading { node: string; t: number; nonce: string; plate: string; shape: number; gross: number; reply: DeviceReply | null }
export interface CheckReading { node: string; t: number; device: string; claimed: Vec; reader: Vec }
export interface HiddenReading { node: string; t: number; device: string | null; gross: number }
export interface LoadReading { t: number; device: string; pile: string; net: number }
export interface PaperReading { t: number; device: string; note: string; net: number; wb: string; op: string }
export interface DestReading { t: number; device: string; gross: number }
export interface Heartbeat { t: number; device: string; claimed: Vec; battery: boolean }
export interface Sighting { t: number; track: string; pos: Vec; zone: ZoneId; device: string | null; shape: number; plate: string | null; moving: boolean }
export interface ScanReading { t: number; pile: string; tonnes: number }

/* ---- records kept by the Governing Body ---- */
export interface Evidence { i: number; t: number; src: string; node: string; subject: string; kind: string; value: string; status: '' | 'ok' | 'warn' | 'bad' }
export interface Alert { id: number; t: number; sev: Severity; title: string; detail: string; subject: string; pos: Vec | null; why: Why; penalised: boolean }
export type ProposalKind = 'follow' | 'radar' | 'backup' | 'reopen';
export interface Proposal {
  id: number; t: number; expires: number; kind: ProposalKind; origin: 'AI' | 'Person'; text: string; subject: string;
  pos: Vec | null; approvals: string[]; state: 'pending' | 'approved' | 'ignored' | 'expired'; why: Why;
}
export interface Registration { device: string; key: string; plate: string; shape: number; tare: number; driver: string; label: string }
export interface Trip {
  device: string; plate: string; gate: string; tEntry: number; entryGross: number; inside: boolean; atStart: boolean;
  expected: { node: string; t: number; done: boolean; alerted: boolean }[];
  pile?: string; sensorNet?: number; zoneNet?: number; paperNet?: number; note?: string; wb?: string; op?: string;
  tExit?: number; exitGross?: number; exitNet?: number; destNet?: number; tDest?: number;
  lastSeen: number; claimed: Vec; silentAlerted: boolean; battery: boolean; destAlerted: boolean; outsideAlerted: boolean; flag: '' | 'ok' | 'warn' | 'bad'; status: string;
}
