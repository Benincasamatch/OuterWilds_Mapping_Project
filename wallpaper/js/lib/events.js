// Event schedule + deterministic PRNG — PLAN.md §3.5 / §3.5.1.
// All randomness is seeded and driven by t (never by frame count, so the WE FPS
// limiter cannot change event frequencies). No DOM.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable per-index hash in [0,1) — used for star extinction order. */
export function hash01(i, seed = 1) {
  let x = Math.imul(i ^ seed, 0x9e3779b1) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
export function smoothstep(edge0, edge1, x) {
  const u = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
  return u * u * (3 - 2 * u);
}

export function createEvents(doc) {
  const seed = doc?.meta?.prng?.seed ?? 1;
  const cycleS = doc?.meta?.cycleS ?? 1360;

  const list = [...(doc?.events ?? [])].sort((a, b) => a.atS - b.atS);
  const byId = new Map(list.map((e) => [e.id, e]));
  const at = (id) => byId.get(id)?.atS ?? Infinity;

  // ---- decorative schedules (fully precomputed → deterministic, no state) ----
  const dec = new Map((doc?.decorative ?? []).map((d) => [d.id, d]));
  const meteor = [];

  const meteorDef = dec.get('lantern_meteors');
  if (meteorDef) {
    const rng = mulberry32(seed ^ 0x5eed);
    const phases = meteorDef.schedule.ratePerMinFromS;
    const launchAt = [];
    let t = meteorDef.schedule.firstAtS;
    while (t < cycleS) {
      const phase = phases.find((p) => t >= p.fromS && t < p.toS) ?? phases[phases.length - 1];
      launchAt.push(t);
      const period = 60 / phase.rate;
      t += period * (0.85 + 0.3 * rng());   // ±15% jitter (tolerance C)
    }
    for (const launch of launchAt) {
      meteor.push(launch);
    }
  }

  const lightning = [];
  const lightningDef = dec.get('gd_lightning');
  if (lightningDef) {
    const rng = mulberry32(seed ^ 0x11a7);
    const period = 60 / lightningDef.ratePerMin;
    for (let t = period * 0.5; t < cycleS; t += period * (0.8 + 0.4 * rng())) lightning.push(t);
  }

  const flags = { sandFlowing: false, iceOpen: false, supernova: false, blackHole: false,
    endgame: false, remnant: false, probeLaunched: false, strangerSails: false, craterLevel: 0 };

  return {
    doc, list, byId, seed, cycleS,
    at,
    meteorTimes: meteor,
    lightningTimes: lightning,
    tolerances: doc?.meta?.tolerances ?? {},

    /** Continuous state driven purely by t (idempotent, testable). */
    flagsAt(t) {
      flags.sandFlowing = t >= at('sand_start') && t < at('sand_stop');
      flags.endgame = t >= at('endgame');
      flags.supernova = t >= at('supernova');
      flags.remnant = t >= at('supernova');
      flags.blackHole = t >= at('atp_black_hole');
      flags.probeLaunched = t >= at('probe_launch');
      flags.strangerSails = t >= at('stranger_sails');
      let crater = 0;
      for (let i = 0; i < meteor.length; i++) if (meteor[i] <= t) crater++;
      flags.craterLevel = Math.min(meteorDef?.craterLevelCap ?? 5, crater);
      return flags;
    },

    /** Events fired in (fromT, t]; writes ids into out.ids and returns the count. */
    collect(fromT, t, out) {
      out.count = 0;
      const wrap = t < fromT;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const hit = wrap ? e.atS > fromT || e.atS <= t : e.atS > fromT && e.atS <= t;
        if (hit && out.count < out.ids.length) out.ids[out.count++] = e;
      }
      return out.count;
    },
  };
}
