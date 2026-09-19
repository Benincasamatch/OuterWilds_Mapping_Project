// Sun radius over the loop — PLAN.md §3.8.
// Anchors: R(0)=2001.75 (datamine), R(690)=2315 (OWClock "Sun Station Destroyed",
// and 2315 m is the Sun Station's own orbit radius), R(1320)=4000 (datamine "end of loop").
// v1 assumed an implicit straight line, which would have engulfed the station at t=207 s.

export const SUN_CURVE = [
  { fromS: 0, toS: 690, baseM: 2001.75, ampM: 313.25, exp: 1.15, spanS: 690 },
  { fromS: 690, toS: 1320, baseM: 2315, ampM: 1685, exp: 1.35, spanS: 630 },
];

export const SUN_RADIUS_END = 4000;

/** Real sun radius (m) at loop time t (s). */
export function sunRadiusAt(t) {
  if (t <= 0) return SUN_CURVE[0].baseM;
  for (const seg of SUN_CURVE) {
    if (t <= seg.toS) {
      const x = (t - seg.fromS) / seg.spanS;
      return seg.baseM + seg.ampM * Math.pow(x, seg.exp);
    }
  }
  return SUN_RADIUS_END;
}
