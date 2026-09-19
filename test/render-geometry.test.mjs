// Render-side pure geometry + the frame fields the renderer's new passes read.
// No GL: mesh.js is plain typed-array maths, world.js is the sampler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStarField, makeUvSphere, makeUnitRing } from '../wallpaper/js/render/mesh.js';
import { createWorld } from '../wallpaper/js/lib/world.js';
import { bodiesDoc, eventsDoc } from './helpers.mjs';

test('star field is deterministic and carries a size per star', () => {
  const a = makeStarField(4000, 7);
  const b = makeStarField(4000, 7);
  assert.deepEqual(Array.from(a.dirs), Array.from(b.dirs));
  assert.deepEqual(Array.from(a.brightness), Array.from(b.brightness));
  assert.deepEqual(Array.from(a.sizes), Array.from(b.sizes));
  assert.equal(a.sizes.length, 4000);
  assert.equal(a.dirs.length, 12000);
  const c = makeStarField(4000, 8);
  assert.notDeepEqual(Array.from(a.dirs), Array.from(c.dirs), 'the seed must matter');
});

test('every star direction is a unit vector; sizes and brightness stay in range', () => {
  const { dirs, brightness, sizes } = makeStarField(6000, 1);
  let dust = 0;
  for (let i = 0; i < 6000; i++) {
    const len = Math.hypot(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
    assert.ok(Math.abs(len - 1) < 1e-5, `star ${i} |dir| = ${len}`);
    assert.ok(brightness[i] > 0 && brightness[i] <= 1.3, `star ${i} brightness ${brightness[i]}`);
    assert.ok(sizes[i] >= 1 && sizes[i] <= 64, `star ${i} size ${sizes[i]}`);
    if (sizes[i] > 8) {
      dust++;
      assert.ok(brightness[i] < 0.2, 'dust sprites must stay faint');
    }
  }
  assert.ok(dust > 200 && dust < 600, `dust sprites: ${dust}`);
});

test('the galactic band concentrates stars around a tilted great circle', () => {
  const { dirs } = makeStarField(12000, 1);
  // Band normal from mesh.js (normalised); latitude = asin(dir · n).
  const n = [0.42, 0.78, -0.46];
  const nl = Math.hypot(...n);
  let near = 0;
  for (let i = 0; i < 12000; i++) {
    const lat = Math.asin((dirs[i * 3] * n[0] + dirs[i * 3 + 1] * n[1] + dirs[i * 3 + 2] * n[2]) / nl);
    if (Math.abs(lat) < 0.15) near++;
  }
  // A uniform sphere puts sin(0.15) ≈ 15% of its stars within ±0.15 rad of any great circle.
  const uniformShare = Math.sin(0.15);
  assert.ok(near / 12000 > uniformShare * 2.5, `band share ${(near / 12000).toFixed(3)} vs uniform ${uniformShare.toFixed(3)}`);
});

test('sphere and ring generators keep their documented sizes', () => {
  const s = makeUvSphere(48, 24);
  assert.equal(s.positions.length / 3, 49 * 25);
  assert.equal(s.indices.length / 3, 48 * 24 * 2);
  const r = makeUnitRing(256);
  assert.equal(r.length, 256 * 3);
  for (let i = 0; i < 256; i++) assert.ok(Math.abs(Math.hypot(r[i * 3], r[i * 3 + 2]) - 1) < 1e-6);
});

test('supernova collapse and shock progress are exposed on frame.sun', () => {
  const w = createWorld({ bodies: bodiesDoc, events: eventsDoc });
  const before = w.sample(1319.9).sun;
  assert.equal(before.collapse, 0);
  assert.equal(before.shock, 0);
  assert.ok(before.shockRadius > 0, 'shock radius must be preallocated');
  const mid = w.sample(1324).sun;
  assert.ok(mid.collapse > 0 && mid.collapse < 1, `collapse ${mid.collapse}`);
  assert.ok(mid.shock > 0 && mid.shock < 1, `shock ${mid.shock}`);
  assert.equal(mid.remnant, true);
  const late = w.sample(1359).sun;
  assert.equal(late.collapse, 1);
  assert.equal(late.shock, 1);
  // the front reaches past the outermost moving orbit and never past the static Eye ring
  const eye = w.nodeById.get('eye');
  const farthestMoving = Math.max(...w.rings.filter((n) => Number.isFinite(n.periodS)).map((n) => n.visualDistance));
  assert.ok(late.shockRadius > farthestMoving, 'must sweep the whole planetary system');
  assert.ok(late.shockRadius < eye.visualDistance, 'must not be sized by the Eye');
  assert.equal(w.sample(10).sun.shock, 0, 'reset after the wrap');
});
