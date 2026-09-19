// Visual scale mapping — PLAN.md §3.7.
//
// Heliocentric distances (and the SUN RADIUS) share ONE monotone map, so the
// 690 s "sun engulfs Sun Station" beat emerges from geometry instead of being
// faked with a scripted event. Satellite / mutual-orbital distances use a local
// linear scale; body radii use an independent inflation factor with a hard cap.

export const SUN_RADIUS0 = 2001.75; // m, datamine value at t=0

export const DEFAULTS = {
  p: 0.45,          // compression exponent (1 = true scale)
  kSun: 4000,       // visual radius of the sun at t=0
  rSun0: SUN_RADIUS0,
  kLocal: 2.0,      // satellite + mutual-orbit distance inflation
  kBody: 1.4,       // body radius inflation
};

/** Max kBody that keeps the tightest pair (Hourglass Twins) from overlapping. */
export const K_BODY_CAP = 500 / 338; // = 1.479

export function makeScale(opts = {}) {
  const s = { ...DEFAULTS, ...opts };
  const orbit = (r) => (s.p === 1 ? r : s.kSun * Math.pow(r / s.rSun0, s.p));
  return {
    ...s,
    /** heliocentric real radius (m) -> visual distance */
    orbit,
    /** real sun radius (m) -> visual radius; same map as orbits (design decision) */
    sun: (realR) => orbit(realR),
    /** satellite / mutual-orbit real distance (m) -> visual distance */
    local: (realD) => realD * s.kLocal,
    /** body real radius (m) -> visual radius */
    body: (realR) => realR * s.kBody,
    /** true-scale switch (PLAN.md §3.7): p=1, kSun=rSun0 makes orbit(r) === r */
    realScale: () => makeScale({ p: 1, kSun: SUN_RADIUS0, rSun0: SUN_RADIUS0, kLocal: 1, kBody: 1 }),
    isRealScale: () => s.p === 1 && s.kLocal === 1 && s.kBody === 1,
    kBodyCap: K_BODY_CAP,
  };
}
