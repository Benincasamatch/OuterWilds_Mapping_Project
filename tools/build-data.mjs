// Builds wallpaper/data/bodies.json + events.json from the archived sources.
// Single source of truth for: datamine CSV values, hand-measured periods, the
// sun-radius curve, the interloper joint solve (PLAN.md §3.9) and the
// 87-event -> implemented/dropped mapping (§3.5.1). Run: npm run build:data
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeEllipse, TWO_PI, DEG } from '../wallpaper/js/lib/kepler.js';
import { sunRadiusAt, SUN_CURVE } from '../wallpaper/js/lib/sun.js';
import { makeScale, K_BODY_CAP } from '../wallpaper/js/lib/scale.js';
import { findInboundCrossing } from '../wallpaper/js/lib/interloper.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSV = path.join(ROOT, 'data/sources/ow-game-data-community.csv');
const CLOCK = path.join(ROOT, 'data/sources/ow-clock-events.json');
const OUT_DIR = path.join(ROOT, 'wallpaper/data');
const REPORT = path.join(ROOT, 'data/fits-report.md');

const GENERATED_AT = '2026-09-17';
const MU_SUN = 4e8;          // m^3/s^2, community Kepler fit (Jesper2k)
const CYCLE_S = 1360;        // §0: full script incl. post-supernova tail
const SUPERNOVA_S = 1320;
const PRNG_SEED = 221026;

const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT: ' + msg); };
const f = (x, n = 3) => Number(x).toFixed(n);
const note = [];
const log = (s) => { note.push(s); console.log(s); };

// ---------------------------------------------------------------- CSV parsing
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csvRows = parseCsv(fs.readFileSync(CSV, 'utf8'));
const HEAD = csvRows[0].map((h) => h.trim());
const col = (name) => {
  const i = HEAD.findIndex((h) => h.startsWith(name));
  assert(i >= 0, `csv column not found: ${name}`);
  return i;
};
const C = {
  body: 0,
  radius: col('Radius (m)'),
  mass: col('Mass'),
  angular: col('Angular velocity'),
  day: col('Day length (relative to stars)'),
  parent: col('Parent body'),
  orbit: col('Orbital radius to parent body'),
  orbitRemarks: col('Orbit Remarks'),
  year: col('Year length (s)'),
  qm: col('Quantum Moon Orbital radii'),
  credits: col('Credits'),
};
const csv = new Map();
for (const r of csvRows.slice(1)) {
  if (!r.length || !r[C.body]) continue;
  csv.set(r[C.body].trim(), r);
}
const csvGet = (name) => { const r = csv.get(name); assert(r, `csv row missing: ${name}`); return r; };
const num = (s, fallback = NaN) => { const v = parseFloat(String(s ?? '').replace(/,/g, '')); return Number.isFinite(v) ? v : fallback; };

// Barycentre distance lives in the twins' orbit remarks with more precision than the table cell.
const twinRemark = csvGet('Ash Twin')[C.orbitRemarks];
const barycentreM = num(twinRemark.match(/([\d.]+)m/)[1]);
const mutualM = num(twinRemark.match(/each planet orbits at ([\d.]+)m/)[1]);
assert(Math.abs(barycentreM - 5000.001352656617) < 1e-6, 'twins barycentre parse');
assert(mutualM === 250, 'twins mutual distance parse');

// Contributors: the CSV credit line (row 1, first cell) lists one name that the
// per-row "Credits" column omits.
const creditLine = HEAD[C.body];
assert(creditLine.includes('Gorfinhofin'), 'Gorfinhofin missing from CSV credit line');

// ------------------------------------------------- hand-measured periods (M)
// u/AltorinianUniverse, r/outerwilds t3_dhx2if (re-verified 2026-09-17).
const M = {
  sun_station: 35, hourglass_barycenter: 110, twins_mutual: 55, timber_hearth: 250,
  skyshutter: 40, brittle_hollow: 397, hollows_lantern: 115,
  giants_deep: 650, opc: 50, dark_bramble: 900, interloper: 480,
};

// ------------------------------------------------------------- interloper fit
const rPeri = num(csvGet('The Interloper')[C.orbit].split('-')[0]);
const rApo = num(csvGet('The Interloper')[C.orbit].split('-')[1]);
assert(rPeri === 2500 && rApo === 24000, 'interloper apsis parse');
const A_INT = (rPeri + rApo) / 2;
const E_INT = (rApo - rPeri) / (rApo + rPeri);
const T_KEPLER = TWO_PI * Math.sqrt((A_INT ** 3) / MU_SUN);

const ellipseOf = (perihelionEpochS) =>
  makeEllipse({ a: A_INT, e: E_INT, periodS: T_KEPLER, perihelionEpochS, mu: MU_SUN });

/** Latest inbound crossing of r(t) == R_sun(t) before the perihelion at p3. */
function impactTimeFor(p3) {
  const el = ellipseOf(p3);
  const t0 = Math.max(0, p3 - 0.4 * T_KEPLER);
  return findInboundCrossing((t) => el.radiusAt(t), sunRadiusAt, t0, p3);
}

