/* Ties the world, cameras, screens and story together. */
import * as THREE from 'three';
import { Sim } from '../engine/sim';
import { OFFICERS } from '../engine/governor';
import { clock, hhmm, f1 } from '../engine/util';
import { nearestNodeLabel } from '../engine/layout';
import type { Weather, Why } from '../engine/types';
import { Stage, Quality } from '../view/stage';
import { World, ViewMode, Layer, Pick } from '../view/scene';
import { Rig, CamMode, CAM_NAMES } from '../view/camera';
import { height } from '../view/terrain';
import { ACTS } from './acts';
import { answers, esc, PANELS, proposalHtml, TABS, whyHtml } from './panels';

type Tab = keyof typeof PANELS;
interface Banner { el: HTMLElement; until: number; kind: string }
const SEED = 20261125;
const $ = (id: string) => document.getElementById(id)!;

export class App {
  sim = new Sim(SEED);
  stage: Stage; world: World; rig: Rig;
  act = 1; actTime = 0; playing = true; speed: 'auto' | 'quick' | number = 'auto';
  tab: Tab = 'control';
  selected = ''; subject = ''; target = ''; focus = '';
  reveal = false;
  open = new Set<number>();
  checked: ReturnType<Sim['gov']['log']['verify']> | null = null;
  backup: string | null = null;
  ignoreBranch = false;
  /** Act 5 has finished its story; time rests until the presenter moves on. */
  caseClosed = false;
  private onceDone = new Set<string>();
  private banners: Banner[] = [];
  private seenAlert = 0; private seenLog = 0; private seenProp = 0;
  private decisionOpen = -1;
  private autoPaused = false;
  private autoQuality = true;
  private fps = { frames: 0, time: 0, slow: 0, value: 60 };
  private lastPanel = ''; private lastPanelAt = 0;
  private override: { until: number } | null = null;
  private now = 0;
  private ray = new THREE.Raycaster();
  private insetShown = false;
  private frames = 0;

  constructor() {
    this.stage = new Stage($('stage'));
    this.stage.setQuality('high');
    this.world = new World(this.stage, this.sim, (p) => this.pick(p));
    this.rig = new Rig(this.stage);
    this.rig.onFree = () => ((($('cam') as HTMLSelectElement).value = 'free'));
    this.bind();
    this.goAct(1);
    this.resize();
    this.world.update(0); this.stage.warmUp();
  }

  /* ------------------------------------------------------------ story */
  once(key: string, fn: () => void) { if (!this.onceDone.has(key)) { this.onceDone.add(key); fn(); } }
  private autoDecide = (p: { t: number }) => (this.ignoreBranch && p.t < 52 ? 'ignore' : 'approve') as 'ignore' | 'approve';
  private rebuild() {
    this.sim = new Sim(SEED); this.world.setSim(this.sim); this.stage.setWeather('clear', true);
    this.selected = this.subject = this.target = this.focus = ''; this.open.clear(); this.checked = null; this.backup = null; this.speeds.clear(); this.reveal = false; this.seenProp = 0;
  }
  private fastForward(t: number) {
    // proposals that are already waiting are settled the same way as new ones
    this.sim.autoDecide = this.autoDecide; this.sim.runTo(t); this.sim.autoDecide = null;
    this.world.setSim(this.sim); this.skipNews();
  }
  private skipNews() { this.seenAlert = this.sim.gov.alerts.length; this.seenLog = this.sim.gov.log.entries.length; this.seenProp = this.sim.gov.proposals.length; }
  goAct(n: number, o: { ignore?: boolean; rebuild?: boolean } = {}) {
    const act = ACTS[n - 1]; if (!act) return;
    // moving on from a closed case must not count as skipping the decision
    const fromClosed = this.act === 5 && n === 6 && this.caseClosed;
    this.caseClosed = false;
    this.closeModal(); this.clearBanners(); this.decisionOpen = -1; this.override = null; this.sim.autoDecide = null;
    const back = n <= 6 && this.sim.t > act.start + (n <= 2 ? 0.8 : 0.4);
    if (o.rebuild || back) { this.ignoreBranch = o.ignore ?? n >= 6; this.rebuild(); }
    else if (this.sim.t < act.start && !fromClosed) this.ignoreBranch = o.ignore ?? n >= 6;
    if (n === 8 && this.sim.t < 100) this.fastForward(100);
    else if (this.sim.t < act.start) this.fastForward(act.start);
    this.act = n; this.actTime = 0; this.onceDone.clear(); this.playing = true; this.autoPaused = false;
    this.setLayers({ fence: true, gates: true, pads: true, checks: true, towers: true, zones: false, boundary: true });
    this.setView(act.view); this.select(''); if (n !== 7) this.openTab('control');
    this.rig.set('director'); ($('cam') as HTMLSelectElement).value = 'director';
    $('hero').hidden = true;
    act.enter?.(this);
    // in the what-if replay of the pile act the officers keep ignoring the advice
    if (n === 6 && this.ignoreBranch) this.sim.autoDecide = () => 'ignore';
    // a jump cuts straight to the new scene; moving on flies there
    act.tick(this, 0); if (o.rebuild || back || n === 1) this.rig.cut();
    this.renderActs(); this.render(true);
  }
  holdShot() { return !!this.override && this.now < this.override.until; }

