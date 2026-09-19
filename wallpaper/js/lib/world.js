// World sampler — PLAN.md §4.5. Pure logic: no DOM, no GL.
// `sample(t, observer)` fills ONE reused frame object (zero allocation per frame).
import { makeEllipse, TWO_PI, DEG } from './kepler.js';
import { sunRadiusAt } from './sun.js';
import { makeScale } from './scale.js';
import { createEvents, clamp, smoothstep, hash01, mulberry32 } from './events.js';
import { iceOpenTimes } from './interloper.js';

// Orbit-line colours (PLAN.md §5 Phase 5: the game's map view tints each body).
const ORBIT_COLORS = {
  sun_station: [1.0, 0.82, 0.5], interloper: [0.75, 0.91, 1.0], stranger: [0.5, 0.56, 0.69],
  hourglass_barycentre: [0.85, 0.63, 0.36], timber_hearth: [0.48, 0.75, 0.42],
  brittle_hollow: [0.56, 0.71, 0.85], giants_deep: [0.29, 0.62, 0.85],
  dark_bramble: [0.6, 0.5, 0.75], eye: [0.56, 0.5, 0.82], white_hole: [0.87, 0.91, 1.0],
  attlerock: [0.7, 0.7, 0.7], skyshutter: [0.8, 0.85, 0.9], hollows_lantern: [1.0, 0.6, 0.29],
  opc: [0.79, 0.77, 0.7], quantum_moon: [0.6, 0.65, 0.75], white_hole_station: [0.72, 0.78, 0.84],
};
const DEFAULT_COLOR = [0.6, 0.6, 0.6];
const ELLIPSE_SEGMENTS = 256;
const MAX_PARTICLES = 160;