// Solve p3 so the impact lands on the OWClock timestamp (1185 s).
const IMPACT_AT = 1185;
let lo = IMPACT_AT, hi = IMPACT_AT + 60;
for (let i = 0; i < 80; i++) {
  const mid = (lo + hi) / 2;
  if (impactTimeFor(mid) < IMPACT_AT) lo = mid; else hi = mid;
}
const PERI3 = (lo + hi) / 2;
const PERI1 = PERI3 - 2 * T_KEPLER;
const PERI2 = PERI3 - T_KEPLER;
const impactT = impactTimeFor(PERI3);
assert(Math.abs(impactT - IMPACT_AT) < 0.05, `impact solve off by ${f(impactT - IMPACT_AT, 3)}s`);

// Ice-shell threshold model: opens when r(t) <= c0 + c1 * R_sun(t).
const OPEN_OBS = [220, 695, 1175];
const CLOSE_AFTER = 40; // OWClock: 220->260 and 695->735
const rAt = (t) => ellipseOf(PERI3).radiusAt(t);
const xs = OPEN_OBS.map((t) => sunRadiusAt(t));
const ys = OPEN_OBS.map(rAt);
const nPt = xs.length;
const sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0);
const sxx = xs.reduce((a, b) => a + b * b, 0), sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
const c1 = (nPt * sxy - sx * sy) / (nPt * sxx - sx * sx);
const c0 = (sy - c1 * sx) / nPt;
const rOpenAt = (t) => c0 + c1 * sunRadiusAt(t);

/** Time at which the inbound leg crosses the threshold, per pass window. */
function predictedOpen(centre) {
  return findInboundCrossing(rAt, rOpenAt, centre - T_KEPLER / 2, centre);
}
const iceResiduals = [
  { pass: 1, observedS: OPEN_OBS[0], predictedS: predictedOpen(PERI1) },
  { pass: 2, observedS: OPEN_OBS[1], predictedS: predictedOpen(PERI2) },
  { pass: 3, observedS: OPEN_OBS[2], predictedS: predictedOpen(PERI3) },
].map((r) => ({ ...r, residualS: +(r.predictedS - r.observedS).toFixed(2) }));
const maxIceResidual = Math.max(...iceResiduals.map((r) => Math.abs(r.residualS)));

log(`interloper: a=${f(A_INT, 1)} e=${f(E_INT, 4)} T=${f(T_KEPLER, 2)}s (hand-measured ${M.interloper}s, Δ${f((T_KEPLER - M.interloper) / M.interloper * 100, 2)}%)`);
log(`interloper perihelion epochs: ${PERI1.toFixed(1)} / ${PERI2.toFixed(1)} / ${PERI3.toFixed(1)} s; impact at ${impactT.toFixed(2)}s (R_sun=${f(sunRadiusAt(impactT), 1)} m)`);
log(`ice threshold: r_open(t) = ${f(c0, 1)} + ${f(c1, 4)}·R_sun(t)  ⇒ max residual ${f(maxIceResidual, 2)}s (target ≤2, tolerance B ≤5)`);
assert(maxIceResidual <= 5, 'ice-shell residual exceeds tolerance B');

// ------------------------------------------------------------------ sun curve
const anchors = [[0, 2001.75], [690, 2315], [1320, 4000]];
for (const [t, r] of anchors) assert(Math.abs(sunRadiusAt(t) - r) < 1e-6, `sun anchor ${t}s`);
const sunChecks = [226.6, 706, 812.6, 1185].map((t) => ({ t, r: sunRadiusAt(t) }));
assert(sunRadiusAt(PERI1) < rPeri && sunRadiusAt(PERI2) < rPeri, 'sun radius reaches interloper perihelion too early');
assert(sunRadiusAt(1185) > rPeri, 'sun must have swallowed the perihelion by the impact time');
log(`sun radius: R(226.6)=${f(sunRadiusAt(226.6), 1)} R(706)=${f(sunRadiusAt(706), 1)} R(812.6)=${f(sunRadiusAt(812.6), 1)} R(1185)=${f(sunRadiusAt(1185), 1)} m`);

// ------------------------------------------------------------- bodies assembly
const D = 'datamine', HM = 'measured', X = 'derived', DESIGN = 'design', INF = 'inferred';
const B = [];
const push = (b) => { B.push(b); return b; };

push({ id: 'sun', name: '太阳', nameEn: 'Sun', internal: 'SUN', primary: null, frame: 'root',
  radiusM: 2001.75, radiusSource: D, massKg: 4e11, massSource: D,
  orbit: null, rotation: { periodS: null, note: 'datamine remark: "Inconclusive"; design decision: no spin', source: DESIGN },
  texture: { key: 'sun', procedural: 'shader', palette: ['#fff6d8', '#ffb347', '#ff5e2b'], variants: ['default'] } });

