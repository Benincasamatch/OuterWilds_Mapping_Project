// Pure orbital math. No DOM, no globals, no allocation in the hot path.
// See PLAN.md §3.1 (field definitions) and §3.9 (interloper joint solve).

export const TWO_PI = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Newton–Raphson: mean anomaly -> eccentric anomaly (e < 1). */
export function meanToEccentric(M, e) {
  const m = ((M % TWO_PI) + TWO_PI) % TWO_PI;
  let E = e < 0.8 ? m : Math.PI;
  for (let i = 0; i < 60; i++) {
    const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

/** Eccentric -> true anomaly, numerically stable for all E. */
export function eccentricToTrue(E, e) {
  const half = Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  return 2 * half;
}

export function trueToEccentric(nu, e) {
  const half = Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
  return 2 * half;
}

export function radiusAtTrueAnomaly(a, e, nu) {
  return (a * (1 - e * e)) / (1 + e * Math.cos(nu));
}

/**
 * Kepler ellipse with a fixed perihelion epoch (used for the interloper).
 * state(t) writes into `out` to stay allocation-free.
 */
export function makeEllipse({ a, e, periodS, perihelionEpochS, phaseOffsetRad = 0, mu }) {
  const n = TWO_PI / periodS; // mean motion, rad/s
  const p = a * (1 - e * e);

  function state(t, out = {}) {
    const M = n * (t - perihelionEpochS);
    const E = meanToEccentric(M, e);
    const nu = eccentricToTrue(E, e);
    const r = p / (1 + e * Math.cos(nu));
    const theta = nu + phaseOffsetRad;
    out.r = r;
    out.nu = nu;
    out.theta = theta;
    out.x = r * Math.cos(theta);
    out.z = r * Math.sin(theta);
    // areal velocity / r^2 = d(theta)/dt
    out.omega = (n * a * a * Math.sqrt(1 - e * e)) / (r * r);
    return out;
  }

  /** Analytic inverse: seconds from perihelion at which radius == r (inbound or outbound). */
  function timeFromPerihelion(r) {
    const cosNu = (p / r - 1) / e;
    if (cosNu < -1 || cosNu > 1) return NaN;
    const nu = Math.acos(cosNu);
    const E = trueToEccentric(nu, e);
    return (E - e * Math.sin(E)) / n; // 0..T/2 (inbound half mirrored by caller)
  }

  return { a, e, periodS, n, p, mu, state, timeFromPerihelion, radiusAt: (t) => state(t).r };
}

/** Uniform circular orbit angle at time t, degrees phase at t=0. */
export function circleAngleRad(periodS, phaseDeg, t) {
  return phaseDeg * DEG + (TWO_PI * t) / periodS;
}

export function wrapAngle(a) {
  const x = a % TWO_PI;
  return x < 0 ? x + TWO_PI : x;
}
