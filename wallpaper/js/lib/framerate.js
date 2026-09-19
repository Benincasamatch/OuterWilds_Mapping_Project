// Frame pacing — PLAN.md §1.2 (挂机开销低) and §4.4 (fpsLimit / idleFps).
//
// The loop ticks on every animation frame (cheap: sample + HUD), but only *draws* are
// paced. `busy` (interaction, particles, supernova flash) raises the cap to `fpsLimit`;
// it must never remove the cap — an uncapped "busy" branch is exactly how a wallpaper
// ends up drawing at the compositor rate forever.
//
// Pure numbers only, so the rule is testable without a GL context or a DOM.

/** Seconds that must elapse between two draws for the given state. */
export function drawIntervalS(busy, fpsLimit, idleFps) {
  const fps = busy ? fpsLimit : idleFps;
  return 1 / Math.max(1, Number(fps) || 0);
}

/** True when a frame is due. `lastDrawS` may be -Infinity so the first frame draws at once. */
export function drawDue(nowS, lastDrawS, busy, fpsLimit, idleFps) {
  return nowS - lastDrawS >= drawIntervalS(busy, fpsLimit, idleFps);
}