push({ id: 'hourglass_barycentre', name: '沙漏双星质心', nameEn: 'Hourglass Twins barycentre', internal: null,
  primary: 'sun', frame: 'heliocentric', virtual: true,
  radiusM: 0, radiusSource: DESIGN, massKg: null,
  orbit: { kind: 'circle', distanceM: barycentreM, periodS: num(csvGet('Ash Twin')[C.year]), phaseDeg: 0, distanceSource: D, periodSource: D, phaseSource: DESIGN },
  rotation: { periodS: null, source: DESIGN }, texture: null });

for (const [name, id, internal, phase] of [['Ash Twin', 'ash_twin', 'TOWER_TWIN', 180], ['Ember Twin', 'ember_twin', 'CAVE_TWIN', 0]]) {
  const row = csvGet(name);
  push({ id, name: name === 'Ash Twin' ? '灰烬双星' : '余烬双星', nameEn: name, internal, primary: 'hourglass_barycentre', frame: 'local',
    radiusM: num(row[C.radius]), radiusSource: D, massKg: num(row[C.mass]), massSource: D,
    orbit: { kind: 'circle', distanceM: mutualM, periodS: M.twins_mutual, phaseDeg: phase, distanceSource: D, periodSource: HM, phaseSource: DESIGN },
    rotation: { periodS: num(row[C.day]), angularVelocityRaw: row[C.angular].trim(), source: D },
    texture: { key: id, palette: name === 'Ash Twin' ? ['#c8a274', '#8d6e46', '#4a3524'] : ['#d8a15c', '#9a6a35', '#3d2a18'],
      variants: ['full', 'empty'], variantSource: ['datamine', DESIGN] } });
}

const helio = [
  ['Timber Hearth', 'timber_hearth', '木炉星', 'TIMBER_HEARTH', 132],
  ['Brittle Hollow', 'brittle_hollow', '脆空', 'BRITTLE_HOLLOW', 245],
  ["Giant’s Deep (Jool)", 'giants_deep', '深巨星', 'GIANTS_DEEP', 300],
  ['Dark Bramble', 'dark_bramble', '黑棘', 'DARK_BRAMBLE', 65],
];
for (const [csvName, id, cn, internal, phase] of helio) {
  const row = csvGet(csvName);
  const isGD = id === 'giants_deep';
  push({ id, name: cn, nameEn: csvName.replace(' (Jool)', ''), internal, primary: 'sun', frame: 'heliocentric',
    radiusM: num(row[C.radius]), radiusSource: D,
    atmosphereM: isGD ? 959 : 0, atmosphereSource: isGD ? D : undefined,
    massKg: num(row[C.mass]), massSource: D,
    orbit: { kind: 'circle', distanceM: num(row[C.orbit]), periodS: num(row[C.year], M[id]), phaseDeg: phase,
      distanceSource: D, periodSource: Number.isFinite(num(row[C.year])) ? D : HM, phaseSource: DESIGN },
    rotation: { periodS: num(row[C.day]), angularVelocityRaw: (row[C.angular] ?? '').trim(), source: D },
    texture: { key: id, palette: { timber_hearth: ['#3f7d3a', '#2a5a2b', '#8b6b3f'], brittle_hollow: ['#5b6b7d', '#3c4757', '#d8d8e0'], giants_deep: ['#2b5f8f', '#1d4266', '#0f2b45'], dark_bramble: ['#2b2334', '#1a1622', '#4a3a52'] }[id],
      variants: id === 'brittle_hollow' ? ['intact', 'holed'] : ['default'] } });
}

// Interloper
push({ id: 'interloper', name: '闯入者', nameEn: 'The Interloper', internal: 'COMET', primary: 'sun', frame: 'heliocentric',
  radiusM: num(csvGet('The Interloper')[C.radius]), radiusSource: D, massKg: num(csvGet('The Interloper')[C.mass]), massSource: D,
  orbit: { kind: 'ellipse', aM: A_INT, eM: E_INT, periodS: T_KEPLER, perihelionEpochS: PERI3,
    perihelionM: rPeri, aphelionM: rApo, aSource: X, eSource: X, periodSource: X, phaseSource: X,
    note: 'perihelion epoch solved so the sun impact lands on OWClock 1185s (PLAN.md §3.9)' },
  rotation: { periodS: null, tidalLock: true, source: D },
  texture: { key: 'interloper', palette: ['#cfe8f5', '#8fb8cc', '#5d7f92'], variants: ['closed', 'open'] } });

// Sun Station
push({ id: 'sun_station', name: '太阳站', nameEn: 'Sun Station', internal: 'SUN_STATION', primary: 'sun', frame: 'heliocentric',
  radiusM: 60, radiusSource: DESIGN, massKg: num(csvGet('(Sun Station)')[C.mass], 3e5), massSource: D,
  orbit: { kind: 'circle', distanceM: 2315, periodS: M.sun_station, phaseDeg: 210, distanceSource: X, periodSource: HM, phaseSource: DESIGN },
  rotation: { periodS: M.sun_station, tidalLock: true, source: HM },
  texture: { key: 'sun_station', palette: ['#d8c9a8', '#8f8064', '#4a4234'], variants: ['intact', 'engulfed'] } });

