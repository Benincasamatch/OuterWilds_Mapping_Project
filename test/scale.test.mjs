// Scale mapping + sun radius curve — PLAN.md §3.7, §3.8.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeScale, K_BODY_CAP, SUN_RADIUS0 } from '../wallpaper/js/lib/scale.js';
import { sunRadiusAt } from '../wallpaper/js/lib/sun.js';
import { bodiesDoc } from './helpers.mjs';

const scale = makeScale();
const REAL_RADII = [2001.75, 2315, 2500, 5000, 8593.085981, 11690.89092, 16457.58738, 20000, 24000, 410000, 657000];

test('the orbit map is strictly monotone (order is never inverted)', () => {
  for (let i = 1; i < REAL_RADII.length; i++) {
    const a = scale.orbit(REAL_RADII[i - 1]);
    const b = scale.orbit(REAL_RADII[i]);
    assert.ok(b > a, `${REAL_RADII[i - 1]} -> ${REAL_RADII[i]} inverted (${a} -> ${b})`);
    assert.ok(Number.isFinite(a) && Number.isFinite(b));
  }
});

test('the sun radius uses the same map, so the engulf beat is emergent', () => {
  assert.equal(scale.sun(SUN_RADIUS0), 4000, 't=0 sun radius is exactly kSun');
  // R_sun(t)=2315 must reach the Sun Station's own mapped orbit distance exactly.
  assert.ok(Math.abs(scale.sun(2315) - scale.orbit(2315)) < 1e-9);
  assert.ok(scale.orbit(2315) - scale.body(60) - scale.sun(2001.75) > 0, 'station starts outside the sun');
  assert.ok(scale.orbit(2315) - scale.body(60) < scale.sun(2315), 'station body is inside the sun at 690s');
});

test('real-scale switch collapses every factor to 1', () => {
  const real = scale.realScale();
  for (const r of REAL_RADII) assert.ok(Math.abs(real.orbit(r) - r) < 1e-9);
  assert.equal(real.local(1000), 1000);
  assert.equal(real.body(254), 254);
  assert.equal(real.isRealScale(), true);
  assert.equal(scale.isRealScale(), false);
});

test('body inflation stays under the tightest-pair cap', () => {
  assert.ok(scale.kBody < K_BODY_CAP, `kBody ${scale.kBody} must be < ${K_BODY_CAP.toFixed(3)}`);
  const twins = bodiesDoc.bodies.filter((b) => b.primary === 'hourglass_barycentre');
  assert.equal(twins.length, 2);
  const gap = scale.local(2 * twins[0].orbit.distanceM) - 2 * scale.body(twins[0].radiusM);
  assert.ok(gap > 0, `twins overlap by ${(-gap).toFixed(1)} visual units`);
});

test('declared clearances are positive', () => {
  for (const c of bodiesDoc.clearance) assert.ok(c.ok && c.gap > 0, `${c.pair} gap ${c.gap}`);
});

test('sun radius curve hits its anchors and protects the first two perihelia', () => {
  assert.ok(Math.abs(sunRadiusAt(0) - 2001.75) < 1e-9);
  assert.ok(Math.abs(sunRadiusAt(690) - 2315) < 1e-9);
  assert.ok(Math.abs(sunRadiusAt(1320) - 4000) < 1e-9);
  assert.equal(sunRadiusAt(1360), 4000, 'held until the loop resets');
  for (let t = 0; t < 1320; t += 0.5) assert.ok(sunRadiusAt(t + 0.5) >= sunRadiusAt(t), `not monotone at ${t}`);

  const peri = bodiesDoc.bodies.find((b) => b.id === 'interloper').orbit;
  assert.ok(sunRadiusAt(peri.perihelionEpochS - peri.periodS) < peri.perihelionM, 'first perihelion survives');
  assert.ok(sunRadiusAt(peri.perihelionEpochS - 2 * peri.periodS) < peri.perihelionM, 'second perihelion survives');
  assert.ok(sunRadiusAt(1185) > peri.perihelionM, 'sun is already larger than the perihelion at impact');
  // the crossing of 2500 m is ~812.6 s (documented check point)
  let cross = 0;
  for (let t = 690; t < 1320; t += 0.05) if (sunRadiusAt(t) >= 2500) { cross = t; break; }
  assert.ok(Math.abs(cross - 812.6) < 1.0, `crossing at ${cross.toFixed(2)}s`);
});

test('a straight-line sun growth would have failed (regression guard)', () => {
  const linear = (t) => 2001.75 + (4000 - 2001.75) * (t / 1320);
  assert.ok(linear(690) > 2315, 'linear model over-shoots at 690s — that is why the curve exists');
  assert.ok(linear(207) >= 2315 - 1e-6, 'linear model would engulf the station at ~207s');
});