export function createWorld({ bodies: bodiesDoc, events: eventsDoc, options = {} }) {
  const scale = makeScale(options.scale || {});
  const ev = createEvents(eventsDoc);
  const cycleS = ev.cycleS ?? 1360;
  const defs = bodiesDoc.bodies;
  const byId = new Map(defs.map((d) => [d.id, d]));

  // --- interloper: ellipse + fitted ice-shell threshold (PLAN.md §3.9) ---
  const intDef = byId.get('interloper');
  const fit = eventsDoc?.interloper;
  let interloper = null;
  if (intDef?.orbit?.kind === 'ellipse' && fit) {
    const ellipse = makeEllipse({
      a: intDef.orbit.aM, e: intDef.orbit.eM, periodS: intDef.orbit.periodS,
      perihelionEpochS: intDef.orbit.perihelionEpochS,
    });
    const openTimes = iceOpenTimes({
      radiusAt: (t) => ellipse.radiusAt(t), periodS: intDef.orbit.periodS,
      perihelionEpochsS: fit.perihelionEpochsS, c0: fit.ice.c0, c1: fit.ice.c1, sunRadiusAt,
    });
    interloper = { ellipse, openTimes, closeAfterS: fit.ice.closeAfterS, impactAtS: fit.impactAtS ?? 1185,
      perihelionEpochsS: fit.perihelionEpochsS, periodS: intDef.orbit.periodS };
  }

  // --- node preparation (virtual nodes are kept: they are parents of real bodies) ---
  const nodes = defs.map((d) => {
    const o = d.orbit;
    const kind = !o ? 'root' : o.kind;
    const n = {
      def: d, id: d.id, kind, virtual: !!d.virtual,
      parent: d.primary && byId.has(d.primary) ? d.primary : null,
      phaseRad: (o?.phaseDeg ?? 0) * DEG,
      periodS: o?.periodS ?? Infinity,
      visualRadius: scale.body(d.radiusM ?? 0),
      realRadius: d.radiusM ?? 0,
      atmosphereM: d.atmosphereM ?? 0,
      showFromS: d.showFromS ?? 0,
      x: 0, z: 0,
      visualDistance: 0, localDistance: 0,
      driftStartM: 0, driftEndM: 0, driftKinkS: Infinity, driftSpeedUp: 1,
      hosts: null, hostIndex: 0, dwellS: 30, qmRng: null, lastJumpT: -Infinity,
      ellipse: d.id === 'interloper' ? interloper?.ellipse : null,
      color: ORBIT_COLORS[d.id] ?? DEFAULT_COLOR,
    };
    if (kind === 'circle') {
      n.localDistance = o.distanceM;
      n.visualDistance = d.frame === 'local' ? scale.local(o.distanceM) : scale.orbit(o.distanceM);
    } else if (kind === 'drift') {
      n.driftStartM = o.distanceStartM;
      n.driftEndM = o.distanceEndM ?? o.distanceStartM;
      n.driftKinkS = o.speedUpAtS ?? Infinity;
      n.driftSpeedUp = o.speedUpFactor ?? 1;
      n.driftSpeedMps = o.speedMps ?? 0;
      n.launchAtS = o.launchAtS ?? 0;
    } else if (kind === 'host-switch') {
      n.hosts = eventsDoc?.quantumMoon?.hosts ?? bodiesDoc.quantumHosts ?? [];
      n.dwellS = eventsDoc?.quantumMoon?.dwellS ?? 30;
      n.hostStart = o.hostStart;
      n.hostIndex = Math.max(0, n.hosts.findIndex((h) => h.id === o.hostStart));
      n.qmRng = mulberry32(ev.seed ^ 0x904);
    }
    return n;
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const idx = new Map(nodes.map((n, i) => [n.id, i]));

  // topological order (parents before children); the quantum moon is sampled last
  const order = [];
  const visit = (n, guard = 0) => {
    if (guard > 8 || order.includes(n)) return;
    if (n.parent && nodeById.has(n.parent)) visit(nodeById.get(n.parent), guard + 1);
    order.push(n);
  };
  nodes.forEach((n) => visit(n));
  const qmNode = nodeById.get('quantum_moon');
  const staticOrder = order.filter((n) => n !== qmNode);

  // --- orbit lines: circles as unit rings, the interloper as a mapped polyline ---
  const rings = nodes.filter((n) => n.kind === 'circle' && !n.virtual);
  let ellipsePoints = null;
  if (interloper) {
    const intNode = nodeById.get('interloper');
    ellipsePoints = new Float32Array(ELLIPSE_SEGMENTS * 2);
    for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
      const Mt = (TWO_PI * i) / ELLIPSE_SEGMENTS;
      const st = interloper.ellipse.state(intNode.def.orbit.perihelionEpochS + (Mt / TWO_PI) * interloper.ellipse.periodS);
      const rVis = scale.orbit(st.r);
      const th = st.nu + intNode.phaseRad;
      ellipsePoints[i * 2] = rVis * Math.cos(th);
      ellipsePoints[i * 2 + 1] = rVis * Math.sin(th);
    }
  }

  // --- preallocated frame ---
  // shockRadius: how far the supernova front sweeps — past the outermost *moving*
  // orbit (the static Eye ring sits far outside the usual view).
  let shockRadius = 0;
  for (const n of rings) if (Number.isFinite(n.periodS) && n.visualDistance > shockRadius) shockRadius = n.visualDistance;
  shockRadius = shockRadius > 0 ? shockRadius * 1.6 : 20000;
  const frame = {
    t: 0, cycleS,
    scaleParams: { p: scale.p, kLocal: scale.kLocal, kBody: scale.kBody, kSun: scale.kSun, realScale: scale.isRealScale() },
    sun: { realRadius: 0, visualRadius: 0, mix: 0, flash: 0, remnant: false, visible: true, collapse: 0, shock: 0, shockRadius },
    bodies: nodes.map((n) => ({
      id: n.id, x: 0, y: 0, z: 0, visualRadius: n.visualRadius, atmosphereVisual: scale.body(n.atmosphereM),
      spinRad: 0, textureKey: n.def.texture ? (n.def.texture.key ?? n.id) : null, variant: 'default', layer: 0, opacity: 1,
      visible: !n.virtual && n.id !== 'sun',
    })),
    orbits: [
      ...rings.map((n) => ({ id: n.id, type: 'ring', cx: 0, cz: 0, radiusVisual: n.visualDistance, points: null, color: n.color, visible: true })),
      ...(ellipsePoints ? [{ id: 'interloper', type: 'polyline', cx: 0, cz: 0, radiusVisual: 0, points: ellipsePoints, color: nodeById.get('interloper').color, visible: true }] : []),
    ],
    particles: Array.from({ length: MAX_PARTICLES }, () => ({ kind: 0, x: 0, y: 0, z: 0, size: 1, color: [1, 1, 1], opacity: 1 })),
    particleCount: 0,
    events: new Array(24).fill(null),
    eventCount: 0,
    flags: { sandFlowing: false, iceOpen: false, supernova: false, blackHole: false, endgame: false,
      probeLaunched: false, strangerSails: false, craterLevel: 0, sandLevel: 0, starExtinction: 0 },
    sunStation: { opacity: 1, visualOrbit: 0 },
  };
  const eventOut = { ids: frame.events, count: 0 };

  const sandRng = mulberry32(ev.seed ^ 0x5a17);
  const sandOffsets = new Float32Array(64);
  for (let i = 0; i < sandOffsets.length; i++) sandOffsets[i] = sandRng();

  let lastT = -1;
  let lastTPrev = -1;
  const defaultObserver = { visible: () => false };

  function sample(t, observer = defaultObserver) {
    const f = frame;
    if (t < lastT) { // loop reset → re-seed stateful bits
      if (qmNode) {
        qmNode.hostIndex = Math.max(0, qmNode.hosts.findIndex((h) => h.id === qmNode.hostStart));
        qmNode.qmRng = mulberry32(ev.seed ^ 0x904);
      }
      lastTPrev = -1;
      qmLastJump = -Infinity;
    }
    lastT = t;
    f.t = t;

    // sun
    const sunReal = sunRadiusAt(t);
    f.sun.realRadius = sunReal;
    f.sun.visualRadius = scale.sun(sunReal);
    f.sun.mix = smoothstep(1235, 1320, t);
    f.sun.flash = t >= 1320 ? Math.max(0, 1 - (t - 1320) / 2.5) : 0;
    f.sun.remnant = t >= 1320;
    f.sun.collapse = t >= 1320 ? smoothstep(1320, 1328, t) : 0;       // core shrinks to a remnant
    f.sun.shock = t >= 1320 ? clamp((t - 1320) / 36, 0, 1) : 0;       // ejecta front sweeps the system over 36 s (done before the wrap)

    // positions
    for (let k = 0; k < staticOrder.length; k++) {
      const n = staticOrder[k];
      if (n.kind === 'root') { n.x = 0; n.z = 0; continue; }
      const parent = n.parent ? nodeById.get(n.parent) : null;
      const px = parent ? parent.x : 0;
      const pz = parent ? parent.z : 0;
      if (n.kind === 'ellipse' && interloper) {
        const st = interloper.ellipse.state(t);
        const rVis = scale.orbit(st.r);
        const th = st.nu + n.phaseRad;
        n.x = rVis * Math.cos(th); n.z = rVis * Math.sin(th);
      } else if (n.kind === 'drift') {
        if (n.driftSpeedMps) { // probe: launched from its parent, then flies radially outward
          const rVis = scale.local(n.driftStartM) + scale.local(n.driftSpeedMps) * Math.max(0, t - n.launchAtS);
          n.x = px + rVis * Math.cos(n.phaseRad); n.z = pz + rVis * Math.sin(n.phaseRad);
        } else {              // stranger: slow outward drift with a course change at t=400s
          const span = n.driftEndM - n.driftStartM;
          const kink = Math.min(n.driftKinkS, cycleS);
          // v1 * kink + v2 * (cycle - kink) = span, with v2 = v1 * speedUp
          const v1 = span / (kink + n.driftSpeedUp * (cycleS - kink));
          const v2 = v1 * n.driftSpeedUp;
          const d = t <= kink ? n.driftStartM + v1 * t : n.driftStartM + v1 * kink + v2 * (t - kink);
          const rVis = scale.orbit(d);
          n.x = rVis * Math.cos(n.phaseRad); n.z = rVis * Math.sin(n.phaseRad);
        }
      } else {                // circle, heliocentric or local
        const ang = n.phaseRad + (Number.isFinite(n.periodS) ? (TWO_PI * t) / n.periodS : 0);
        const r = n.visualDistance;
        n.x = px + r * Math.cos(ang); n.z = pz + r * Math.sin(ang);
      }
    }

    // quantum moon: jumps only while outside the camera frustum, seeded walk
    if (qmNode) {
      const n = qmNode;
      const host = nodeById.get(n.hosts[n.hostIndex].id);
      let px = host ? host.x : 0, pz = host ? host.z : 0;
      let r = scale.local(n.hosts[n.hostIndex].distanceM);
      let ang = n.phaseRad + (Number.isFinite(host?.periodS) ? (TWO_PI * t) / host.periodS : 0);
      let x = px + r * Math.cos(ang), z = pz + r * Math.sin(ang);
      if (!n.qmInit) { n.qmInit = true; qmLastJump = t; }
      if (qmLastJump === -Infinity) qmLastJump = t;
      if (t - qmLastJump >= n.dwellS && !observer.visible(x, 0, z, n.visualRadius)) {
        const pool = [];
        for (let i = 0; i < n.hosts.length; i++) if (i !== n.hostIndex && n.hosts[i].reachable !== false) pool.push(i);
        if (pool.length) {
          n.hostIndex = pool[Math.floor(n.qmRng() * pool.length) % pool.length];
          qmLastJump = t;
          const h2 = nodeById.get(n.hosts[n.hostIndex].id);
          px = h2 ? h2.x : 0; pz = h2 ? h2.z : 0;
          r = scale.local(n.hosts[n.hostIndex].distanceM);
          ang = n.phaseRad + (Number.isFinite(h2?.periodS) ? (TWO_PI * t) / h2.periodS : 0);
          x = px + r * Math.cos(ang); z = pz + r * Math.sin(ang);
        }
      }
      n.x = x; n.z = z;
      n.visualDistance = r;
    }

    // flags
    const fl = ev.flagsAt(t);
    const iceOpen = interloper ? interloper.openTimes.some((o) => t >= o && t < o + interloper.closeAfterS) : false;
    const f2 = f.flags;
    f2.sandFlowing = fl.sandFlowing; f2.iceOpen = iceOpen; f2.supernova = fl.supernova;
    f2.blackHole = fl.blackHole; f2.endgame = fl.endgame; f2.probeLaunched = fl.probeLaunched;
    f2.strangerSails = fl.strangerSails; f2.craterLevel = fl.craterLevel;
    f2.sandLevel = t >= 1220 ? 1 : fl.sandFlowing ? smoothstep(120, 1220, t) : 0;
    f2.starExtinction = clamp((t - 1160) / 160, 0, 1);

    // body records
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const b = f.bodies[i];
      b.x = n.x; b.z = n.z; b.y = 0;
      b.variant = variantFor(n, t, iceOpen, fl);
      b.spinRad = spinFor(n, t);
      if (n.id === 'sun_station') {
        b.opacity = clamp((n.visualDistance - f.sun.visualRadius) / n.visualRadius, 0, 1);
        b.visible = b.opacity > 0.01;
        f.sunStation.opacity = b.opacity;
        f.sunStation.visualOrbit = n.visualDistance;
      } else if (n.id === 'interloper') {
        b.visible = !interloper || t < interloper.impactAtS;
      } else if (n.kind === 'host-switch') {
        b.visible = true;
        b.visualRadius = n.visualRadius;
      }
    }

    // orbit lines
    for (let i = 0; i < f.orbits.length; i++) {
      const o = f.orbits[i];
      const src = o.type === 'polyline' ? null : rings[i];
      if (src) {
        const parent = src.parent ? nodeById.get(src.parent) : null;
        o.cx = parent ? parent.x : 0;
        o.cz = parent ? parent.z : 0;
        o.radiusVisual = src.visualDistance;
        o.visible = !src.virtual;
      } else {
        o.visible = t < (interloper?.impactAtS ?? 1185);
      }
    }

    // particles: sand stream, lantern meteors, GD lightning, ATP black hole
    let pc = 0;
    const ash = nodes[idx.get('ash_twin')];
    const ember = nodes[idx.get('ember_twin')];
    if (fl.sandFlowing) {
      for (let i = 0; i < sandOffsets.length && pc < MAX_PARTICLES; i++) {
        const u = (t * 0.25 + sandOffsets[i]) % 1;
        const p = f.particles[pc++];
        p.kind = 0;
        p.x = ash.x + (ember.x - ash.x) * u; p.z = ash.z + (ember.z - ash.z) * u;
        p.y = (sandOffsets[i] - 0.5) * 24; p.size = 6 + 10 * sandOffsets[i]; p.opacity = 0.55;
        p.color[0] = 0.85; p.color[1] = 0.68; p.color[2] = 0.42;
      }
    }
    const lantern = nodes[idx.get('hollows_lantern')];
    const brittle = nodes[idx.get('brittle_hollow')];
    for (let i = 0; i < ev.meteorTimes.length && pc < MAX_PARTICLES; i++) {
      const age = t - ev.meteorTimes[i];
      if (age < 0 || age > 7) continue;
      const u = clamp(age / 7, 0, 1);
      for (let k = 0; k < 3 && pc < MAX_PARTICLES; k++) {
        const uu = clamp(u - k * 0.06, 0, 1);
        const p = f.particles[pc++];
        p.kind = 1;
        p.x = lantern.x + (brittle.x - lantern.x) * uu;
        p.z = lantern.z + (brittle.z - lantern.z) * uu;
        p.y = Math.sin(uu * Math.PI) * 120;
        p.size = 14 - k * 3; p.opacity = 1 - k * 0.3;
        p.color[0] = 1; p.color[1] = 0.62; p.color[2] = 0.3;
      }
    }
    const gd = nodes[idx.get('giants_deep')];
    for (let i = 0; i < ev.lightningTimes.length && pc < MAX_PARTICLES; i++) {
      const lt = ev.lightningTimes[i];
      if (t < lt || t > lt + 0.35) continue;
      const h = hash01(i, ev.seed);
      const p = f.particles[pc++];
      p.kind = 2;
      p.x = gd.x + (h - 0.5) * 900; p.z = gd.z + (hash01(i, 7) - 0.5) * 900; p.y = 700;
      p.size = 90; p.opacity = 1 - (t - lt) / 0.35;
      p.color[0] = 1; p.color[1] = 0.35; p.color[2] = 0.35;
    }
    if (fl.blackHole && pc < MAX_PARTICLES) {
      const bary = nodes[idx.get('hourglass_barycentre')];
      const p = f.particles[pc++];
      p.kind = 3; p.x = bary.x; p.z = bary.z; p.y = 0; p.size = 90; p.opacity = 0.9;
      p.color[0] = 0.05; p.color[1] = 0.02; p.color[2] = 0.08;
    }
    f.particleCount = pc;

    // events fired in (lastTPrev, t]
    ev.collect(lastTPrev, t, eventOut);
    f.eventCount = eventOut.count;
    lastTPrev = t;
    return f;
  }

  function variantFor(n, t, iceOpen, fl) {
    switch (n.id) {
      case 'ash_twin': case 'ember_twin': return t >= 1220 ? 'empty' : 'full';
      case 'brittle_hollow': return fl.craterLevel >= 5 ? 'holed' : 'intact';
      case 'opc': return t >= 1 ? 'broken' : 'intact';
      case 'interloper': return iceOpen ? 'open' : 'closed';
      case 'stranger': return t >= 400 ? 'sails' : 'cloaked';
      case 'sun_station': return t >= 493 ? 'engulfed' : 'intact';
      default: return n.def.texture?.variants?.[0] ?? 'default';
    }
  }

  function spinFor(n, t) {
    const rot = n.def.rotation;
    if (rot?.tidalLock && n.parent) {
      const p = nodeById.get(n.parent);
      const dx = (p ? p.x : 0) - n.x, dz = (p ? p.z : 0) - n.z;
      return Math.atan2(dz, dx);
    }
    if (!rot?.periodS || !Number.isFinite(rot.periodS)) return 0;
    return (TWO_PI * t) / rot.periodS;
  }

  let qmLastJump = -Infinity;

  return {
    frame, nodes, nodeById, rings, events: ev, scale, cycleS,
    sample,
    ids: nodes.map((n) => n.id),
    interloper,
    reset() { lastT = -1; lastTPrev = -1; qmLastJump = -Infinity; if (qmNode) qmNode.qmInit = false; },
  };
}