  /* ------------------------------------------------------------ view state */
  setView(v: ViewMode) { this.world.setView(v); document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.view === v)); document.body.dataset.view = v; }
  setLayers(l: Partial<Record<Layer, boolean>>) { Object.assign(this.world.layers, l); this.renderLayers(); }
  openTab(t: Tab) { this.tab = t; this.render(true); }
  select(uid: string) { this.selected = uid; this.subject = ''; this.world.selected = uid; }
  private pick(p: Pick) {
    if (p.type === 'vehicle') {
      this.select(p.id); this.rig.subject = p.id;
      const x = this.sim.find(p.id); if (x?.device) this.target = x.device && !p.id.startsWith('B') ? p.id : this.target;
      if (this.tab !== 'vendor') this.openTab('evidence'); else this.render(true);
      if (this.rig.mode !== 'driver') { this.override = { until: this.now + 20 }; this.rig.set('director'); this.rig.base = { k: 'chase', uid: p.id }; ($('cam') as HTMLSelectElement).value = 'director'; }
    } else if (p.type === 'gate') { this.rig.gateId = p.id; this.override = { until: this.now + 10 }; this.rig.set('director'); this.rig.base = { k: 'gate', id: p.id }; }
    else if (p.type === 'pile') { this.openTab('questions'); this.override = { until: this.now + 12 }; this.rig.set('director'); this.rig.base = { k: 'preset', name: 'pile' }; }
  }

  /* ------------------------------------------------------------ banners */
  say(kind: 'info' | 'ok' | 'bad' | 'warn', title: string, text: string, seconds = 7, action?: { label: string; act: string }, why?: Why) {
    const el = document.createElement('div'); el.className = 'banner ' + kind;
    el.innerHTML = `<h2>${esc(title)}</h2><p>${esc(text)}</p>${why ? `<div class="chipsline">${why.inputs.slice(0, 5).map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join('')}</div>` : ''}${action ? `<div class="row"><button class="primary" data-act="${action.act}">${esc(action.label)}</button></div>` : ''}`;
    $('banner').appendChild(el); this.banners.push({ el, until: this.now + seconds, kind });
    while (this.banners.filter((b) => b.kind !== 'decision').length > 2) this.dropBanner(this.banners.find((b) => b.kind !== 'decision')!);
  }
  private dropBanner(b: Banner) { b.el.remove(); this.banners.splice(this.banners.indexOf(b), 1); }
  clearBanners() { [...this.banners].forEach((b) => this.dropBanner(b)); }
  hero(title: string, sub: string, small: string, seconds: number) {
    const el = $('hero'); el.innerHTML = `<h1>${title}</h1><p>${sub}</p><small>${small}</small>`; el.hidden = false;
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go'); el.style.animationDuration = seconds + 's';
    el.onanimationend = () => (el.hidden = true);
  }
  toast(msg: string, ok = true) { const t = $('toast'); t.textContent = msg; t.className = ok ? 'ok' : 'no'; t.hidden = false; clearTimeout((t as any).h); (t as any).h = setTimeout(() => (t.hidden = true), 4200); }
  private news() {
    const g = this.sim.gov;
    // routine gate decisions for the story trucks
    for (; this.seenLog < g.log.entries.length; this.seenLog++) {
      const e = g.log.entries[this.seenLog];
      if (e.kind === 'DECISION' && /: OPEN\./.test(e.text) && ((this.act === 3 && e.subject === 'DEV-1101') || (this.act === 7 && e.subject === this.sim.find(this.target)?.device?.id))) {
        const [where, rest] = e.text.split(': OPEN. ');
        this.say('ok', `${where} opens · AI alone`, rest ?? '', 4.5);
      }
    }
    for (; this.seenAlert < g.alerts.length; this.seenAlert++) {
      const a = g.alerts[this.seenAlert];
      if (a.sev === 'low') continue;
      this.say(a.sev === 'high' ? 'bad' : 'warn', a.title, a.detail, a.sev === 'high' ? 11 : 7, undefined, a.why);
      this.open.clear(); this.open.add(a.id);
      if (this.act === 7 && a.pos) { this.override = { until: this.now + 7 }; this.rig.base = { k: 'gate', id: Object.keys(this.sim.gates).find((id) => a.title.includes(id) || a.detail.includes(`Gate ${id}`)) ?? '' } as const; if (!(this.rig.base as { id: string }).id) this.rig.base = { k: 'point', pos: a.pos }; }
    }
    // a decision that needs people stops the clock
    for (; this.seenProp < g.proposals.length; this.seenProp++) { if (g.proposals[this.seenProp].state !== 'pending') continue; if (this.playing) { this.playing = false; this.autoPaused = true; } this.openTab('control'); }
    const waiting = g.proposals.find((p) => p.state === 'pending');
    const key = waiting ? waiting.id * 10 + waiting.approvals.length : -1;
    if (key !== this.decisionOpen) {
      this.banners.filter((b) => b.kind === 'decision').forEach((b) => this.dropBanner(b));
      this.decisionOpen = key;
      if (waiting) { const el = document.createElement('div'); el.className = 'banner decision'; el.innerHTML = proposalHtml(waiting, true); $('banner').prepend(el); this.banners.push({ el, until: Infinity, kind: 'decision' }); }
      else if (this.autoPaused) { this.playing = true; this.autoPaused = false; }
    }
  }
  private decide(fn: () => void) { fn(); this.news(); this.render(true); }

  /* ------------------------------------------------------------ actions */
  private action(act: string, arg: string) {
    const g = this.sim.gov;
    switch (act) {
      case 'approve': { const [id, officer] = arg.split('|'); this.decide(() => g.approve(+id, officer)); break; }
      case 'ignore': this.decide(() => g.ignore(+arg)); break;
      case 'override': this.decide(() => g.override(+arg, OFFICERS[0])); break;
      case 'toggle': { const id = +arg; if (this.open.has(id)) this.open.delete(id); else this.open.add(id); break; }
      case 'show': { const a = g.alerts[+arg]; if (a.pos) { this.override = { until: this.now + 12 }; this.rig.set('director'); this.rig.base = { k: 'point', pos: a.pos, dist: 190 }; ($('cam') as HTMLSelectElement).value = 'director'; } break; }
      case 'penalty': g.penalty(+arg); break;
      case 'reveal': this.reveal = !this.reveal; break;
      case 'trip': { const x = this.sim.vehicles.find((v) => v.device?.id === arg && v.state !== 'gone'); this.select(x?.uid ?? ''); this.subject = arg; this.openTab('evidence'); break; }
      case 'clear': this.select(''); break;
      case 'scan': this.sim.scanPiles(1); if (!this.playing) this.playing = true; this.toast('Stockpile scan started.'); break;
      case 'verify': this.checked = g.log.verify(); break;
      case 'editlog': case 'rewrite': {
        const i = g.log.entries.findIndex((e) => e.kind === 'ALERT'); const k = i >= 0 ? i : Math.min(3, g.log.entries.length - 1);
        this.backup ??= JSON.stringify(g.log.entries);
        g.log.edit(k, 'Routine check. Nothing to report.'); if (act === 'rewrite') g.log.rewriteFrom(k); this.checked = null;
        this.toast(`Entry ${k} changed${act === 'rewrite' ? ' and every later hash recalculated' : ''}. Now check the log.`); break;
      }
      case 'restore': {
        if (!this.backup) break;
        const old = JSON.parse(this.backup) as typeof g.log.entries;
        g.log.entries.splice(0, old.length, ...old); g.log.rewriteFrom(old.length);
        for (const list of Object.values(g.log.anchors)) for (const a of list) if (a.upTo >= old.length) a.hash = g.log.entries[a.upTo].hash;
        this.backup = null; this.checked = null; this.toast('Original entries restored.'); break;
      }
      case 'send': { const x = this.sim.sendTruck(arg as 'G1'); this.target = x.uid; this.playing = true; this.override = null; this.toast(`${x.name} is driving to ${arg}.`); break; }
      case 'target': this.target = arg; this.select(arg); this.override = null; break;
      case 'attack': { const r = this.sim.attack(arg, this.target); this.toast(r.msg, r.ok); if (r.ok) { this.playing = true; if (['sneak', 'dash'].includes(arg)) { this.target = this.sim.vehicles.at(-1)!.uid; this.override = null; } if (arg === 'fake') this.target = this.sim.vehicles.at(-1)!.uid; } break; }
      case 'weather': this.sim.setWeather(arg as Weather); this.playing = true; break;
      case 'tol': g.tol = +arg; g.record('Person', 'RECORD', `Weight tolerance set to ${arg} t (demonstration setting).`); break;
      case 'cap': g.setCap(+arg); break;
      case 'whatif': this.goAct(6, { rebuild: true, ignore: true }); return;
      case 'goact': this.goAct(+arg); return;
      case 'close': this.closeModal(); return;
      case 'restart': this.goAct(1, { rebuild: true }); return;
    }
    this.news(); this.render(true);
  }

  /* ------------------------------------------------------------ verdict and help */
  private modal(html: string, cls: string) { const m = $('modal'); m.className = cls; m.innerHTML = `<div class="sheet">${html}</div>`; m.hidden = false; }
  closeModal() { $('modal').hidden = true; }
  verdict() {
    const g = this.sim.gov, v = g.log.verify(), a = answers(this), p = g.permit();
    this.playing = false;
    this.modal(`<header><div><h1>Verdict · shift record at ${hhmm(this.sim.t)}</h1><p>Answered from independent evidence. The Vendor’s paper is treated as a claim.</p></div><button data-act="close">Close <kbd>Esc</kbd></button></header>
      <div class="six">${a.map((x, i) => `<div class="${x.bad ? 'bad' : 'ok'}"><span>${i + 1}</span><h4>${x.q}</h4><b>${esc(x.short)}</b></div>`).join('')}</div>
      <div class="foot">
        <div><h4>Evidence pack</h4><p><b>${g.evidence.length}</b> sensor readings · <b>${g.alerts.length}</b> alerts · <b>${g.proposals.length}</b> recommendations (${g.counts.notActed} not acted on)</p><p class="${v.ok ? 'good' : 'badt'}">${v.ok ? `✓ Log of ${v.count} entries verifies against both parties’ copies` : '✕ The log fails its check'}</p></div>
        <div><h4>Cost</h4><p>Set-up <b>Rs 11.0–22.7 crore</b><br>Running <b>Rs 1.8–4.8 crore a year</b></p><small>Estimates from the project deck.</small></div>
        <div><h4>Next step</h4><p>Expert paper review (weeks 1–4), then a pilot on one gate and its haul road (weeks 5–12).</p><small>Existing weighbridges stay in use and are cross-checked.</small></div>
      </div>`, 'verdictm');
  }
  help() {
    this.modal(`<header><div><h1>How to read this simulation</h1></div><button data-act="close">Close <kbd>Esc</kbd></button></header>
    <div class="cols"><div><h4>Keys</h4><table class="kv">
      <tr><td><kbd>Space</kbd></td><td>Play or pause</td></tr><tr><td><kbd>→</kbd> <kbd>←</kbd></td><td>Next or previous act</td></tr><tr><td><kbd>1</kbd>–<kbd>8</kbd></td><td>Jump to an act</td></tr><tr><td><kbd>V</kbd></td><td>Change viewpoint</td></tr><tr><td><kbd>C</kbd></td><td>Change camera</td></tr><tr><td><kbd>A</kbd> <kbd>B</kbd> <kbd>I</kbd></td><td>Officer A, Officer B, ignore</td></tr><tr><td><kbd>N</kbd></td><td>Sneak a truck in now</td></tr><tr><td><kbd>H</kbd></td><td>Hide the screens</td></tr><tr><td>Drag, scroll</td><td>Fly the camera yourself</td></tr><tr><td>Click</td><td>A truck, gate or pile</td></tr></table></div>
    <div><h4>What is sourced</h4><p>Quarry and dump footprints and levels, lease and area in use: IBM inspection report, June 2024.</p>
    <h4>What is assumed</h4><p>Gate, road, tower and zone positions; sensor noise (pads about ±0.2 t, pile scan band ±1%); radio range about 100 m; drone camera swath 230 m and 5-minute sweep; permit limits; radar delay 6 minutes.</p>
    <h4>What is illustrative</h4><p>Trucks and gates are drawn about twice life size. Pile shape change is exaggerated. A followed vehicle is assumed to leave. Costs are deck estimates.</p>
    <h4>About the software</h4><p>The control-room “AI” here is a set of transparent rules, each shown under “why”. The device reply uses a shared-key signature (HMAC-SHA256); production would use a public-key signature inside a secure chip. The log uses real SHA-256 hashes.</p></div></div>`, 'helpm');
  }

  /* ------------------------------------------------------------ screen */
  private renderActs() {
    $('actList').innerHTML = ACTS.map((a) => `<button data-act="goact" data-arg="${a.id}" class="${a.id === this.act ? 'on' : a.id < this.act ? 'done' : ''}"><span class="n">${a.id}</span><span class="t"><b>${a.name}</b><small>${a.minutes}</small></span></button>`).join('');
    $('caption').innerHTML = `<small>What the panel learns</small> ${ACTS[this.act - 1].learns}`;
    ($('next') as HTMLButtonElement).disabled = this.act === 8; ($('prev') as HTMLButtonElement).disabled = this.act === 1;
  }
  private renderLayers() {
    const names: Record<Layer, string> = { boundary: 'Lease boundary', fence: 'Pickup zone fence', gates: 'Gates', pads: 'Buried weighing (x-ray)', checks: 'Checkpoints', towers: 'LiDAR towers', zones: 'Drone zones' };
    $('layers').innerHTML = (Object.keys(names) as Layer[]).map((k) => `<label><input type="checkbox" data-layer="${k}" ${this.world?.layers[k] ? 'checked' : ''}> ${names[k]}</label>`).join('');
  }
  render(force = false) {
    if (!force && this.now - this.lastPanelAt < 0.25) return;
    this.lastPanelAt = this.now;
    const pending = this.sim.gov.proposals.filter((p) => p.state === 'pending').length;
    const tabs = TABS.map(([k, n]) => `<button data-tab="${k}" class="${this.tab === k ? 'on' : ''}">${n}${k === 'control' && pending ? `<i>${pending}</i>` : ''}</button>`).join('');
    if ((($('tabs') as any).cache) !== tabs) { $('tabs').innerHTML = tabs; ($('tabs') as any).cache = tabs; }
    const html = PANELS[this.tab](this);
    if (html !== this.lastPanel) { const el = $('panel'), top = el.scrollTop, same = el.dataset.tab === this.tab; el.innerHTML = html; el.dataset.tab = this.tab; el.scrollTop = same ? top : 0; this.lastPanel = html; }
    $('clock').textContent = clock(this.sim.t + 540);
    $('play').textContent = this.playing ? '❚❚ Pause' : '▶ Play';
    $('play').classList.toggle('paused', !this.playing);
    ($('weather') as HTMLSelectElement).value = this.sim.weather;
    this.readout();
  }
  /** Speed worked out from the positions a device has reported. */
  private speeds = new Map<string, { x: number; z: number; t: number; kmh: number }>();
  private truckSpeed(device: string, p: { x: number; z: number }, t: number) {
    const last = this.speeds.get(device);
    if (!last || t < last.t) { this.speeds.set(device, { x: p.x, z: p.z, t, kmh: 0 }); return 0; }
    if (t > last.t) this.speeds.set(device, { x: p.x, z: p.z, t, kmh: (Math.hypot(p.x - last.x, p.z - last.z) / (t - last.t)) * 0.06 });
    return this.speeds.get(device)!.kmh;
  }
  /** Live data from the truck in focus: only what its device and the fixed sensors have reported. */
  private readout() {
    const uid = this.selected || (this.act >= 3 && this.act <= 7 ? this.focus : ''), x = uid ? this.sim.find(uid) : undefined, el = $('readout');
    if (!x || x.state === 'gone' || this.world.view === 'paper' || (this.insetShown && !this.selected)) { el.hidden = true; return; }
    const g = this.sim.gov, reg = x.device ? g.registry.get(x.device.id) : undefined, trip = x.device ? g.trips.get(x.device.id) : undefined;
    const row = (k: string, val: string, cls = '') => `<div class="${cls}"><b>${k}</b><span>${esc(val)}</span></div>`;
    const seen = g.evidence.filter((e) => (x.device ? e.subject === x.device.id : e.subject.includes(x.plate)));
    const hand = [...seen].reverse().find((e) => e.src === 'Device radio');
    const handRow = hand ? row('Last gate', `${hand.node}: ${hand.value}`, hand.status) : '';
    let html: string;
    if (!x.device || !reg) {
      html = `<h4>No device on this truck <span>nothing to read</span></h4>${row('Link', 'No signal: the system has no data from it', 'bad')}${handRow}`;
    } else if (!trip) {
      html = `<h4>Truck device · ${esc(x.device.id)} <span>${esc(reg.plate)}</span></h4>${row('Link', 'Not yet checked at a gate')}${handRow}`;
    } else {
      const opened = g.alerts.some((a) => a.subject === x.device!.id && a.title === 'Device housing opened');
      const quiet = this.sim.t - trip.lastSeen, silent = trip.inside && quiet > 1.5;
      const link = opened ? row('Link', 'Box opened: device locked itself', 'bad') : silent ? row('Link', `No message for ${f1(quiet)} min`, 'bad') : row('Link', 'Sending data', 'ok');
      const loading = x.state === 'loading' && this.sim.answering(x);
      const load = loading ? `${f1(x.load)} t and rising` : trip.sensorNet !== undefined ? `${f1(trip.sensorNet)} t` : 'empty';
      const kmh = this.truckSpeed(x.device.id, trip.claimed, trip.lastSeen);
      html = `<h4><i class="live ${opened || silent ? 'bad' : ''}"></i>Truck device · ${esc(x.device.id)} <span>${esc(reg.plate)}</span></h4>${link}`
        + row('Position', `near ${nearestNodeLabel(trip.claimed)} (${Math.round(trip.claimed.x)}, ${Math.round(-trip.claimed.z)} m)`)
        + row('Speed', `${Math.round(kmh)} km/h, from reported positions`)
        + row('Load sensor', load)
        + row('Power', trip.battery ? 'Own battery: truck power lost' : 'Truck supply', trip.battery ? 'warn' : '')
        + row('Last message', hhmm(trip.lastSeen))
        + row('Status', trip.status) + handRow;
    }
    if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
    el.hidden = false;
  }
  private bind() {
    document.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button'); if (!b) { if (!(e.target as HTMLElement).closest('#layers')) $('layers').hidden = true; return; }
      if (b.dataset.act) this.action(b.dataset.act, b.dataset.arg ?? '');
      else if (b.dataset.tab) this.openTab(b.dataset.tab as Tab);
      else if (b.dataset.view) { this.setView(b.dataset.view as ViewMode); this.render(true); }
      else if (b.id === 'play') this.toggle();
      else if (b.id === 'next') this.goAct(this.act + 1);
      else if (b.id === 'prev') this.goAct(this.act - 1);
      else if (b.id === 'help') this.help();
      else if (b.id === 'layersBtn') $('layers').hidden = !$('layers').hidden;
      b.blur();
    });
    $('layers').addEventListener('change', (e) => { const i = e.target as HTMLInputElement; this.world.layers[i.dataset.layer as Layer] = i.checked; });
    const sel = (id: string, fn: (v: string) => void) => $(id).addEventListener('change', (e) => { fn((e.target as HTMLSelectElement).value); (e.target as HTMLElement).blur(); });
    $('speed').innerHTML = `<option value="auto">Pace: story</option><option value="quick">Pace: quick</option>${[0.25, 0.5, 1, 3, 10].map((s) => `<option value="${s}">${s} min / s</option>`).join('')}`;
    $('cam').innerHTML = (Object.keys(CAM_NAMES) as CamMode[]).map((k) => `<option value="${k}">${CAM_NAMES[k]}</option>`).join('');
    $('weather').innerHTML = '<option value="clear">Clear day</option><option value="dust">Dust</option><option value="monsoon">Rain, low cloud</option>';
    $('quality').innerHTML = '<option value="auto">Quality: auto</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>';
    sel('speed', (v) => (this.speed = v === 'auto' || v === 'quick' ? v : +v));
    sel('cam', (v) => { this.override = null; this.rig.set(v as CamMode); });
    sel('weather', (v) => this.sim.setWeather(v as Weather));
    sel('quality', (v) => { this.autoQuality = v === 'auto'; if (v !== 'auto') this.stage.setQuality(v as Quality); });
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('resize', () => this.resize());
    let down = [0, 0];
    this.stage.renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; $('layers').hidden = true; });
    this.stage.renderer.domElement.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      this.ray.setFromCamera(new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1), this.stage.camera);
      const p = this.world.pick(this.ray); if (p) this.pick(p);
    });
  }
  toggle() { this.playing = !this.playing; this.autoPaused = false; if (this.playing && this.act === 8) this.closeModal(); this.render(true); }
  private key(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
    const k = e.key.toLowerCase(), waiting = this.sim.gov.proposals.find((p) => p.state === 'pending');
    if (k === ' ') { e.preventDefault(); this.toggle(); }
    else if (k === 'arrowright' || k === 'pagedown') this.goAct(this.act + 1);
    else if (k === 'arrowleft' || k === 'pageup') this.goAct(this.act - 1);
    else if (k >= '1' && k <= '8') this.goAct(+k);
    else if (k === 'v') { const order: ViewMode[] = ['paper', 'evidence', 'truth']; this.setView(order[(order.indexOf(this.world.view) + 1) % 3]); this.render(true); }
    else if (k === 'c') { const order = Object.keys(CAM_NAMES) as CamMode[], m = order[(order.indexOf(this.rig.mode) + 1) % order.length]; this.override = null; this.rig.set(m); ($('cam') as HTMLSelectElement).value = m; this.toast('Camera: ' + CAM_NAMES[m]); }
    else if ((k === 'a' || k === 'b') && waiting) this.action('approve', `${waiting.id}|${OFFICERS[k === 'a' ? 0 : 1]}`);
    else if (k === 'i' && waiting) this.action('ignore', String(waiting.id));
    else if (k === 'n') this.action('attack', 'sneak');
    else if (k === 'h') document.body.classList.toggle('bare'), this.resize();
    else if (k === 'escape') { this.closeModal(); $('layers').hidden = true; }
  }
  resize() {
    this.stage.resize();
    const w = window.innerWidth, h = window.innerHeight, side = document.body.classList.contains('bare') ? 0 : $('side').offsetWidth;
    // keep the subject centred in the part of the screen the panel does not cover
    if (side) this.stage.camera.setViewOffset(w, h, side / 2, 0, w, h); else this.stage.camera.clearViewOffset();
    this.stage.camera.updateProjectionMatrix();
  }

  /* ------------------------------------------------------------ frame */
  frame(dtReal: number) {
    const dt = Math.min(dtReal, 0.1); this.now += dt;
    const act = ACTS[this.act - 1];
    if (this.playing) {
      this.actTime += dt;
      // story pace leaves room to talk; quick pace suits a shorter slot
      const rate = typeof this.speed === 'number' ? this.speed : act.speed(this) * (this.speed === 'quick' ? 1.15 : 0.65);
      // acts 3 to 6 stop where the next one begins, so talking never makes the presenter miss a scene
      const limit = this.act >= 3 && this.act <= 6 ? ACTS[this.act].start : Infinity, left = Math.max(0, limit - this.sim.t);
      if (rate > 0 && left > 0) this.sim.step(Math.min(rate * dt, left));
      else if (rate > 0 && left <= 0) this.once('end', () => this.toast('End of this act. Press \u2192 when ready.'));
    }
    this.news();
    if (this.override && this.now >= this.override.until) this.override = null;
    if (this.playing && !this.override) act.tick(this, this.actTime);
    else if (this.playing && this.act <= 2) act.tick(this, this.actTime);
    for (const b of [...this.banners]) if (this.now > b.until && this.playing) this.dropBanner(b); else if (!this.playing && b.until !== Infinity) b.until += dt;
    if (this.stage.weather !== this.sim.weather) this.stage.setWeather(this.sim.weather);
    this.world.signals.focus = this.selected || this.focus;
    this.world.update(this.playing ? dt : dt * 0.35);
    this.rig.update(dt, this.world);
    this.stage.update(dt, this.rig.target);
    const r = this.stage.renderer;
    r.setScissorTest(false); r.setViewport(0, 0, window.innerWidth, window.innerHeight);
    this.stage.render();
    this.stage.labels.render(this.stage.scene, this.stage.camera);
    if (++this.frames % 3 === 0) this.world.declutter();
    document.body.classList.toggle('hero', !$('hero').hidden);
    this.drawInset();
    this.alertMode();
    this.render();
    this.measure(dtReal);
  }
  /** High-alert mode: a badge and a red frame while the swarm is out, amber while it waits for two officers. */
  private alertMode() {
    const mode = this.world.fleet.mode, badge = $('alertmode'), show = (mode === 'swarm' || mode === 'waiting') && this.world.view !== 'paper' && $('modal').hidden === true;
    badge.hidden = !show; $('alertframe').hidden = !(show && mode === 'swarm');
    if (!show || badge.dataset.mode === mode) return;
    badge.dataset.mode = mode;
    badge.querySelector('b')!.textContent = mode === 'swarm' ? 'HIGH ALERT' : 'ALERT';
    badge.querySelector('span')!.textContent = mode === 'swarm' ? 'Drone swarm investigating' : 'Swarm ready at the charging station · two officers must approve';
  }
  /** Picture-in-picture: what a drone's camera sees. */
  private drawInset() {
    const pip = $('pip'), sim = this.sim;
    const follow = sim.drones[4].active ? sim.drones[4] : null, survey = !follow && this.act >= 5 && sim.flight && !sim.flight.done ? sim.drones[2] : null, d = follow ?? survey;
    const show = !!d && d.active && this.world.view !== 'paper' && !document.body.classList.contains('bare') && this.rig.mode !== 'map' && $('modal').hidden === true;
    this.insetShown = show; pip.hidden = !show; if (!show) return;
    const m = this.world.drones.get(d!.id)!, cam = this.stage.inset, p = m.root.position;
    cam.position.set(p.x, p.y - 8, p.z);
    let look: THREE.Vector3;
    const uid = follow ? sim.follow?.uid : null, v = uid ? this.world.vehiclePos(uid) : null;
    if (v) { look = v.pos.clone(); cam.fov = 30; }
    else { const x = p.x + Math.sin(d!.heading) * 55, z = p.z + Math.cos(d!.heading) * 55; look = new THREE.Vector3(x, height(x, z), z); cam.fov = 55; }
    cam.lookAt(look); cam.updateProjectionMatrix();
    const rect = pip.getBoundingClientRect(), r = this.stage.renderer, y = window.innerHeight - rect.bottom;
    pip.querySelector('span')!.textContent = follow ? 'Swarm lead camera' : 'Drone C camera · counting round';
    const hidden = [...this.world.drones.values()].map((x) => [x, x.cone.visible, x.root.visible] as const);
    m.root.visible = false;
    r.setScissorTest(true); r.setScissor(rect.left, y, rect.width, rect.height); r.setViewport(rect.left, y, rect.width, rect.height);
    r.shadowMap.autoUpdate = false; r.render(this.stage.scene, cam); r.shadowMap.autoUpdate = true;
    r.setScissorTest(false);
    hidden.forEach(([x, c, v2]) => { x.cone.visible = c; x.root.visible = v2; });
  }
  private measure(dt: number) {
    const f = this.fps; f.frames++; f.time += dt;
    if (f.time < 2) return;
    f.value = f.frames / f.time; f.frames = 0; f.time = 0;
    $('fps').textContent = `${Math.round(f.value)} fps · ${this.stage.quality}`;
    if (!this.autoQuality || document.hidden || this.now < 6) return;
    f.slow = f.value < 27 ? f.slow + 1 : 0;
    if (f.slow >= 2 && this.stage.quality !== 'low') { f.slow = 0; const q = this.stage.quality === 'high' ? 'medium' : 'low'; this.stage.setQuality(q); this.resize(); this.toast(`Graphics quality lowered to ${q} to keep motion smooth.`); }
  }
}
export { whyHtml };
