// Frame pacing rule — PLAN.md §1.2 (idle cost) / §4.4 (fpsLimit, idleFps properties).
// The wallpaper must never draw faster than the configured cap, including while it is
// "busy": particles and the supernova flash raise the cap to fpsLimit, they do not
// remove it (an uncapped busy branch draws at the compositor rate).
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawIntervalS, drawDue } from '../wallpaper/js/lib/framerate.js';

test('idle pacing uses idleFps, busy pacing uses fpsLimit', () => {
  assert.equal(drawIntervalS(false, 30, 15), 1 / 15);
  assert.equal(drawIntervalS(true, 30, 15), 1 / 30);
});

test('a busy frame is paced, not drawn on every tick', () => {
  const FPS_LIMIT = 30, IDLE = 15;
  // 200 animation-frame ticks per second, as an uncapped compositor would deliver
  let last = -Infinity, draws = 0;
  for (let i = 0; i < 200; i++) {
    const now = i / 200;
    if (drawDue(now, last, true, FPS_LIMIT, IDLE)) { last = now; draws++; }
  }
  assert.ok(draws <= 31 && draws >= 29, `busy second drew ${draws} frames, expected ~${FPS_LIMIT}`);
});

test('idle is slower than busy and the first frame is never delayed', () => {
  assert.equal(drawDue(0, -Infinity, false, 30, 15), true, 'first frame draws immediately');
  let last = 0, busyDraws = 0, idleDraws = 0;
  for (let i = 1; i <= 300; i++) {
    const now = i / 300;
    if (drawDue(now, last, true, 30, 15)) { last = now; busyDraws++; }
  }
  last = 0;
  for (let i = 1; i <= 300; i++) {
    const now = i / 300;
    if (drawDue(now, last, false, 30, 15)) { last = now; idleDraws++; }
  }
  assert.ok(idleDraws < busyDraws, `idle ${idleDraws} must be below busy ${busyDraws}`);
  assert.ok(idleDraws >= 14 && idleDraws <= 16, `idle second drew ${idleDraws} frames, expected ~15`);
});

test('a degenerate cap still advances (never divides by zero or stalls)', () => {
  assert.equal(drawIntervalS(true, 0, 0), 1, 'a cap of 0 is clamped to 1 fps, not to infinity');
  assert.equal(drawDue(0.5, 0.49, true, 0, 0), false, 'clamped cap still paces');
  assert.equal(drawDue(1.5, 0.49, true, 0, 0), true, 'clamped cap eventually draws');
  assert.equal(drawIntervalS(true, Number.NaN, 15), 1, 'NaN cap falls back to 1 fps');
});
