import test from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../wallpaper/js/lib/time.js';
import { createPlayback } from '../wallpaper/js/lib/playback.js';
const near = (a, b) => assert.ok(Math.abs(a-b) < 1e-7, a + ' != ' + b);
function fixture(mode = 'paused-loop', rate = 1) {
  let now = 0;
  const clock = createClock({ mode });
  const playback = createPlayback({ clock, now: () => now, rate: () => rate });
  return { clock, playback, jump: (value) => { now = value; } };
}
test('speed multiplier is applied after real-time clamping, including at 15 FPS', () => {
  const c = createClock(); for (let i=0;i<15;i++) c.advance(1/15, 10);
  near(c.t, 10); c.advance(99, 10); near(c.t, 12.5);
});
test('hidden ticks cannot double-count wall-clock catch-up', () => {
  const c = createClock({ mode: 'wall-clock' });
  c.setHidden(true); for (let i=0;i<100;i++) c.advance(0.1);
  near(c.t,0); c.setHidden(false,10); near(c.t,10);
  c.setHidden(false,10); near(c.t,10);
});
test('multi-cycle catch-up counts every wrap and reset clears counters', () => {
  const c = createClock({ mode:'wall-clock' });
  c.seek(1350); c.setHidden(true); c.setHidden(false, 2800);
  near(c.t,70); assert.equal(c.wraps,3); assert.equal(c.pendingResync,true);
  c.reset(); near(c.t,0); near(c.totalS,0); assert.equal(c.wraps,0); assert.equal(c.pendingResync,false);
});
test('invalid clock inputs cannot poison simulation state', () => {
  const c=createClock(); for(const x of [NaN,Infinity,-Infinity,-1,0]) { c.advance(x); c.seek(x); }
  assert.ok(Number.isFinite(c.t)); c.setMode('invalid'); assert.equal(c.mode,'paused-loop');
});
test('short catch-up across a seam still asks for a flash', () => {
  const c=createClock({ mode:'wall-clock' }); c.seek(1359); c.setHidden(true); c.setHidden(false,2);
  near(c.t,1); assert.equal(c.pendingResync,true);
});
test('host and visibility pause signals overlap without double catch-up', () => {
  const f=fixture('wall-clock',2); f.jump(5); f.playback.setSuspended('host',true);
  f.jump(8); f.playback.setSuspended('visibility',true);
  f.jump(10); f.playback.setSuspended('host',false); assert.equal(f.playback.suspended,true);
  f.jump(15); f.playback.setSuspended('visibility',false); near(f.clock.t,20);
  f.jump(15.1); f.playback.advance(); near(f.clock.t,20.2);
});
test('duplicate pause/resume notifications are idempotent', () => {
  const f=fixture('wall-clock'); f.playback.setSuspended('host',true);
  f.jump(3); f.playback.setSuspended('host',true);
  f.jump(5); f.playback.setSuspended('host',false); near(f.clock.t,5);
  f.playback.setSuspended('host',false); near(f.clock.t,5);
});
test('paused-loop mode freezes across a host pause', () => {
  const f=fixture(); f.playback.setSuspended('host',true);
  f.jump(90); f.playback.advance(); near(f.clock.t,0);
  f.playback.setSuspended('host',false); f.jump(90.1); f.playback.advance(); near(f.clock.t,0.1);
});
test('context suspension composes with a host pause', () => {
  const f=fixture(); f.playback.setSuspended('context',true); f.playback.setSuspended('host',true);
  f.jump(5); f.playback.setSuspended('context',false); assert.equal(f.playback.suspended,true);
  f.playback.setSuspended('host',false); assert.equal(f.playback.suspended,false); near(f.clock.t,0);
});
test('a silent host freeze catches up once only in wall-clock mode', () => {
  for(const mode of ['paused-loop','wall-clock']) {
    const f=fixture(mode); f.jump(120); f.playback.advance(); near(f.clock.t, mode==='wall-clock'?120:0);
    assert.equal(f.clock.pendingResync, mode==='wall-clock');
    f.jump(120.1); f.playback.advance(); near(f.clock.t,mode==='wall-clock'?120.1:0.1);
  }
});