// White hole + station (PLAN.md §3.6: parent is the white hole, co-orbital with Brittle Hollow)
push({ id: 'white_hole', name: '白洞', nameEn: 'White Hole', internal: 'WHITE_HOLE', primary: 'sun', frame: 'heliocentric',
  radiusM: 25, radiusSource: DESIGN, massKg: null,
  orbit: { kind: 'circle', distanceM: num(csvGet('Brittle Hollow')[C.orbit]), periodS: num(csvGet('Brittle Hollow')[C.year]), phaseDeg: 5, distanceSource: DESIGN, periodSource: DESIGN, phaseSource: DESIGN },
  rotation: { periodS: null, source: DESIGN },
  texture: { key: 'white_hole', palette: ['#f2f6ff', '#a9c4ff', '#3b4a7a'], variants: ['default'] } });

push({ id: 'white_hole_station', name: '白洞站', nameEn: 'White Hole Station', internal: 'WHITE_HOLE_STATION', primary: 'white_hole', frame: 'local',
  radiusM: 90, radiusSource: DESIGN, massKg: null,
  orbit: { kind: 'circle', distanceM: 300, periodS: 120, phaseDeg: 0, distanceSource: DESIGN, periodSource: DESIGN, phaseSource: DESIGN },
  rotation: { periodS: 120, tidalLock: true, source: DESIGN },
  texture: { key: 'white_hole_station', palette: ['#b9c7d6', '#6f7f92', '#39424e'], variants: ['default'] } });

// Stranger — linear drift, no orbital data exists (PLAN.md §3.10)
push({ id: 'stranger', name: '陌生者', nameEn: 'The Stranger', internal: 'CLOAKED_PLANET', primary: 'sun', frame: 'heliocentric',
  radiusM: 600, radiusSource: DESIGN, massKg: null,
  orbit: { kind: 'drift', distanceStartM: 22000, distanceEndM: 30000, phaseDeg: 190, speedUpAtS: 400, speedUpFactor: 1.3,
    distanceSource: DESIGN, periodSource: DESIGN, phaseSource: DESIGN },
  rotation: { periodS: 220, source: DESIGN },
  texture: { key: 'stranger', palette: ['#1b2430', '#101720', '#39485c'], variants: ['cloaked', 'sails'] } });

// Eye — fixed distance (datamine range is a triangulation error band)
push({ id: 'eye', name: '宇宙之眼', nameEn: 'Eye of the Universe', internal: 'EYE_OF_THE_UNIVERSE', primary: 'sun', frame: 'heliocentric',
  radiusM: 201, radiusSource: D, massKg: 9e6, massSource: D,
  orbit: { kind: 'circle', distanceM: 500000, periodS: Infinity, phaseDeg: 0, distanceSource: DESIGN,
    note: 'datamine 410000-657000 is a triangulation band; fixed value is a design decision (PLAN.md §3.10)' },
  rotation: { periodS: null, source: D },
  texture: { key: 'eye', palette: ['#1a2b3a', '#0d1620', '#6fb0d8'], variants: ['default'] } });

// Moons / satellites (measured periods, designed radii & distances)
const moons = [
  ['attlerock', '阿特勒岩', 'Attlerock', 'TIMBER_MOON', 'timber_hearth', num(csvGet('Attlerock')[C.orbit]), num(csvGet('Attlerock')[C.year]), 0, true],
  ['skyshutter', '天空快门卫星', 'SkyShutter Satellite', 'MAP_SATELLITE', 'timber_hearth', 500, M.skyshutter, 40, false],
  ['hollows_lantern', '空心灯', "Hollow's Lantern", 'VOLCANIC_MOON', 'brittle_hollow', 1000, M.hollows_lantern, 0, false],
  ['opc', '轨道探测炮', 'Orbital Probe Cannon', 'PROBE_CANNON', 'giants_deep', 1100, M.opc, 0, false],
];
for (const [id, cn, en, internal, primary, dist, period, phase, tidal] of moons) {
  const rowSource = internal === 'TIMBER_MOON' ? D : internal === 'VOLCANIC_MOON' ? D : DESIGN;
  push({ id, name: cn, nameEn: en, internal, primary, frame: 'local',
    radiusM: { attlerock: 80, hollows_lantern: 97.3 }[id] ?? { skyshutter: 20, opc: 250 }[id],
    radiusSource: rowSource, massKg: { attlerock: 5e7, hollows_lantern: 9.1e5 }[id] ?? null, massSource: rowSource,
    orbit: { kind: 'circle', distanceM: dist, periodS: period, phaseDeg: phase,
      distanceSource: rowSource, periodSource: internal === 'TIMBER_MOON' ? D : HM, phaseSource: id === 'skyshutter' ? INF : DESIGN },
    rotation: { periodS: tidal ? period : (id === 'hollows_lantern' ? num(csvGet('Hollow’s Lantern')[C.day]) : null),
      tidalLock: !!tidal, source: rowSource },
    texture: { key: id, palette: { attlerock: ['#8d8d8d', '#5c5c5c', '#2e2e2e'], skyshutter: ['#cfd6dd', '#8d959d', '#4a5058'],
      hollows_lantern: ['#ff9b4a', '#8a3a10', '#2a1008'], opc: ['#c9c3b2', '#8a8474', '#3d3a33'] }[id],
      variants: id === 'opc' ? ['intact', 'broken'] : ['default'] } });
}

