// Pure simulation clock. Clamp real frame time BEFORE applying playback speed.
export const DEFAULT_CYCLE_S = 1360;
export function createClock({ cycleS = DEFAULT_CYCLE_S, mode = 'paused-loop', maxStepS = 0.25, resyncAfterS = 60 } = {}) {
  if (!(cycleS > 0) || !Number.isFinite(cycleS)) throw new RangeError('invalid cycle');
  let t = 0, totalS = 0, wraps = 0, hidden = false, pendingResync = false;
  const wrap = (x) => ((x % cycleS) + cycleS) % cycleS;
  const valid = (x) => Number.isFinite(x) && x > 0;
  function add(seconds) {
    const count = Math.floor((t + seconds) / cycleS);
    totalS += seconds;
    t = wrap(t + seconds);
    wraps += count;
    return count;
  }
  return {
    cycleS,
    get t() { return t; }, get totalS() { return totalS; }, get wraps() { return wraps; },
    get mode() { return mode; }, get hidden() { return hidden; },
    get pendingResync() { return pendingResync; },
    setMode(m) { if (m === 'wall-clock' || m === 'paused-loop') mode = m; },
    clearResync() { pendingResync = false; },
    advance(realSeconds, rate = 1) {
      // Both modes stop while suspended. Catch-up happens once, on resume.
      if (hidden || !valid(realSeconds) || !valid(rate)) return 0;
      return add(Math.min(realSeconds, maxStepS) * rate);
    },
    setHidden(isHidden, elapsedSeconds = 0, rate = 1) {
      if (isHidden === hidden) return;
      hidden = isHidden;
      if (!hidden && mode === 'wall-clock' && valid(elapsedSeconds) && valid(rate)) {
        const count = add(elapsedSeconds * rate);
        if (elapsedSeconds > resyncAfterS || count > 0) pendingResync = true;
      }
    },
    seek(seconds) { if (Number.isFinite(seconds)) t = wrap(seconds); return t; },
    reset() { t = 0; totalS = 0; wraps = 0; pendingResync = false; return t; },
  };
}
