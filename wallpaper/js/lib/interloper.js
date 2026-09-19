// Interloper helpers — shared by tools/build-data.mjs (the fit) and the runtime
// (ice-shell windows). PLAN.md §3.9.

/** Last t in [tFrom,tTo] where (radiusFn - threshFn) crosses + -> - (inbound). */
export function findInboundCrossing(radiusFn, threshFn, tFrom, tTo, steps = 4000) {
  let prev = radiusFn(tFrom) - threshFn(tFrom);
  let cross = NaN;
  const dt = (tTo - tFrom) / steps;
  for (let i = 1; i <= steps; i++) {
    const t = tFrom + dt * i;
    const cur = radiusFn(t) - threshFn(t);
    if (prev > 0 && cur <= 0) {
      let lo = t - dt, hi = t;
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2;
        if (radiusFn(mid) - threshFn(mid) > 0) lo = mid; else hi = mid;
      }
      cross = (lo + hi) / 2;
    }
    prev = cur;
  }
  return cross;
}

/** Ice-shell open times for each perihelion pass, from the fitted threshold model. */
export function iceOpenTimes({ radiusAt, periodS, perihelionEpochsS, c0, c1, sunRadiusAt }) {
  const thresh = (t) => c0 + c1 * sunRadiusAt(t);
  return perihelionEpochsS.map((p) => findInboundCrossing(radiusAt, thresh, p - periodS / 2, p));
}
