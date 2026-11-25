/* The control-room screens. Everything here comes from the Governing Body's records, never from the simulated truth. */
import { OFFICERS } from '../engine/governor';
import { NODES, PILES } from '../engine/layout';
import { f1, hhmm } from '../engine/util';
import type { Alert, Proposal, Trip, Why } from '../engine/types';
import type { App } from './app';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const nice = (n: number) => Math.round(n).toLocaleString('en-IN');
const btn = (act: string, arg: string, label: string, cls = '', off = false) => `<button data-act="${act}" data-arg="${esc(arg)}" class="${cls}"${off ? ' disabled' : ''}>${label}</button>`;
const h = (title: string, extra = '') => `<h3>${title}${extra ? `<small>${extra}</small>` : ''}</h3>`;
export const TABS = [['control', 'Control room'], ['evidence', 'Evidence'], ['questions', 'Questions'], ['log', 'Log'], ['vendor', 'Be the Vendor']] as const;

export function whyHtml(w: Why) {
  return `<div class="why"><p>${esc(w.rule)}</p><table>${w.inputs.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></div>`;
}
export function proposalHtml(p: Proposal, compact = false) {
  const signed = (o: string) => p.approvals.includes(o);
  return `<div class="proposal">
    <div class="who">${p.origin === 'AI' ? 'AI recommends · a person decides' : 'Officer request'}<span>expires ${hhmm(p.expires)}</span></div>
    <div class="what">${esc(p.text)}</div>
    ${compact ? '' : whyHtml(p.why)}
    <div class="row">${OFFICERS.map((o, i) => btn('approve', `${p.id}|${o}`, signed(o) ? `✓ ${o}` : `${o} approves <kbd>${'AB'[i]}</kbd>`, 'amber', signed(o))).join('')}${btn('ignore', String(p.id), 'Ignore <kbd>I</kbd>', 'ghost')}</div>
    ${compact ? '' : `<div class="row">${btn('override', String(p.id), 'Try to act with one officer only', 'link')}</div>`}
  </div>`;
}
function alertHtml(app: App, a: Alert) {
  const open = app.open.has(a.id);
  return `<div class="alert ${a.sev}${open ? ' open' : ''}">
    <button class="head" data-act="toggle" data-arg="${a.id}"><time>${hhmm(a.t)}</time><span>${esc(a.title)}</span></button>
    ${open ? `<div class="body"><p>${esc(a.detail)}</p>${whyHtml(a.why)}<div class="row">${a.pos ? btn('show', String(a.id), 'Show on site') : ''}${btn('penalty', String(a.id), a.penalised ? 'Referred for penalty ✓' : 'Officer: refer for penalty', 'ghost', a.penalised)}</div></div>` : ''}
  </div>`;
}
function meter(label: string, used: number, cap: number, unit: string, paper?: number) {
  const u = Math.min(100, (used / cap) * 100);
  return `<div class="meter ${used > cap ? 'bad' : used >= 0.8 * cap ? 'warn' : ''}"><span>${label}</span><b>${nice(used)} / ${nice(cap)} ${unit}</b><div><i style="width:${u.toFixed(1)}%"></i>${paper !== undefined && paper > 0 ? `<em style="left:${Math.min(99, (paper / cap) * 100).toFixed(1)}%" title="Vendor paper"></em>` : ''}</div></div>`;
}
function control(app: App) {
  const g = app.sim.gov, p = g.permit(), pending = g.proposals.filter((x) => x.state === 'pending');
  const hour = Math.floor(app.sim.t / 60);
  const rounds = g.rounds.slice(-3).reverse();
  const verdicts: Record<string, string> = { match: 'matches', more: 'MORE than log', fewer: 'FEWER than log', recount: 'recount', missed: 'missed' };
  return `
  <div class="stats"><div><b>${g.expectedInside().length}</b><span>inside by gate log</span></div><div class="ai"><b>${g.counts.ai}</b><span>AI alone</span></div><div class="aip"><b>${g.counts.aiPerson}</b><span>AI + person</span></div><div class="per"><b>${g.counts.person}</b><span>person</span></div><div class="not"><b>${g.counts.notActed}</b><span>not acted on</span></div></div>
  ${pending.length ? h('Waiting for people', 'two officers needed') + pending.map((x) => proposalHtml(x)).join('') : ''}
  ${h('Alerts', g.alerts.length ? `${g.alerts.length} so far · click for why` : '')}
  <div class="alerts">${g.alerts.length ? g.alerts.slice(-40).reverse().map((a) => alertHtml(app, a)).join('') : '<p class="quiet">Nothing to report. Routine gate decisions are in the log.</p>'}</div>
  ${h('Drone counting rounds', 'exactly two an hour')}
  ${rounds.length ? rounds.map((r) => `<div class="round ${r.verdict}"><time>${hhmm(r.t)}</time><span>${r.verdict === 'missed' ? 'Grounded by weather' : `Log expects ${r.expected} · counted ${r.counted}`}</span><b>${verdicts[r.verdict]}</b></div>`).join('') : '<p class="quiet">No round flown yet this shift.</p>'}
  <p class="quiet">${app.reveal ? app.sim.scheduler.rounds.filter((r) => r.hour >= hour && r.hour <= hour + 1 && r.status === 'pending').map((r) => `${hhmm(r.t)}${r.trigger === 'alert' ? ' (moved by alert)' : ''}`).join(' · ') || 'No pending round this hour' : 'Times of the next rounds are secret.'} ${btn('reveal', '', app.reveal ? 'Hide times' : 'Reveal to the panel', 'link')}</p>
  ${h('Permit use', 'measured, near real time')}
  ${meter('Quantity (white mark: Vendor paper)', p.tonnes, g.cap.tonnes, 't', p.paper)}${meter('Trips', p.trips, g.cap.trips, '')}${meter('Vehicles', p.vehicles, g.cap.vehicles, '')}${meter('Shift time', p.minutes, g.cap.minutes, 'min')}`;
}
const ROWS = (t: Trip) => {
  const measured = t.destNet ?? t.exitNet ?? t.zoneNet;
  const row = (name: string, owner: string, val: number | undefined) => {
    const bad = val !== undefined && measured !== undefined && Math.abs(val - measured) > Math.max(1.5, measured * 0.05);
    return `<tr class="${val === undefined ? 'none' : bad ? 'bad' : 'ok'}"><td>${name}<small>${owner}</small></td><td>${val === undefined ? '—' : f1(val) + ' t'}</td><td>${val === undefined ? '' : bad ? '✕' : '✓'}</td></tr>`;
  };
  return `<table class="compare">${row('Dispatch note', 'Vendor paper', t.paperNet)}${row('Load sensor', 'truck device', t.sensorNet)}${row('Zone gate pad', 'Governing Body', t.zoneNet)}${row('Exit gate pad', 'Governing Body', t.exitNet)}${row('Destination weighing', 'separate', t.destNet)}</table>`;
};
function evidence(app: App) {
  const g = app.sim.gov, x = app.selected ? app.sim.find(app.selected) : undefined;
  const device = app.subject || x?.device?.id || '';
  const reg = device ? g.registry.get(device) : undefined;
  const feed = (list: typeof g.evidence) => `<div class="feed">${list.slice(-34).reverse().map((e) => `<div class="${e.status}"><time>${hhmm(e.t)}</time><span><b>${esc(e.src)}${e.node ? ' · ' + esc(e.node) : ''}</b> ${esc(e.kind)}: ${esc(e.value)}</span></div>`).join('') || '<p class="quiet">No readings yet.</p>'}</div>`;
  if (reg) {
    const trips = g.history.filter((t) => t.device === device), t = trips.at(-1) ?? g.trips.get(device);
    return `<div class="row">${btn('clear', '', '← All trucks', 'link')}</div>
    <div class="card"><h4>${esc(reg.label)} <span>${esc(reg.plate)}</span></h4><table class="kv"><tr><td>Device</td><td>${device}</td></tr><tr><td>Registered length</td><td>${f1(reg.shape)} m</td></tr><tr><td>Registered empty weight</td><td>${f1(reg.tare)} t</td></tr>${t ? `<tr><td>Entered</td><td>${t.atStart ? 'before 09:00' : `${t.gate} at ${hhmm(t.tEntry)}`}</td></tr><tr><td>Status</td><td>${esc(t.status)}</td></tr>` : ''}</table></div>
    ${t && !t.atStart ? h('Do the weights agree?') + ROWS(t) : ''}
    ${h('Readings for this truck')}${feed(g.evidence.filter((e) => e.subject === device))}`;
  }
  if (x && !x.device || app.subject) {
    const list = g.evidence.filter((e) => e.subject.startsWith('Unknown'));
    return `<div class="row">${btn('clear', '', '← All trucks', 'link')}</div><div class="card bad"><h4>Unidentified vehicle</h4><p>No device answers for it. Only what sensors captured is listed.</p></div>${feed(list)}`;
  }
  const trips = g.history.filter((t) => !t.atStart).slice().reverse();
  return `${h('Trips this shift', 'click a truck')}
  ${trips.length ? `<table class="trips"><tr><th>Truck</th><th>In</th><th>Paper</th><th>Pad</th><th>Dest.</th></tr>${trips.map((t) => `<tr class="${t.flag}" data-act="trip" data-arg="${t.device}"><td>${esc(g.registry.get(t.device)?.label ?? t.device)}</td><td>${t.gate} ${hhmm(t.tEntry)}</td><td>${t.paperNet === undefined ? '—' : f1(t.paperNet)}</td><td>${t.exitNet === undefined ? '—' : f1(t.exitNet)}</td><td>${t.destNet === undefined ? '—' : f1(t.destNet)}</td></tr>`).join('')}</table>` : '<p class="quiet">No truck has entered through a gate yet.</p>'}
  ${h('Latest sensor readings')}${feed(g.evidence)}`;
}
export function answers(app: App) {
  const g = app.sim.gov;
  const piles = PILES.map((p) => { const s = g.piles.get(p.id); return s ? { id: p.id, change: s.base - s.last, out: g.recordedOut(p.id), gap: s.gap, band: s.band, t: s.t } : null; }).filter(Boolean) as { id: string; change: number; out: number; gap: number; band: number; t: number }[];
  const entered = g.history.filter((t) => !t.atStart).length, left = g.history.filter((t) => t.exitNet !== undefined).length;
  const refused = g.alerts.filter((a) => /turned away|prevented|refused|rejected/i.test(a.title) && !/override|reopening/i.test(a.title)).length;
  const unknown = g.alerts.filter((a) => a.subject.startsWith('Unknown'));
  const kinds = new Map<string, number>(); for (const a of g.alerts) kinds.set(a.title, (kinds.get(a.title) ?? 0) + 1);
  const p = g.permit();
  const missing = piles.filter((x) => x.gap > x.band);
  return [
    { q: 'How much did the stockpiles lose since the opening scan?', short: missing.length ? `${missing.map((x) => `about ${nice(x.gap)} t unaccounted at ${x.id}`).join(', ')}` : 'Every pile balances within the scan error', bad: missing.length > 0,
      body: `<table class="trips"><tr><th>Pile</th><th>Scan change</th><th>Recorded out</th><th>Unexplained</th></tr>${piles.map((x) => `<tr class="${x.gap > x.band ? 'bad' : ''}"><td>${x.id}</td><td>${nice(x.change)} t</td><td>${nice(x.out)} t</td><td>${nice(x.gap)} ± ${nice(x.band)} t</td></tr>`).join('')}</table><p class="quiet">Last scan ${piles[0] ? hhmm(piles[0].t) : '—'}. ${btn('scan', '', 'Scan now', 'link')}</p>` },
    { q: 'What went in and out, and was anything unregistered?', short: `${entered} in, ${left} out, ${refused} refused, ${unknown.length ? unknown.length + ' reports of unidentified vehicles' : 'no unidentified vehicle'}`, bad: unknown.length > 0,
      body: unknown.slice(-5).map((a) => `<p><time>${hhmm(a.t)}</time> ${esc(a.title)}</p>`).join('') },
    { q: 'How much did each truck carry?', short: `${f1(p.tonnes)} t measured out against ${f1(p.paper)} t on paper`, bad: Math.abs(p.tonnes - p.paper) > 3,
      body: `<table class="trips"><tr><th>Truck</th><th>Paper</th><th>Exit pad</th><th>Destination</th></tr>${g.history.filter((t) => t.exitNet !== undefined).map((t) => `<tr class="${t.flag}" data-act="trip" data-arg="${t.device}"><td>${esc(g.registry.get(t.device)?.label ?? t.device)}</td><td>${t.paperNet === undefined ? '—' : f1(t.paperNet)}</td><td>${f1(t.exitNet!)}</td><td>${t.destNet === undefined ? 'on road' : f1(t.destNet)}</td></tr>`).join('')}</table>` },
    { q: 'What incidents happened?', short: g.alerts.length ? `${g.alerts.length} alerts, ${g.alerts.filter((a) => a.sev === 'high').length} serious` : 'None', bad: g.alerts.some((a) => a.sev === 'high'),
      body: [...kinds].map(([k, n]) => `<p>${n} × ${esc(k)}</p>`).join('') },
    { q: 'How much of the permit is used, and when will it run out?', short: `${nice(p.tonnes)} of ${nice(g.cap.tonnes)} t, ${p.trips} of ${g.cap.trips} trips`, bad: p.tonnes >= 0.8 * g.cap.tonnes,
      body: `<p>${p.capAt === null ? 'No rate yet.' : p.capAt > g.cap.minutes ? 'At this rate the limit is not reached within the permitted shift.' : `At this rate the limit is reached about ${hhmm(p.capAt)}.`} ${p.vehicles} of ${g.cap.vehicles} vehicles used.</p>` },
    { q: 'Who should be looked at first?', short: g.ranking()[0]?.k ?? 'Nobody stands out', bad: g.ranking().length > 0,
      body: `<ol class="rank">${g.ranking().slice(0, 6).map((r) => `<li><b>${esc(r.k)}</b><span>${r.n}</span><small>${esc(r.why)}</small></li>`).join('')}</ol>` },
  ];
}
function questions(app: App) {
  return answers(app).map((a, i) => `<div class="qa ${a.bad ? 'bad' : ''}"><h4><span>${i + 1}</span>${a.q}</h4><div class="short">${esc(a.short)}</div>${a.body}</div>`).join('');
}
function logTab(app: App) {
  const L = app.sim.gov.log, v = app.checked;
  const list = L.entries.slice(-70).reverse();
  return `<div class="card"><h4>Tamper-evident log <span>${L.entries.length} entries</span></h4><p>Each entry carries the hash of the one before. Every tenth hash is also held by the Governing Body and the Vendor.</p>
    <div class="row">${btn('verify', '', 'Check the log', 'primary')}${btn('editlog', '', 'Quietly edit one entry', 'ghost')}${btn('rewrite', '', 'Edit and rewrite the chain', 'ghost')}${app.backup ? btn('restore', '', 'Undo the tampering', 'ghost') : ''}</div>
    ${v ? `<div class="verdict ${v.ok ? 'ok' : 'bad'}">${v.ok ? `✓ All ${v.count} entries check out against both parties' copies.` : v.broken !== null ? `✕ Broken at entry ${v.broken}: its content no longer matches its hash.` : `✕ The chain looks consistent, but it no longer matches the copy held by the ${v.anchor!.who} at entry ${v.anchor!.upTo}.`}</div>` : ''}
    <p class="quiet">Copies held: ${L.anchors.governingBody.length} by each party.</p></div>
    <div class="logs">${list.map((e) => `<div class="${v && !v.ok && (v.broken === e.i || v.anchor?.upTo === e.i) ? 'broken' : ''} r-${e.role.replace(/\W/g, '')}"><time>${hhmm(e.t)}</time><span><b>${e.role}</b> ${esc(e.text)}<code>#${e.i} ${e.hash.slice(0, 16)}</code></span></div>`).join('')}</div>`;
}
function vendor(app: App) {
  const sim = app.sim, targets = sim.targets();
  if (!targets.some((x) => x.uid === app.target)) app.target = targets.at(-1)?.uid ?? '';
  const A = (kind: string, label: string) => btn('attack', kind, label);
  return `<p class="quiet">Let a panel member pick. Every attack leaves a mismatch somewhere.</p>
  ${h('Send an honest truck')}<div class="row">${['G1', 'G2', 'G3'].map((g) => btn('send', g, `via ${g}`, 'primary')).join('')}</div>
  ${h('Pick the truck to tamper with')}<div class="chips">${targets.map((x) => btn('target', x.uid, `${x.name}<small>${sim.gov.trips.get(x.device!.id)?.status ?? 'approaching'}</small>`, x.uid === app.target ? 'on' : '')).join('') || '<span class="quiet">Send a truck first.</span>'}</div>
  ${h('On the truck')}<div class="grid">${A('jam', 'Jam the device')}${A('open', 'Open the device box')}${A('move', 'Move device to another truck')}${A('spoof', 'Fake the position')}${A('power', 'Cut truck power')}${A('understate', 'Device understates load')}</div>
  ${h('On the road')}<div class="grid">${A('road', 'Take a wrong road')}${A('roadload', 'Pick up ore on the road')}${A('wrongexit', 'Leave loaded by G2')}${A('noarrive', 'Never reach destination')}${A('repeat', 'Enter twice')}${A('skim', 'Shave 1.2 t off every note')}</div>
  ${h('Open boundary')}<div class="grid">${A('sneak', '<b>Sneak a truck in now</b>')}${A('dash', 'Quick run between counts')}${A('leaveopen', 'Leave through the boundary')}</div>
  ${h('Gates, towers, network')}<div class="grid">${A('fake', 'Copied device box')}${A('nozone', 'No entry record at zone')}${A('stuck', 'Leave gate G3 open')}${A('hand', 'Reopen G3 by hand')}${A('reopen', 'Request secure reopen')}${A('tower', sim.towersOff.has('TW3') ? 'Restore tower TW3' : 'Switch off tower TW3')}${A('net', sim.gov.offline.has('G1') ? 'Restore link to G1' : 'Cut network to G1')}${A('scan', 'Scan the stockpiles')}</div>
  ${h('Conditions')}<div class="row">${(['clear', 'dust', 'monsoon'] as const).map((w) => btn('weather', w, w === 'monsoon' ? 'Rain and low cloud' : w === 'dust' ? 'Heavy dust' : 'Clear', sim.weather === w ? 'on' : '')).join('')}</div>
  ${h('Settings')}<div class="row"><span>Weight tolerance</span>${[0.5, 1, 1.5, 2, 3].map((x) => btn('tol', String(x), `${x} t`, sim.gov.tol === x ? 'on' : '')).join('')}</div><div class="row"><span>Permit quantity</span>${[100, 250, 400].map((x) => btn('cap', String(x), `${x} t`, sim.gov.cap.tonnes === x ? 'on' : '')).join('')}</div>`;
}
export const PANELS = { control, evidence, questions, log: logTab, vendor };
export { NODES };