// Nomai probe (launched at t=1s by the OPC)
push({ id: 'nomai_probe', name: '挪麦探测器', nameEn: 'Nomai Probe', internal: 'NOMAI_PROBE', primary: 'opc', frame: 'local',
  radiusM: 15, radiusSource: DESIGN, massKg: null,
  orbit: { kind: 'drift', distanceStartM: 1100, speedMps: 25, launchAtS: 1, distanceSource: DESIGN, phaseSource: DESIGN },
  rotation: { periodS: null, source: DESIGN },
  texture: { key: 'nomai_probe', palette: ['#ffe9b0', '#c2a15c', '#4d4028'], variants: ['default'] } });

// Quantum Moon (host switching, PLAN.md §3.10)
const qmHosts = [
  { id: 'ember_twin', distanceM: num(String(csvGet('Ember Twin')[C.qm]).match(/[\d.]+/)?.[0]), source: D },
  { id: 'timber_hearth', distanceM: num(String(csvGet('Timber Hearth')[C.qm]).match(/[\d.]+/)?.[0]), source: D },
  { id: 'brittle_hollow', distanceM: num(String(csvGet('Brittle Hollow')[C.qm]).match(/[\d.]+/)?.[0]), source: D },
  { id: 'giants_deep', distanceM: num(String(csvGet("Giant’s Deep (Jool)")[C.qm]).match(/[\d.]+/)?.[0]), source: D },
  { id: 'dark_bramble', distanceM: num(String(csvGet('Dark Bramble')[C.qm]).match(/[\d.]+/)?.[0]), source: D },
  { id: 'eye', distanceM: num(String(csvGet('The Eye of the Universe')[C.qm]).match(/[\d.]+/)?.[0]), source: D, reachable: false },
];
assert(qmHosts.map((h) => h.distanceM).join(',') === '1700,1100,1400,1500,1500,6000', 'quantum moon host radii parse');
push({ id: 'quantum_moon', name: '量子月', nameEn: 'Quantum Moon', internal: 'QUANTUM_MOON', primary: 'giants_deep', frame: 'local',
  radiusM: 73, radiusSource: D, massKg: 5.5e5, massSource: D,
  orbit: { kind: 'host-switch', hostStart: 'giants_deep', hosts: qmHosts, phaseDeg: 90,
    dwellS: 30, distanceSource: D, periodSource: D, phaseSource: DESIGN,
    rule: 'jump when not inside the camera frustum and dwellS elapsed; seeded walk; never to the Eye host (PLAN.md §3.10)' },
  rotation: { periodS: null, source: D },
  texture: { key: 'quantum_moon', palette: ['#8a93a8', '#5e6678', '#2b3040'], variants: ['default'] } });

// --------------------------------------------------------------- clearance
const scale = makeScale();
const byId = new Map(B.map((b) => [b.id, b]));
const clearance = [];
for (const b of B) {
  if (!b.primary || b.virtual || b.orbit?.kind !== 'circle' || b.frame !== 'local') continue;
  const p = byId.get(b.primary);
  const d = scale.local(b.orbit.distanceM);
  // atmosphereM is the ALTITUDE of the top of the atmosphere (CSV: "atmosphere is 959m"
  // measured from sea level), so the outer radius is max(radius, atmosphere), not a sum.
  const pOuter = Math.max(p.radiusM, p.atmosphereM ?? 0);
  const gap = d - scale.body(b.radiusM) - scale.body(pOuter);
  clearance.push({ pair: `${b.id} ↔ ${p.id}`, visualDistance: d, gap, ok: gap > 0 });
}
// Sun vs Sun Station uses the shared heliocentric map: the station's orbit distance
// and the sun's radius are pushed through the SAME monotone map, so the 690 s beat
// emerges from geometry (PLAN.md §3.7).
const ssOrbitVis = scale.orbit(2315);
const ssRadiusVis = scale.body(60);
clearance.push({
  pair: 'sun ↔ sun_station (t=0, mapped)',
  visualDistance: ssOrbitVis,
  gap: ssOrbitVis - ssRadiusVis - scale.orbit(2001.75),
  ok: ssOrbitVis - ssRadiusVis > scale.orbit(2001.75),
});
// Inverse-map the moment the sun's surface first touches the station's near edge,
// and the moment it reaches the station's centre (= R_sun_real 2315 m = OWClock 690 s).
const sunRealForVisual = (vis) => 2001.75 * Math.pow(vis / 4000, 1 / 0.45);
const sunTimeForReal = (r) => 690 * Math.pow((r - 2001.75) / 313.25, 1 / 1.15);
const engulfContactS = sunTimeForReal(sunRealForVisual(ssOrbitVis - ssRadiusVis));
const engulfCentreS = sunTimeForReal(2315);
for (const c of clearance) assert(c.ok, `clearance violation: ${c.pair}`);
log(`clearances (visual units): ${clearance.map((c) => `${c.pair}=${f(c.gap, 1)}`).join(' · ')}`);
assert(scale.kBody <= K_BODY_CAP, 'kBody exceeds cap');

