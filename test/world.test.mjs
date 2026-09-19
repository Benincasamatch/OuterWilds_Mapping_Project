// World sampler behaviour — PLAN.md §1.2 (轨道正确性 / 自转), §3.5, §3.10.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../wallpaper/js/lib/world.js';
import { TWO_PI } from '../wallpaper/js/lib/kepler.js';
import { createClock } from '../wallpaper/js/lib/time.js';
import { bodiesDoc, eventsDoc, bodyById, angleOf, normalizedDelta } from './helpers.mjs';

const make = (options) => createWorld({ bodies: bodiesDoc, events: eventsDoc, options });
const idx = (w, id) => w.ids.indexOf(id);

test('every orbiting body completes 2π/T per second (plan acceptance: 轨道正确性)', () => {
  const w = make();
  const t0 = 137;
  for (const n of w.nodes) {
    if (!n.parent || n.kind !== 'circle' || n.virtual) continue;
    const a1 = angleOf(w, n.id, t0 + 1);
    const a0 = angleOf(w, n.id, t0);
    if (!Number.isFinite(n.periodS)) {                 // static by design (the Eye)
      assert.ok(Math.abs(normalizedDelta(a1, a0)) < 1e-12, `${n.id} must not orbit`);
      continue;
    }
    const dTheta = normalizedDelta(a1, a0);
    const expected = TWO_PI / n.periodS;
    const dev = Math.abs(Math.abs(dTheta) - expected) / expected;
    assert.ok(dev < 0.02, `${n.id}: measured ${Math.abs(dTheta).toFixed(5)} rad/s vs expected ${expected.toFixed(5)}`);
  }
});

test('sample() reuses one frame object (zero per-frame allocation contract)', () => {
  const w = make();
  const a = w.sample(10);
  const b = w.sample(11);
  assert.equal(a, b, 'sample must not allocate a new frame');
  assert.equal(a.bodies[0], b.bodies[0], 'body records must be preallocated');
  assert.equal(a.particles[0], b.particles[0], 'particle records must be preallocated');
});

test('non-rotating bodies never spin; tidal-locked bodies face their primary', () => {
  const w = make();
  for (const t of [0, 137, 700, 1200]) {
    const f = w.sample(t);
    for (const id of ['giants_deep', 'dark_bramble', 'quantum_moon', 'eye']) {
      assert.equal(f.bodies[idx(w, id)].spinRad, 0, `${id} must not rotate`);
    }
    for (const id of ['attlerock', 'sun_station']) {
      const n = w.nodeById.get(id);
      const p = w.nodeById.get(n.parent);
      const facing = Math.atan2(p.z - n.z, p.x - n.x);
      const s = f.bodies[idx(w, id)].spinRad;
      assert.ok(Math.abs(normalizedDelta(s, facing)) < 1e-9, `${id} is not tidally locked at t=${t}`);
    }
  }
});

test('spin periods follow the datamine day lengths', () => {
  const w = make();
  const ids = ['timber_hearth', 'brittle_hollow', 'ash_twin', 'ember_twin'];
  const spinAt = (t) => { const f = w.sample(t); return ids.map((id) => f.bodies[idx(w, id)].spinRad); };
  const s0 = spinAt(0);
  const s1 = spinAt(10);              // NB: sample() reuses the frame — copy values out first
  ids.forEach((id, k) => {
    const expected = (TWO_PI * 10) / bodyById(id).rotation.periodS;
    assert.ok(Math.abs(normalizedDelta(s1[k] - s0[k], expected)) < 1e-6, `${id} spin`);
  });
});

