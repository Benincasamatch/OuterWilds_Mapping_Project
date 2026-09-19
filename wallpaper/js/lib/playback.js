// Coalesce host pause, page visibility and context loss. No DOM dependencies.
export function createPlayback({ clock, now, rate = () => 1, silentGapS = 1 }) {
  const reasons = new Set();
  let last = now(), suspendedAt = 0, dt = 0;
  return {
    get suspended() { return reasons.size > 0; },
    get dt() { return dt; },
    setSuspended(reason, value) {
      const was = reasons.size > 0;
      if (value) reasons.add(reason); else reasons.delete(reason);
      const active = reasons.size > 0;
      if (active === was) return;
      const stamp = now();
      if (active) { suspendedAt = stamp; clock.setHidden(true); }
      else { clock.setHidden(false, Math.max(0, stamp - suspendedAt), rate()); }
      last = stamp; dt = 0;
    },
    advance(stamp = now()) {
      const elapsed = Math.max(0, stamp - last);
      last = stamp;
      dt = Math.min(elapsed, 0.25);
      if (reasons.size) { dt = 0; return 0; }
      // Some hosts suspend rAF without a visibility/host notification.
      if (elapsed > silentGapS) {
        const before = clock.wraps;
        clock.setHidden(true);
        clock.setHidden(false, elapsed, rate());
        dt = 0;
        return clock.wraps - before;
      }
      return clock.advance(elapsed, rate());
    },
  };
}