// ------------------------------------------------------------------ events
const clock = JSON.parse(fs.readFileSync(CLOCK, 'utf8')).eventList;
assert(clock.length === 87, 'OWClock event count changed');

const IMPLEMENTED = [
  { atS: 0, name: 'Loop Begins', id: 'loop_begins', label: '循环开始', visual: '全部天体复位到初值；探测炮完整、炮口朝种子方向', tolerance: 'A', source: 'OWClock' },
  { atS: 1, name: null, id: 'probe_launch', label: '探测炮解体并发射探测器', visual: '炮体切 broken 变体；探测器沿抛物轨离场', tolerance: 'C', source: INF },
  { atS: 120, name: 'Sand Begins Flowing', id: 'sand_start', label: '沙漏开始沙流', visual: '灰烬双星 → 余烬双星沙流粒子带；双星贴图开始渐变', tolerance: 'A', source: 'OWClock' },
  { atS: 200, name: 'Satellite Reaches 40°', id: 'satellite_40', label: '天空快门卫星到达 40°', visual: '相位锚点（200 = 5×40s）', tolerance: 'B', source: 'OWClock' },
  { atS: 220, name: 'Interloper Opens', id: 'interloper_open_1', label: '闯入者冰壳展开（第 1 次）', visual: '冰壳变体 open + 逸气粒子', tolerance: 'B', source: 'OWClock' },
  { atS: 260, name: 'Interloper Closes', id: 'interloper_close_1', label: '闯入者冰壳收拢（第 1 次）', visual: '冰壳变体 closed', tolerance: 'B', source: 'OWClock' },
  { atS: 400, name: "Stranger's Sails Deploy", id: 'stranger_sails', label: '陌生者张帆', visual: '几何 + 亮度变化（cloaked → sails）', tolerance: 'B', source: 'OWClock' },
  { atS: 690, name: 'Sun Station Destroyed', id: 'sun_station_destroyed', label: '太阳站被膨胀的太阳吞没', visual: '太阳视半径越过太阳站视轨道半径（几何自然发生）', tolerance: 'B', source: 'OWClock' },
  { atS: 695, name: 'Interloper Opens', id: 'interloper_open_2', label: '闯入者冰壳展开（第 2 次）', visual: '同第 1 次', tolerance: 'B', source: 'OWClock' },
  { atS: 735, name: 'Interloper Closes', id: 'interloper_close_2', label: '闯入者冰壳收拢（第 2 次）', visual: '同第 1 次', tolerance: 'B', source: 'OWClock' },
  { atS: 780, name: 'Dam Bursts', id: 'dam_bursts', label: '深巨星水坝崩塌', visual: '深巨星上一道细小高光（低优先，可弃）', tolerance: 'C', source: 'OWClock' },
  { atS: 1085, name: 'Quantum Tower Exits White Hole', id: 'quantum_tower', label: '量子塔从白洞出现', visual: '白洞旁新增塔体几何', tolerance: 'B', source: 'OWClock' },
  { atS: 1175, name: 'Interloper Opens', id: 'interloper_open_3', label: '闯入者冰壳展开（第 3 次）', visual: '冰壳 open，随后坠日', tolerance: 'B', source: 'OWClock' },
  { atS: 1185, name: 'Interloper Collides with Sun', id: 'interloper_impact', label: '闯入者坠日', visual: '闯入者淡出 + 太阳局部闪光', tolerance: 'B', source: 'OWClock' },
  { atS: 1220, name: 'Hourglass Sand Stops Flowing', id: 'sand_stop', label: '沙流停止', visual: '沙流粒子停；双星切 empty 变体', tolerance: 'A', source: 'OWClock' },
  { atS: 1230, name: 'Cinder Isles Tower Completely Falls', id: 'cinder_tower', label: '深巨星高塔坍落', visual: '深巨星上细小几何变化（低优先，可弃）', tolerance: 'C', source: 'OWClock' },
  { atS: 1235, name: 'Beginning of the End', id: 'endgame', label: '终局开始', visual: '太阳转红、膨胀加速的视觉开端', tolerance: 'A', source: 'OWClock' },
  { atS: 1320, name: 'Supernova', id: 'supernova', label: '超新星', visual: '红日坍缩 → 转蓝 → 爆炸白闪', tolerance: 'A', source: 'OWClock' },
  { atS: 1330, name: 'ATP Black Hole Opens', id: 'atp_black_hole', label: '灰烬双星黑洞开启', visual: '灰烬双星旁出现黑洞点', tolerance: 'A', source: 'OWClock' },
  { atS: 1360, name: 'Loop Ends', id: 'loop_ends', label: '循环结束', visual: '复位到初值（白闪遮盖接缝）', tolerance: 'A', source: 'OWClock' },
];