test('the Hourglass Twins stay 180° apart around their barycentre', () => {
  const w = make();
  for (const t of [0, 300, 900, 1359]) {
    const f = w.sample(t);
    const ash = f.bodies[idx(w, 'ash_twin')];
    const ember = f.bodies[idx(w, 'ember_twin')];
    const bary = w.nodeById.get('hourglass_barycentre');
    const a1 = Math.atan2(ash.z - bary.z, ash.x - bary.x);
    const a2 = Math.atan2(ember.z - bary.z, ember.x - bary.x);
    assert.ok(Math.abs(Math.abs(normalizedDelta(a1, a2)) - Math.PI) < 1e-9, `t=${t}`);
  }
});

test('loop reset restores the initial configuration exactly', () => {
  const w = make();
  const fresh = make();
  const before = w.sample(1359);
  const first = { x: before.bodies[0].x, z: before.bodies[0].z };
  const after = w.sample(0);                       // wrap
  const again = fresh.sample(0);
  for (let i = 0; i < after.bodies.length; i++) {
    assert.ok(Math.abs(after.bodies[i].x - again.bodies[i].x) < 1e-9, `body ${i} x after reset`);
    assert.ok(Math.abs(after.bodies[i].z - again.bodies[i].z) < 1e-9, `body ${i} z after reset`);
  }
  assert.ok(Math.abs(first.x - after.bodies[0].x) < 1e-9 || Number.isNaN(first.x));
});

test('sun station fades out progressively and is gone once the sun passes it', () => {
  const w = make();
  assert.ok(w.sample(300).bodies[idx(w, 'sun_station')].opacity === 1);
  const mid = w.sample(600).bodies[idx(w, 'sun_station')].opacity;
  assert.ok(mid > 0 && mid < 1, `mid opacity ${mid}`);
  assert.equal(w.sample(700).bodies[idx(w, 'sun_station')].visible, false);
  assert.equal(w.sample(1319).bodies[idx(w, 'sun_station')].visible, false);
});

test('interloper vanishes after the collision and its shell opens on the fitted windows', () => {
  const w = make();
  assert.equal(w.sample(1170).bodies[idx(w, 'interloper')].visible, true);
  assert.equal(w.sample(1190).bodies[idx(w, 'interloper')].visible, false);
  for (const open of w.interloper.openTimes) {
    assert.equal(w.sample(open + 5).bodies[idx(w, 'interloper')].variant, 'open');
    assert.equal(w.sample(open + 45).bodies[idx(w, 'interloper')].variant, 'closed');
    assert.equal(w.sample(open - 5).bodies[idx(w, 'interloper')].variant, 'closed');
  }
});

test('variant timeline matches the event table', () => {
  const w = make();
  assert.equal(w.sample(0.5).bodies[idx(w, 'opc')].variant, 'intact');
  assert.equal(w.sample(2).bodies[idx(w, 'opc')].variant, 'broken');
  assert.equal(w.sample(300).bodies[idx(w, 'stranger')].variant, 'cloaked');
  assert.equal(w.sample(401).bodies[idx(w, 'stranger')].variant, 'sails');
  assert.equal(w.sample(1219).bodies[idx(w, 'ash_twin')].variant, 'full');
  assert.equal(w.sample(1221).bodies[idx(w, 'ash_twin')].variant, 'empty');
  assert.equal(w.sample(100).bodies[idx(w, 'brittle_hollow')].variant, 'intact');
  assert.equal(w.sample(1320).bodies[idx(w, 'brittle_hollow')].variant, 'holed');
});

test('quantum moon jumps only while unobserved and never to the unreachable host', () => {
  const never = { visible: () => false };
  const always = { visible: () => true };
  const w1 = make();
  const hosts = new Set();
  for (let t = 0; t < 400; t += 1) {
    w1.sample(t, never);
    hosts.add(w1.nodeById.get('quantum_moon').hostIndex);
  }
  assert.ok(hosts.size >= 2, 'unobserved moon must migrate');
  assert.ok([...hosts].every((i) => w1.nodeById.get('quantum_moon').hosts[i].reachable !== false), 'must not jump to the Eye');

  const w2 = make();
  const start = w2.nodeById.get('quantum_moon').hostIndex;
  for (let t = 0; t < 400; t += 1) w2.sample(t, always);
  assert.equal(w2.nodeById.get('quantum_moon').hostIndex, start, 'an observed moon must not migrate');
});

