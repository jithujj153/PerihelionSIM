/*
 * Makes the truck device visible: the exchange with each gate (challenge, signed reply, decision),
 * a pulse every time a device sends data, and the data link from the truck in focus to the control room.
 * Visual only. It shows what the engine already does.
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { CONTROL_ROOM, NODES } from '../engine/layout';
import { GATE_DWELL } from '../engine/governor';
import type { Sim, Vehicle } from '../engine/sim';
import { f1 } from '../engine/util';
import { height } from './terrain';
import type * as M from './models';

const BLUE = 0x39b6ff, GREEN = 0x3dff8f, RED = 0xff3b30, AMBER = 0xffb020;
const DOTS = 5, HOLD_SECONDS = 3;

interface Exchange { dots: THREE.Mesh[]; line: THREE.Line; label: CSS2DObject; html: string; until: number; node: string }
interface Pulse { ring: THREE.Mesh; age: number }

export class Signals {
  private root = new THREE.Group();
  private exchanges = new Map<string, Exchange>();
  private pulses = new Map<string, Pulse>();
  private glow = new Map<string, THREE.Mesh>();
  private link: THREE.Line;
  private packet: THREE.Mesh;
  private packetAge = 9;
  private beat = -1;
  private time = 0;
  focus = '';

  constructor(group: THREE.Group, private tag: (cls: string, html?: string) => CSS2DObject) {
    group.add(this.root);
    this.link = this.line(41, BLUE, true); this.packet = this.ball(2.6, 0xffffff); this.root.add(this.link, this.packet);
  }

  private ball(r: number, color: number) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false })); m.renderOrder = 12; return m;
  }
  private line(n: number, color: number, dashed = false) {
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 14, gapSize: 9, transparent: true, opacity: 0.8, depthTest: false }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75, depthTest: false });
    const l = new THREE.Line(g, mat); l.frustumCulled = false; l.renderOrder = 11; return l;
  }
  private arc(a: THREE.Vector3, b: THREE.Vector3, u: number, lift: number) { const p = a.clone().lerp(b, u); p.y += Math.sin(u * Math.PI) * lift; return p; }
  private draw(l: THREE.Line, a: THREE.Vector3, b: THREE.Vector3, lift: number) {
    const at = l.geometry.attributes.position as THREE.BufferAttribute, n = at.count;
    for (let i = 0; i < n; i++) { const p = this.arc(a, b, i / (n - 1), lift); at.setXYZ(i, p.x, p.y, p.z); }
    at.needsUpdate = true; if ((l.material as THREE.LineDashedMaterial).isLineDashedMaterial) l.computeLineDistances();
  }

  reset() {
    for (const e of this.exchanges.values()) this.drop(e);
    this.exchanges.clear();
    for (const p of this.pulses.values()) this.root.remove(p.ring);
    for (const g of this.glow.values()) this.root.remove(g);
    this.pulses.clear(); this.glow.clear(); this.beat = -1; this.packetAge = 9;
  }
  private drop(e: Exchange) { this.root.remove(e.line, e.label, ...e.dots); e.label.element.remove(); }

  /** What the exchange at this gate looks like right now. */
  private step(sim: Sim, x: Vehicle): { color: number; toTruck: boolean; moving: boolean; html: string } {
    const answers = sim.answering(x), id = x.device?.id ?? '', gate = NODES[x.at].label;
    if (!x.cmd) {
      const asking = x.timer < GATE_DWELL * 0.3;
      if (asking) return { color: BLUE, toTruck: true, moving: true, html: `<b>${gate} asks the device</b><i>“sign this random number”</i>` };
      if (!answers) return { color: RED, toTruck: false, moving: false, html: `<b>No reply</b><i>${x.device ? id + ' is silent' : 'no device on this truck'}</i>` };
      return { color: GREEN, toTruck: false, moving: true, html: `<b>${id} replies</b><i>signed message · plate ${x.plate}</i>` };
    }
    const heard = [...sim.gov.evidence].reverse().find((e) => e.node === x.at && e.src === 'Device radio');
    const wrong = !!heard && heard.value.includes('WRONG');
    const pad = [...sim.gov.evidence].reverse().find((e) => e.node === x.at && e.src === 'Buried pad');
    const check = !answers ? '✕ no reply' : wrong ? '✕ signature wrong' : '✓ signature valid';
    const verdict = x.cmd === 'OPEN' ? 'GATE OPENS' : x.cmd === 'HOLD' ? 'GATE HOLDS' : 'TURNED AWAY';
    const color = x.cmd === 'OPEN' ? GREEN : x.cmd === 'HOLD' ? AMBER : RED;
    return { color, toTruck: false, moving: x.cmd === 'OPEN', html: `<b>${verdict}</b><i>${answers ? id + ' · ' : ''}${check}</i>${pad ? `<i>buried pad ${pad.value}${x.load > 0.3 ? ` · load ${f1(x.load)} t` : ''}</i>` : ''}` };
  }

  update(sim: Sim, dt: number, vehicles: Map<string, { model: M.TruckModel }>, gates: Map<string, M.GateModel>, show: boolean) {
    this.time += dt;
    this.root.visible = show;
    const minute = Math.floor(sim.t + 1e-6), sent = minute !== this.beat; this.beat = minute;
    const here = new THREE.Vector3(), there = new THREE.Vector3(), live = new Set<string>();
    let focused: THREE.Vector3 | null = null;
    for (const x of sim.vehicles) {
      const view = vehicles.get(x.uid);
      if (x.state === 'gone' || !view || !view.model.root.visible) continue;
      view.model.root.updateWorldMatrix(true, true);
      view.model.box.getWorldPosition(here);
      const answers = sim.answering(x), story = !x.uid.startsWith('B'), isFocus = x.uid === this.focus;
      // a glow marks the device on the truck; red when it has gone quiet or been opened
      if (x.device && (story || isFocus)) {
        live.add(x.uid);
        let g = this.glow.get(x.uid);
        if (!g) { g = this.ball(0.8, GREEN); this.glow.set(x.uid, g); this.root.add(g); }
        g.position.copy(here); g.visible = true;
        (g.material as THREE.MeshBasicMaterial).color.set(!answers ? RED : x.powerCut ? AMBER : GREEN);
        g.scale.setScalar(1 + 0.45 * Math.abs(Math.sin(this.time * (answers ? 3 : 9))));
      }
      // a pulse each time the device sends its data
      if (x.device && answers && sent) {
        let p = this.pulses.get(x.uid);
        if (!p) { const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 32), new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, side: THREE.DoubleSide, depthWrite: false, depthTest: false })); ring.rotation.x = -Math.PI / 2; ring.renderOrder = 10; p = { ring, age: 0 }; this.pulses.set(x.uid, p); this.root.add(ring); }
        p.age = 0; if (isFocus) this.packetAge = 0;
      }
      const p = this.pulses.get(x.uid);
      if (p) { p.age += dt; const u = p.age / 1.1; p.ring.visible = u < 1; p.ring.position.copy(here); p.ring.scale.setScalar(3 + 26 * u); (p.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - u)); (p.ring.material as THREE.MeshBasicMaterial).color.set(x.powerCut ? AMBER : GREEN); }
      if (isFocus && answers) focused = here.clone();

      // the exchange with a gate
      const gate = gates.get(x.at), atGate = (x.state === 'gate' || x.state === 'held') && !!gate && gate.root.visible;
      let e = this.exchanges.get(x.uid);
      if (atGate) {
        if (!e || e.node !== x.at) {
          if (e) this.drop(e);
          const label = this.tag('signal'); const dots = Array.from({ length: DOTS }, () => this.ball(0.7, BLUE));
          e = { dots, line: this.line(25, BLUE), label, html: '', until: 0, node: x.at }; this.exchanges.set(x.uid, e); this.root.add(e.line, label, ...dots);
        }
        const s = this.step(sim, x);
        gate!.lamp.updateWorldMatrix(true, false); gate!.lamp.getWorldPosition(there); there.y += 5;
        if (s.html !== e.html) { e.html = s.html; e.label.element.innerHTML = s.html; e.label.element.className = `tag signal ${s.color === GREEN ? 'ok' : s.color === RED ? 'bad' : s.color === AMBER ? 'warn' : ''}`; }
        e.until = this.time + HOLD_SECONDS;
        this.draw(e.line, there, here, 12);
        (e.line.material as THREE.LineBasicMaterial).color.set(s.color); e.line.visible = true;
        e.dots.forEach((d, i) => {
          const u = (this.time * 0.9 + i / DOTS) % 1;
          d.visible = s.moving; (d.material as THREE.MeshBasicMaterial).color.set(s.color);
          d.position.copy(this.arc(there, here, s.toTruck ? u : 1 - u, 12));
        });
      }
      if (e) {
        e.label.position.copy(here).y += 9; e.label.center.set(1.12, 1.7);
        if (!atGate) { e.line.visible = false; e.dots.forEach((d) => (d.visible = false)); }
        if (this.time > e.until) { this.drop(e); this.exchanges.delete(x.uid); }
        else e.label.visible = show;
      }
    }
    for (const [uid, g] of this.glow) if (!live.has(uid)) { this.root.remove(g); this.glow.delete(uid); }
    for (const [uid, e] of this.exchanges) if (!sim.find(uid) || sim.find(uid)!.state === 'gone') { this.drop(e); this.exchanges.delete(uid); }
    // data link from the truck in focus to the control room
    this.link.visible = show && !!focused;
    this.packetAge += dt;
    this.packet.visible = show && !!focused && this.packetAge < 1.3;
    if (focused) {
      there.set(CONTROL_ROOM.x, height(CONTROL_ROOM.x, CONTROL_ROOM.z) + 28, CONTROL_ROOM.z);
      this.draw(this.link, focused, there, 90);
      if (this.packet.visible) this.packet.position.copy(this.arc(focused, there, this.packetAge / 1.3, 90));
    }
  }
}