const implementedKeys = new Set(IMPLEMENTED.filter((e) => e.name).map((e) => `${e.atS}|${e.name}`));
const SURFACE = new Set(['HEL is Accessible', 'HEL Becomes Inccessible', 'Stepping Stone District is Buried',
  'River Lowlands is Flooded', 'Cinder Isles is Flooded', 'Hidden Gorge Walkways Are Destroyed',
  'E.Twin G.Canon Controls Are Buried', 'Anglerfish Overlook is Inaccessible', 'Temple of the Eye is Buried',
  'Escape Pod #2 is Buried', 'Sunless City is Fully Buried']);
const dropped = clock
  .filter((e) => !implementedKeys.has(`${e.Timestamp}|${e.Name}`))
  .map((e) => {
    let reason;
    if (e.Name.startsWith('Warp:')) reason = 'transfer tower inside a planet — invisible from orbit';
    else if (e.Name.startsWith('Tower Opens:')) reason = 'tower interior state — invisible from orbit';
    else if (e.Name.startsWith('Chert')) reason = 'NPC (character) — not rendered';
    else if (SURFACE.has(e.Name)) reason = 'planet surface detail — not discernible from orbit';
    else reason = null;
    assert(reason, `unclassified OWClock event: ${e.Timestamp} ${e.Name}`);
    return { atS: e.Timestamp, name: e.Name, type: e.type, reason };
  });
assert(implementedKeys.size + dropped.length === clock.length, 'event mapping must cover all 87 entries');

const decorative = [
  { id: 'lantern_meteors', label: "Hollow's Lantern 流星", source: DESIGN,
    schedule: { firstAtS: 45, ratePerMinFromS: [{ fromS: 45, toS: 1160, rate: 1 }, { fromS: 1160, toS: 1320, rate: 3 }] },
    craterLevelCap: 5, visual: '发光轨迹 + 撞击闪光；每次撞击使脆空破洞等级 +1（上限 5）' },
  { id: 'gd_lightning', label: '深巨星红色闪电', source: DESIGN, ratePerMin: 8, visual: '云层短线闪光' },
  { id: 'qm_jumps', label: '量子月跃迁', source: DESIGN, dwellS: 30, visual: '淡出/淡入，宿主切换' },
  { id: 'star_death', label: '背景星熄灭', source: DESIGN, fromS: 1160, toS: 1320, visual: '星点按哈希顺序逐个熄灭' },
];

const events = {
  meta: {
    schema: 1, generatedAt: GENERATED_AT,
    cycleS: CYCLE_S, supernovaAtS: SUPERNOVA_S,
    prng: { seed: PRNG_SEED, algorithm: 'mulberry32' },
    tolerances: { A: '±1s', B: '±5s (target ≤2s)', C: 'frequency/total ±25%', D: 'visual/scale, best effort' },
    sources: {
      datamine: 'data/sources/ow-game-data-community.csv (sha256 c631a2e0…)',
      clock: 'data/sources/ow-clock-events.json (sha256 7482a16a…)',
      handMeasured: 'u/AltorinianUniverse — r/outerwilds t3_dhx2if (via pullpush archive)',
    },
  },
  sunRadius: { anchors: anchors.map(([t, r]) => ({ tS: t, radiusM: r })), segments: SUN_CURVE, holdAfterM: 4000,
    note: 'engulfing the Sun Station at 690s requires the accelerating curve; a straight line would hit 2315m at t=207s' },
  sunStation: { orbitVisual: +ssOrbitVis.toFixed(2), stationRadiusVisual: +ssRadiusVis.toFixed(2),
    contactAtS: +engulfContactS.toFixed(1), centreAtS: +engulfCentreS.toFixed(1),
    note: 'the sun\'s surface first touches the station near edge at contactAtS and reaches the station centre (= R_sun 2315 m = OWClock 690 s) at centreAtS; both are emergent from the shared map' },
  interloper: {
    aM: A_INT, eM: E_INT, muSun: MU_SUN, periodS: T_KEPLER, perihelionM: rPeri, aphelionM: rApo,
    perihelionEpochsS: [PERI1, PERI2, PERI3], impactAtS: IMPACT_AT, impactSunRadiusM: sunRadiusAt(IMPACT_AT),
    handMeasuredPeriodS: M.interloper,
    ice: { model: 'r(t) <= c0 + c1 * R_sun(t)', c0, c1, closeAfterS: CLOSE_AFTER, residuals: iceResiduals, maxResidualS: +maxIceResidual.toFixed(2) },
  },
  events: IMPLEMENTED.map((e) => ({ ...e, tolerance: e.tolerance })),
  decorative,
  dropped,
  quantumMoon: { hosts: qmHosts, dwellS: 30, rule: 'not in frustum + dwell elapsed; seeded; Eye host unreachable in normal mode' },
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const bodiesOut = {
  meta: { schema: 1, generatedAt: GENERATED_AT, cycleS: CYCLE_S, muSun: MU_SUN,
    sources: events.meta.sources, credits: ['Lilac Peregrine', 'Mister Nebula', 'Gorfinhofin', 'Thomas', 'Brungo', 'Brady'],
    labels: { datamine: D, measured: HM, derived: X, design: DESIGN, inferred: INF } },
  sun: { id: 'sun', radiusM: 2001.75, radiusSource: D },
  bodies: B, quantumHosts: qmHosts, clearance,
};
fs.writeFileSync(path.join(OUT_DIR, 'bodies.json'), JSON.stringify(bodiesOut, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'events.json'), JSON.stringify(events, null, 2) + '\n', 'utf8');
// ES modules consumed by the wallpaper runtime (the JSON stays the canonical
// artifact for tooling/tests; the .js twin exists so the bundle needs no fetch).
fs.writeFileSync(path.join(OUT_DIR, 'bodies.js'),
  `// GENERATED by tools/build-data.mjs — do not edit.\nconst bodies = ${JSON.stringify(bodiesOut)};\nexport default bodies;\n`, 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'events.js'),
  `// GENERATED by tools/build-data.mjs — do not edit.\nconst events = ${JSON.stringify(events)};\nexport default events;\n`, 'utf8');