test('quantum moon host switching is deterministic for the same observer', () => {
  const never = { visible: () => false };
  const a = make(); const b = make();
  const seqA = [], seqB = [];
  for (let t = 0; t < 600; t += 3) { a.sample(t, never); seqA.push(a.nodeById.get('quantum_moon').hostIndex); }
  for (let t = 0; t < 600; t += 3) { b.sample(t, never); seqB.push(b.nodeById.get('quantum_moon').hostIndex); }
  assert.deepEqual(seqA, seqB);
});

// The renderer bakes one TEXTURE_2D_ARRAY layer per declared variant, so a body
// without `texture` must not name a texture key: the key would be treated as a new
// variant set and bake a layer that is never drawn (the Hourglass Twins barycentre
// is the only such node today).
test('nodes without a declared texture carry no texture key', () => {
  const w = make();
  const f = w.sample(300);
  const declared = new Set();
  for (const d of bodiesDoc.bodies) for (const v of d.texture?.variants || []) declared.add(`${d.texture.key ?? d.id}/${v}`);
  let keyed = 0;
  for (let i = 0; i < f.bodies.length; i++) {
    const b = f.bodies[i];
    if (b.textureKey === null) continue;
    keyed++;
    assert.ok(declared.has(`${b.textureKey}/${b.variant}`), `${b.id} asked for an undeclared layer ${b.textureKey}/${b.variant}`);
  }
  assert.equal(f.bodies[idx(w, 'hourglass_barycentre')].textureKey, null, 'the barycentre is not a textured body');
  assert.equal(keyed, 19, 'every other node resolves to a declared texture');
});

test('particles stay inside the preallocated budget', () => {
  const w = make();
  for (const t of [0, 130, 260, 700, 1175, 1325, 1359]) {
    const f = w.sample(t);
    assert.ok(f.particleCount <= f.particles.length, `t=${t} overflow`);
    assert.ok(f.particleCount >= 0);
  }
  assert.ok(w.sample(200).particleCount > 0, 'sand stream produces particles');
  assert.ok(w.sample(1335).particleCount > 0, 'black hole particle appears after 1330s');
});

test('flags mirror the event table at the boundary seconds', () => {
  const w = make();
  assert.equal(w.sample(119).flags.sandFlowing, false);
  assert.equal(w.sample(121).flags.sandFlowing, true);
  assert.equal(w.sample(1319).flags.endgame, true);
  assert.equal(w.sample(1319).flags.supernova, false);
  assert.equal(w.sample(1321).flags.supernova, true);
  assert.ok(w.sample(1321).sun.flash > 0.5, 'supernova flash at 1321s');
  assert.ok(w.sample(1330).sun.flash === 0, 'flash decays within ~2.5s');
  assert.ok(w.sample(1310).sun.mix > 0.9, 'sun has reddened before the supernova');
  assert.equal(w.sample(1200).sun.mix, 0);
});

test('clock advances, clamps and wraps deterministically', () => {
  const c = createClock({ cycleS: 1360 });
  assert.equal(c.advance(0.1), 0);
  assert.ok(Math.abs(c.t - 0.1) < 1e-9);
  c.advance(99);                                  // clamped to maxStepS
  assert.ok(Math.abs(c.t - 0.35) < 1e-9, `clamped t=${c.t}`);
  c.seek(1359.9);
  assert.equal(c.advance(0.25), 1, 'wrap detected');
  assert.ok(c.t < 1);
  c.setHidden(true);
  c.advance(5);
  assert.ok(c.t < 1, 'paused-loop mode freezes while hidden');
  c.setMode('wall-clock');
  c.setHidden(false, 3600);
  assert.equal(c.pendingResync, true, 'long absence flags a resync (masked jump)');
});