fs.writeFileSync(REPORT, [
  '# 拟合与校验报告',
  '',
  `生成：${GENERATED_AT}（\`npm run build:data\`）`,
  '',
  '## 闯入者联立解（PLAN.md §3.9）',
  '',
  `- 由 datamine 近日点 ${rPeri} m / 远日点 ${rApo} m ⇒ a=${f(A_INT, 1)} m, e=${f(E_INT, 4)}`,
  `- μ_sun = ${MU_SUN} ⇒ T = **${f(T_KEPLER, 2)} s**（手测 ${M.interloper} s，差 ${f((T_KEPLER - M.interloper) / M.interloper * 100, 2)}%）`,
  `- 三次近日点：${f(PERI1, 1)} / ${f(PERI2, 1)} / ${f(PERI3, 1)} s`,
  `- 撞日：${f(impactT, 2)} s（目标 1185 s），此刻 R_sun = ${f(sunRadiusAt(impactT), 1)} m`,
  `- 冰壳阈值：r_open(t) = ${f(c0, 1)} + ${f(c1, 4)}·R_sun(t)，闭壳 = 开壳 + ${CLOSE_AFTER} s`,
  `- **残差**（目标 ≤2 s，容差 B ≤5 s）：${iceResiduals.map((r) => `第${r.pass}次 ${f(r.residualS, 2)} s`).join(' · ')}`,
  '',
  '## 太阳半径曲线（PLAN.md §3.8）',
  '',
  `- 锚点：R(0)=2001.75 / R(690)=2315 / R(1320)=4000`,
  `- 校验：R(226.6)=${f(sunRadiusAt(226.6), 1)} / R(706)=${f(sunRadiusAt(706), 1)} / R(812.6)=${f(sunRadiusAt(812.6), 1)} / R(1185)=${f(sunRadiusAt(1185), 1)} m`,
  `- 约束：R(t) < 2500 m 覆盖前两次近日点（${f(sunRadiusAt(PERI1), 1)}、${f(sunRadiusAt(PERI2), 1)}）✅`,
  '',
  '## 尺度间隙（PLAN.md §3.7）',
  '',
  '| 组合 | 视距 | 间隙 |', '|---|---|---|',
  ...clearance.map((c) => `| ${c.pair} | ${f(c.visualDistance, 1)} | ${f(c.gap, 1)} |`),
  '',
  `k_body 上限 ${f(K_BODY_CAP, 3)}（默认 1.4）`,
  '',
  '## 事件映射',
  '',
  `- OWClock 共 ${clock.length} 条：实现 ${implementedKeys.size} 条，弃置 ${dropped.length} 条（逐条理由见 events.json \`dropped[]\`）`,
  `- 装饰性事件 ${decorative.length} 项（种子 ${PRNG_SEED}，由 t 驱动）`,
].join('\n') + '\n', 'utf8');

log(`wrote wallpaper/data/bodies.json (${B.length} bodies incl. ${B.filter((b) => b.virtual).length} virtual), wallpaper/data/events.json (${implementedKeys.size} implemented / ${dropped.length} dropped), data/fits-report.md`);
