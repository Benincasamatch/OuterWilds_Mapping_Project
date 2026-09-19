// Procedural texture set for the solar system — Phase 2.
//
// Contract: wallpaper/js/render/CONTRACT.md
//   createTextureSet(gl, bodies, { size, maxLayers }) ->
//     { handle, layerOf(bodyId, variant), layerCount, bytes }
// plus bakeAll(texSet, bodies) so the first drawn frame cannot hitch on a lazy bake.
//
// Layer identity is the pair `${textureKey}/${variant}` (bodies.json `texture.key`);
// body id and `internal` name resolve to the same entry. main.js resolves the layer
// only when a body's variant changes and stores it in frame.bodies[i].layer, so
// layerOf() is a lookup, not a per-frame call. A variant that bodies.json does not
// declare falls back to the body's first layer; only exhausting maxLayers throws.
//
// No external assets, no network, no third-party code: every texel is computed here
// from the body's `texture.palette` (bodies.json, 3 colours) and its body kind.
//
// Determinism: a layer is a pure function of (bodyId, variant, size, palette).
// Same key => same pixels, in every run and on every machine. The 2D canvas is used
// only as the ImageData staging surface (createImageData / putImageData); no canvas
// vector drawing is used, because its antialiasing is implementation-defined and
// would break that guarantee.
//
// Allocation: the canvas, the single reusable ImageData, the trig tables, the PRNG and
// every scratch buffer are allocated in createTextureSet(). Baking a layer allocates
// nothing afterwards, so `bakeAll()` at startup is hitch-free.
//
// Not self-lit: everything here is albedo. Sun light, terminator and rim darkening
// belong to scene.js.
//
// Equirectangular convention: image row 0 => v = 0 => the +Y pole, matching
// makeUvSphere()'s "v = 0 at +Y". Longitude wraps (TEXTURE_WRAP_S = REPEAT). The
// generator's u origin is rotated and mirrored relative to the mesh's u: irrelevant
// for procedural features, but it means a feature's pixel column is not a bodies.json
// longitude.

const TAU = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;
const INV_U32 = 1 / 4294967296;

/** Feature accents. Body identity comes from the palette; these only tint features
 *  that have to read as a different material (glowing seams, comet interior,
 *  gas-giant storm, solar sails, bramble spores). */
const ACCENT = Object.freeze({
  ember: [255, 186, 112],
  hot: [255, 138, 64],
  interior: [46, 34, 30],
  storm: [180, 92, 68],
  spore: [206, 222, 255],
  sail: [214, 232, 238],
  sailEdge: [170, 255, 224],
  white: [255, 255, 255],
});

/** Body appearance, keyed by bodies.json `texture.key`. Unknown keys fall back to
 *  inferKind(). `craters`/`holes`/`axes` are counts, everything else is a flag. */
const KIND_CONFIG = Object.freeze({
  sun: { kind: 'plasma' },
  ash_twin: { kind: 'sand', bands: 15 },
  ember_twin: { kind: 'sand', bands: 18, warm: true },
  timber_hearth: { kind: 'rock', craters: 22, land: true },
  brittle_hollow: { kind: 'rock', craters: 34, holes: 7, flecks: true },
  giants_deep: { kind: 'gas', bands: 9, storm: true },
  dark_bramble: { kind: 'dark', thorns: true },
  interloper: { kind: 'ice', axes: 5 },
  sun_station: { kind: 'metal', pu: 14, pv: 7 },
  white_hole: { kind: 'glow' },
  white_hole_station: { kind: 'metal', pu: 10, pv: 5 },
  stranger: { kind: 'dark', hull: true },
  eye: { kind: 'eye' },
  attlerock: { kind: 'rock', craters: 58, mare: true },
  skyshutter: { kind: 'ice', axes: 4, craters: 12 },
  hollows_lantern: { kind: 'lava', plates: 9 },
  opc: { kind: 'metal', pu: 20, pv: 10, cannon: true },
  nomai_probe: { kind: 'metal', pu: 8, pv: 4, probe: true },
  quantum_moon: { kind: 'rock', craters: 26, cap: true },
});

const DEFAULT_CONFIG = Object.freeze({ kind: 'rock', craters: 30 });
const DEFAULT_PALETTE = Object.freeze(['#9a9aa2', '#5b5b66', '#2a2a33']);

/** Variant semantics. Variant names that are not listed here still bake their own
 *  layer (their noise seed differs); they just share the plain look. */
const VARIANT_FLAGS = Object.freeze({
  default: Object.freeze({}),
  intact: Object.freeze({}),
  closed: Object.freeze({}),
  cloaked: Object.freeze({}),
  full: Object.freeze({ full: true }),
  empty: Object.freeze({ empty: true }),
  holed: Object.freeze({ holed: true }),
  open: Object.freeze({ open: true }),
  broken: Object.freeze({ broken: true }),
  sails: Object.freeze({ sails: true }),
  engulfed: Object.freeze({ engulfed: true }),
});

const MAX_CRATERS = 96;
const MAX_HOLES = 8;
const MAX_AXES = 6;
const SAIL_SECTORS = 6;

// ---------------------------------------------------------------------------
// PRNG + value noise (deterministic, allocation-free)
// ---------------------------------------------------------------------------

/** mulberry32, reseedable so one instance serves every layer. */
function createPrng(seed) {
  let a = seed >>> 0;
  return {
    seed(s) {
      a = s >>> 0;
    },
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) * INV_U32;
    },
  };
}

/** FNV-1a: stable seed from a layer key. */
function hashKey(key, salt) {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

function hash3i(x, y, z, seed) {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) * INV_U32;
}

function hash2i(x, y, seed) {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return ((h ^ (h >>> 16)) >>> 0) * INV_U32;
}

/** 3D value noise on a cubic lattice — sampled with unit sphere directions it is
 *  automatically seamless in longitude and free of polar pinching. */
function noise3(x, y, z, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const c000 = hash3i(xi, yi, zi, seed);
  const c100 = hash3i(xi + 1, yi, zi, seed);
  const c010 = hash3i(xi, yi + 1, zi, seed);
  const c110 = hash3i(xi + 1, yi + 1, zi, seed);
  const c001 = hash3i(xi, yi, zi + 1, seed);
  const c101 = hash3i(xi + 1, yi, zi + 1, seed);
  const c011 = hash3i(xi, yi + 1, zi + 1, seed);
  const c111 = hash3i(xi + 1, yi + 1, zi + 1, seed);
  const a = c000 + (c100 - c000) * u;
  const b = c010 + (c110 - c010) * u;
  const c = c001 + (c101 - c001) * u;
  const d = c011 + (c111 - c011) * u;
  const e = a + (b - a) * v;
  const f = c + (d - c) * v;
  return e + (f - e) * w;
}

/** Fractal sum, normalised to 0..1. */
function fbm3(x, y, z, octaves, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x * f, y * f, z * f, seed + o * 131);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** Ridged fractal, 0..1: thin bright ridges = crack / thorn networks. */
function ridge3(x, y, z, octaves, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    const n = noise3(x * f, y * f, z * f, seed + o * 977);
    const r = 1 - Math.abs(2 * n - 1);
    sum += amp * r;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

function smoothstep(edge0, edge1, x) {
  let t = (x - edge0) / (edge1 - edge0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

function hexToRgb(hex, out, off) {
  const s = typeof hex === 'string' ? hex : '#808080';
  const n = parseInt(s.charCodeAt(0) === 35 ? s.slice(1) : s, 16);
  const v = n >>> 0;
  out[off] = (v >> 16) & 255;
  out[off + 1] = (v >> 8) & 255;
  out[off + 2] = v & 255;
}

/** Parse 3 hex colours and sort them by luma into light / mid / dark, so painters
 *  never have to assume the data file lists them in any particular order. */
function fillPalette(dst, hexes) {
  const list = Array.isArray(hexes) && hexes.length >= 3 ? hexes : DEFAULT_PALETTE;
  const tmp = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    const rgb = [0, 0, 0];
    hexToRgb(list[i], rgb, 0);
    tmp[i][0] = rgb[0];
    tmp[i][1] = rgb[1];
    tmp[i][2] = rgb[2];
    tmp[i][3] = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  }
  tmp.sort((a, b) => b[3] - a[3]);
  for (let i = 0; i < 3; i++) {
    dst[i * 3] = tmp[i][0];
    dst[i * 3 + 1] = tmp[i][1];
    dst[i * 3 + 2] = tmp[i][2];
  }
  return dst;
}

// ---------------------------------------------------------------------------
// Scratch: everything a bake needs, allocated once
// ---------------------------------------------------------------------------

function createJob(w, h, out) {
  const cosLon = new Float64Array(w);
  const sinLon = new Float64Array(w);
  const lonStep = TAU / w;
  for (let x = 0; x < w; x++) {
    const lon = (x + 0.5) * lonStep - Math.PI;
    cosLon[x] = Math.cos(lon);
    sinLon[x] = Math.sin(lon);
  }
  return {
    w,
    h,
    out: out || new Uint8ClampedArray(w * h * 4),
    cosLon,
    sinLon,
    lonStep,
    pal: new Float32Array(9),
    craters: new Float32Array(MAX_CRATERS * 4),
    holes: new Float32Array(MAX_HOLES * 4),
    axes: new Float32Array(MAX_AXES * 3),
    sectors: new Float32Array(SAIL_SECTORS * 3),
    basis: new Float64Array(9 * 4),
    misc: new Float64Array(4),
    rng: createPrng(0),
    // per-bake
    cfg: DEFAULT_CONFIG,
    flags: VARIANT_FLAGS.default,
    seed: 0,
  };
}

/** Unit centre + east + north frame for a lon/lat feature (9 doubles at `off`). */
function featureBasis(dst, off, lon, lat) {
  const cl = Math.cos(lat);
  const sl = Math.sin(lat);
  const co = Math.cos(lon);
  const so = Math.sin(lon);
  const cx = cl * co;
  const cy = sl;
  const cz = cl * so;
  const ex = -so;
  const ez = co;
  dst[off] = cx;
  dst[off + 1] = cy;
  dst[off + 2] = cz;
  dst[off + 3] = ex;
  dst[off + 4] = 0;
  dst[off + 5] = ez;
  // north = east x centre
  dst[off + 6] = -ez * cy;
  dst[off + 7] = ez * cx - ex * cz;
  dst[off + 8] = ex * cy;
}

function makeCraters(p, count) {
  const c = p.craters;
  const rng = p.rng;
  for (let i = 0; i < count; i++) {
    const z = rng.next() * 2 - 1;
    const a = rng.next() * TAU;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const j = i * 4;
    c[j] = r * Math.cos(a);
    c[j + 1] = z;
    c[j + 2] = r * Math.sin(a);
    c[j + 3] = 0.07 + rng.next() * 0.16;
  }
}

function makeHoles(p, count, seed) {
  const c = p.holes;
  const rng = p.rng;
  for (let i = 0; i < count; i++) {
    const z = rng.next() * 2 - 1;
    const a = rng.next() * TAU;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const j = i * 4;
    c[j] = r * Math.cos(a);
    c[j + 1] = z;
    c[j + 2] = r * Math.sin(a);
    c[j + 3] = 0.11 + hash2i(i, 7, seed) * 0.16;
  }
}

/** Great-circle rifts (crack normals). */
function makeAxes(p, count) {
  const a = p.axes;
  const rng = p.rng;
  for (let i = 0; i < count; i++) {
    const z = rng.next() * 2 - 1;
    const t = rng.next() * TAU;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const j = i * 3;
    a[j] = r * Math.cos(t);
    a[j + 1] = z;
    a[j + 2] = r * Math.sin(t);
  }
}

function makeSectors(p, count) {
  const s = p.sectors;
  for (let k = 0; k < count; k++) {
    const lon = (k / count) * TAU - Math.PI;
    s[k * 3] = Math.cos(lon);
    s[k * 3 + 1] = 0;
    s[k * 3 + 2] = Math.sin(lon);
  }
}

/** Analytic crater shading over the pre-baked centres.
 *  p.misc[0] = floor darkening 0..1, p.misc[1] = rim brightening 0..1. */
function craterInk(p, count, nx, ny, nz) {
  const c = p.craters;
  let dark = 0;
  let rim = 0;
  for (let i = 0; i < count; i++) {
    const j = i * 4;
    const d = nx * c[j] + ny * c[j + 1] + nz * c[j + 2];
    if (d <= 0.2) continue;
    const ang = Math.sqrt(2 * (1 - d)); // small-angle approximation of acos(d)
    const rad = c[j + 3];
    if (ang >= rad) continue;
    const t = ang / rad;
    if (t < 0.72) {
      const v = 1 - t / 0.72;
      const a = v * v;
      if (a > dark) dark = a;
    } else {
      const v = 1 - Math.abs(t - 0.86) / 0.14;
      if (v > rim) rim = v;
    }
  }
  p.misc[0] = dark;
  p.misc[1] = rim;
}

// ---------------------------------------------------------------------------
// Painters
//
// Every painter runs the same skeleton: row-major pixel loop, unit sphere
// direction from the pre-computed trig tables, palette-role colours, write RGBA.
// ---------------------------------------------------------------------------

/** Sun: granulation + sunspot patches. scene.js draws the sun procedurally, but a
 *  layer exists in case a body list ever asks for the key. */
function paintPlasma(p) {
  const w = p.w;
  const h = p.h;
  const out = p.out;
  const pal = p.pal;
  const cl = p.cosLon;
  const sl = p.sinLon;
  const lr = pal[0];
  const lg = pal[1];
  const lb = pal[2];
  const mr = pal[3];
  const mg = pal[4];
  const mb = pal[5];
  const dr = pal[6];
  const dg = pal[7];
  const db = pal[8];
  const seed = p.seed;
  const invH = 1 / h;
  let i = 0;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) * invH) * Math.PI;
    const ny = Math.sin(lat);
    const ring = Math.cos(lat);
    for (let x = 0; x < w; x++) {
      const nx = ring * cl[x];
      const nz = ring * sl[x];
      const cell = fbm3(nx * 3.6, ny * 3.6, nz * 3.6, 4, seed);
      const grain = fbm3(nx * 16, ny * 16, nz * 16, 3, seed + 17);
      const k = smoothstep(0.34, 0.72, cell + (grain - 0.5) * 0.22);
      let r = mr + (lr - mr) * k;
      let g = mg + (lg - mg) * k;
      let b = mb + (lb - mb) * k;
      const spot = smoothstep(0.34, 0.24, fbm3(nx * 1.7, ny * 1.7, nz * 1.7, 3, seed + 91));
      if (spot > 0) {
        r += (dr * 0.6 - r) * spot;
        g += (dg * 0.6 - g) * spot;
        b += (db * 0.6 - b) * spot;
      }
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
      i += 4;
    }
  }
}

/** Rock worlds: Timber Hearth, Brittle Hollow, Attlerock, Quantum Moon. */
function paintRock(p) {
  const w = p.w;
  const h = p.h;
  const out = p.out;
  const pal = p.pal;
  const cfg = p.cfg;
  const flags = p.flags;
  const cl = p.cosLon;
  const sl = p.sinLon;
  const lr = pal[0];
  const lg = pal[1];
  const lb = pal[2];
  const mr = pal[3];
  const mg = pal[4];
  const mb = pal[5];
  const dr = pal[6];
  const dg = pal[7];
  const db = pal[8];
  const seed = p.seed;
  const invH = 1 / h;
  const nCrater = Math.min(cfg.craters | 0, MAX_CRATERS);
  if (nCrater > 0) makeCraters(p, nCrater);
  const nHole = flags.holed === true ? Math.min(cfg.holes | 0, MAX_HOLES) : 0;
  if (nHole > 0) makeHoles(p, nHole, seed);
  const land = cfg.land === true;
  const mare = cfg.mare === true;
  const flecks = cfg.flecks === true;
  const cap = cfg.cap === true;
  let i = 0;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) * invH) * Math.PI;
    const ny = Math.sin(lat);
    const ring = Math.cos(lat);
    for (let x = 0; x < w; x++) {
      const nx = ring * cl[x];
      const nz = ring * sl[x];
      const base = fbm3(nx * 2.3, ny * 2.3, nz * 2.3, 4, seed);
      const grain = fbm3(nx * 9, ny * 9, nz * 9, 3, seed + 101);
      const k = smoothstep(0, 1, (base - 0.34) * 1.5 + (grain - 0.5) * 0.5);
      let r = mr + (lr - mr) * k;
      let g = mg + (lg - mg) * k;
      let b = mb + (lb - mb) * k;

      if (land) {
        // Continents: brown highlands above, darker green lowlands below.
        const bio = fbm3(nx * 1.7, ny * 1.7, nz * 1.7, 3, seed + 53);
        const hi = smoothstep(0.5, 0.72, bio) * 0.75;
        const lo = smoothstep(0.5, 0.28, bio) * 0.8;
        r += (lr - r) * hi + (dr - r) * lo;
        g += (lg - g) * hi + (dg - g) * lo;
        b += (lb - b) * hi + (db - b) * lo;
      }
      if (mare) {
        const m = smoothstep(0.46, 0.36, fbm3(nx * 1.5, ny * 1.5, nz * 1.5, 3, seed + 211));
        r += (dr - r) * m * 0.7;
        g += (dg - g) * m * 0.7;
        b += (db - b) * m * 0.7;
      }
      if (cap) {
        const c = smoothstep(0.84, 0.95, Math.abs(ny) + (grain - 0.5) * 0.08);
        r += (lr - r) * c * 0.55;
        g += (lg - g) * c * 0.55;
        b += (lb - b) * c * 0.55;
      }
      if (nCrater > 0) {
        craterInk(p, nCrater, nx, ny, nz);
        const dark = p.misc[0];
        const rim = p.misc[1];
        if (dark > 0) {
          r += (dr - r) * dark * 0.85;
          g += (dg - g) * dark * 0.85;
          b += (db - b) * dark * 0.85;
        }
        if (rim > 0) {
          r += (lr * 1.08 - r) * rim * 0.6;
          g += (lg * 1.08 - g) * rim * 0.6;
          b += (lb * 1.08 - b) * rim * 0.6;
        }
      }
      if (flecks) {
        const fl = smoothstep(0.8, 0.92, fbm3(nx * 20, ny * 20, nz * 20, 2, seed + 307));
        if (fl > 0) {
          r += (lr * 1.12 - r) * fl;
          g += (lg * 1.12 - g) * fl;
          b += (lb * 1.12 - b) * fl;
        }
      }
      for (let c = 0; c < nHole; c++) {
        const j = c * 4;
        const d = nx * p.holes[j] + ny * p.holes[j + 1] + nz * p.holes[j + 2];
        if (d <= 0.2) continue;
        const ang = Math.sqrt(2 * (1 - d));
        const rad = p.holes[j + 3];
        if (ang >= rad) continue;
        const t = 1 - ang / rad;
        // Plateau, not a gradient: a breach in the crust shows the black hole under it.
        const hole = smoothstep(0.15, 0.55, t);
        r += (6 - r) * hole;
        g += (5 - g) * hole;
        b += (8 - b) * hole;
        const rim = smoothstep(0.5, 0.72, t) - smoothstep(0.72, 0.92, t);
        r += (lr * 1.2 - r) * rim * 0.9;
        g += (lg * 1.2 - g) * rim * 0.9;
        b += (lb * 1.2 - b) * rim * 0.9;
      }
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
      i += 4;
    }
  }
}

/** Gas giant: latitude belts + one anticyclonic storm. */
function paintGas(p) {
  const w = p.w;
  const h = p.h;
  const out = p.out;
  const pal = p.pal;
  const cfg = p.cfg;
  const cl = p.cosLon;
  const sl = p.sinLon;
  const lr = pal[0];
  const lg = pal[1];
  const lb = pal[2];
  const mr = pal[3];
  const mg = pal[4];
  const mb = pal[5];
  const dr = pal[6];
  const dg = pal[7];
  const db = pal[8];
  const seed = p.seed;
  const invH = 1 / h;
  const bands = cfg.bands || 9;
  const basis = p.basis;
  if (cfg.storm === true) featureBasis(basis, 0, 2.3, -0.34);
  const sx = basis[0];
  const sy = basis[1];
  const sz = basis[2];
  const ex = basis[3];
  const ey = basis[4];
  const ez = basis[5];
  const nxv = basis[6];
  const nyv = basis[7];
  const nzv = basis[8];
  const stormR = 0.46;
  let i = 0;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) * invH) * Math.PI;
    const ny = Math.sin(lat);
    const ring = Math.cos(lat);
    for (let x = 0; x < w; x++) {
      const nx = ring * cl[x];
      const nz = ring * sl[x];
      const warp = fbm3(nx * 1.1, ny * 1.1, nz * 1.1, 3, seed) - 0.5;
      const s = Math.sin((ny * bands + warp * 2.8) * 2.1);
      const t = smoothstep(0, 1, (s + 1) * 0.5);
      let r = mr + (lr - mr) * t;
      let g = mg + (lg - mg) * t;
      let b = mb + (lb - mb) * t;
      const belt = 1 - Math.abs(s);
      const beltK = smoothstep(0.45, 1, belt) * 0.42;
      r += (dr - r) * beltK;
      g += (dg - g) * beltK;
      b += (db - b) * beltK;
      const fil = (fbm3(nx * 7, ny * 2.4, nz * 7, 3, seed + 13) - 0.5) * 30;
      r += fil;
      g += fil * 0.95;
      b += fil * 1.05;

      const dcz = nx * sx + ny * sy + nz * sz;
      if (dcz > 0.15) {
        const dx = (nx * ex + ny * ey + nz * ez) / (stormR * 1.85);
        const dy = (nx * nxv + ny * nyv + nz * nzv) / stormR;
        const rr = Math.sqrt(dx * dx + dy * dy);
        if (rr < 1) {
          const ang = Math.atan2(dy, dx) + rr * 6.5;
          const swirl = 0.5 + 0.5 * Math.sin(ang * 3);
          const body = smoothstep(1, 0.72, rr);
          const hot = ACCENT.storm;
          r += (hot[0] * (0.75 + swirl * 0.25) - r) * body;
          g += (hot[1] * (0.7 + swirl * 0.3) - g) * body;
          b += (hot[2] * (0.7 + swirl * 0.3) - b) * body;
          const eye = smoothstep(0.34, 0.05, rr);
          r += (lr * 0.9 - r) * eye * 0.5;
          g += (lg * 0.9 - g) * eye * 0.5;
          b += (lb * 0.9 - b) * eye * 0.5;
        }
      }
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
      i += 4;
    }
  }
}

/** Ice shells: the Interloper and the Sky Shutter satellite. */
function paintIce(p) {
  const w = p.w;
  const h = p.h;
  const out = p.out;
  const pal = p.pal;
  const cfg = p.cfg;
  const flags = p.flags;
  const cl = p.cosLon;
  const sl = p.sinLon;
  const lr = pal[0];
  const lg = pal[1];
  const lb = pal[2];
  const mr = pal[3];
  const mg = pal[4];
  const mb = pal[5];
  const dr = pal[6];
  const dg = pal[7];
  const db = pal[8];
  const seed = p.seed;
  const invH = 1 / h;
  const nCrater = Math.min(cfg.craters | 0, MAX_CRATERS);
  if (nCrater > 0) makeCraters(p, nCrater);
  const open = flags.open === true;
  // A closed shell is hairline-cracked; an open one splits along a few major rifts
  // that expose the interior.
  const nAxes = Math.min(open ? 3 : cfg.axes | 0, MAX_AXES);
  if (nAxes > 0) makeAxes(p, nAxes);
  const wide = open ? 0.1 : 0.02;
  let i = 0;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) * invH) * Math.PI;
    const ny = Math.sin(lat);
    const ring = Math.cos(lat);
    for (let x = 0; x < w; x++) {
      const nx = ring * cl[x];
      const nz = ring * sl[x];
      const base = fbm3(nx * 3.1, ny * 3.1, nz * 3.1, 4, seed);
      const k = smoothstep(0, 1, (base - 0.28) * 1.45);
      let r = mr + (lr - mr) * k;
      let g = mg + (lg - mg) * k;
      let b = mb + (lb - mb) * k;
      const frost = smoothstep(0.72, 0.86, fbm3(nx * 24, ny * 24, nz * 24, 2, seed + 9));
      if (frost > 0) {
        r += (ACCENT.white[0] - r) * frost * 0.4;
        g += (ACCENT.white[1] - g) * frost * 0.4;
        b += (ACCENT.white[2] - b) * frost * 0.4;
      }
      const rg = ridge3(nx * 6.2, ny * 6.2, nz * 6.2, 4, seed + 21);
      if (rg > 0.78) {
        const t = (rg - 0.78) / 0.22;
        r += (dr - r) * t * 0.85;
        g += (dg - g) * t * 0.85;
        b += (db - b) * t * 0.85;
      } else if (rg > 0.66) {
        const t = ((rg - 0.66) / 0.12) * 0.45;
        r += (lr * 1.1 - r) * t;
        g += (lg * 1.1 - g) * t;
        b += (lb * 1.1 - b) * t;
      }
      const jag = (fbm3(nx * 5.5, ny * 5.5, nz * 5.5, 2, seed + 33) - 0.5) * 0.03;
      for (let c = 0; c < nAxes; c++) {
        const j = c * 3;
        const d = Math.abs(nx * p.axes[j] + ny * p.axes[j + 1] + nz * p.axes[j + 2]) + jag;
        if (d < wide) {
          const t = 1 - d / wide;
          r += (dr - r) * t * 0.9;
          g += (dg - g) * t * 0.9;
          b += (db - b) * t * 0.9;
          if (open) {
            r += (ACCENT.interior[0] - r) * t * 0.8;
            g += (ACCENT.interior[1] - g) * t * 0.8;
            b += (ACCENT.interior[2] - b) * t * 0.8;
          }
        } else if (d < wide * 2.1) {
          const t = (1 - (d - wide) / (wide * 1.1)) * 0.6;
          r += (ACCENT.white[0] - r) * t;
          g += (ACCENT.white[1] - g) * t;
          b += (ACCENT.white[2] - b) * t;
        }
      }
      if (nCrater > 0) {
        craterInk(p, nCrater, nx, ny, nz);
        const dark = p.misc[0] * 0.7;
        const rim = p.misc[1] * 0.5;
        if (dark > 0) {
          r += (dr - r) * dark;
          g += (dg - g) * dark;
          b += (db - b) * dark;
        }
        if (rim > 0) {
          r += (ACCENT.white[0] - r) * rim;
          g += (ACCENT.white[1] - g) * rim;
          b += (ACCENT.white[2] - b) * rim;
        }
      }
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
      i += 4;
    }
  }
}

/** Hollow's Lantern: basalt plates with molten fissures. */
function paintLava(p) {
  const w = p.w;
  const h = p.h;
  const out = p.out;
  const pal = p.pal;
  const cfg = p.cfg;
  const cl = p.cosLon;
  const sl = p.sinLon;
  const lr = pal[0];
  const lg = pal[1];
  const lb = pal[2];
  const mr = pal[3];
  const mg = pal[4];
  const mb = pal[5];
  const dr = pal[6];
  const dg = pal[7];
  const db = pal[8];
  const seed = p.seed;
  const invH = 1 / h;
  const plates = cfg.plates || 9;
  let i = 0;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) * invH) * Math.PI;
    const ny = Math.sin(lat);
    const ring = Math.cos(lat);
    const vv = (1 - (y + 0.5) * invH) * plates * 0.5;
    const row = Math.floor(vv);
    const fv = vv - row;
    for (let x = 0; x < w; x++) {
      const nx = ring * cl[x];
      const nz = ring * sl[x];
      const base = fbm3(nx * 2.8, ny * 2.8, nz * 2.8, 3, seed);
      let r = dr + (mr - dr) * base;
      let g = dg + (mg - dg) * base;
      let b = db + (mb - db) * base;
      const uu = (x + 0.5) / w * plates + (row & 1) * 0.5;
      const iu = Math.floor(uu);
      const fu = uu - iu;
      const tone = (hash2i(iu, row, seed + 5) - 0.5) * 0.22;
      r += r * tone;
      g += g * tone;
      b += b * tone;
      const seam = Math.max(1 - Math.min(fu, 1 - fu) / 0.04, 1 - Math.min(fv, 1 - fv) / 0.05);
      if (seam > 0) {
        r += (dr * 0.5 - r) * seam;
        g += (dg * 0.5 - g) * seam;
        b += (db * 0.5 - b) * seam;
      }
      const pool = smoothstep(0.6, 0.78, fbm3(nx * 1.5, ny * 1.5, nz * 1.5, 3, seed + 61));
      const rg = ridge3(nx * 7.4, ny * 7.4, nz * 7.4, 5, seed + 31);
      const glow = Math.max(pool, smoothstep(0.7, 0.93, rg));
      if (glow > 0) {
        r += (lr - r) * glow * 0.95;
        g += (lg - g) * glow * 0.95;
        b += (lb - b) * glow * 0.95;
      }
      const halo = smoothstep(0.48, 0.95, rg) * 0.28;
      if (halo > 0) {
        r += ACCENT.ember[0] * halo;
        g += ACCENT.ember[1] * halo;
        b += ACCENT.ember[2] * halo;
      }
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
      i += 4;
    }
  }
}

/** Manufactured hulls: Sun Station, Orbital Probe Cannon, White Hole Station,
 *  Nomai probe. Plated metal + rivets, with variant damage. */
function paintMetal(p) {
  const w = p.w;
  const h = p.h;
  const out = p.out;
  const pal = p.pal;
  const cfg = p.cfg;
  const flags = p.flags;
  const cl = p.cosLon;
  const sl = p.sinLon;
  const lr = pal[0];
  const lg = pal[1];
  const lb = pal[2];
  const mr = pal[3];
  const mg = pal[4];
  const mb = pal[5];
  const dr = pal[6];
  const dg = pal[7];
  const db = pal[8];
  const seed = p.seed;
  const invH = 1 / h;
  const lonStep = p.lonStep;
  const pu = cfg.pu || 12;
  const pv = cfg.pv || 6;
  const cannon = cfg.cannon === true;
  const probe = cfg.probe === true;
  const broken = flags.broken === true;
  const engulfed = flags.engulfed === true;
  const basis = p.basis;
  featureBasis(basis, 0, 1.15, 0.32);
  featureBasis(basis, 9, -0.7, -0.2);
  const ax = basis[0];
  const ay = basis[1];
  const az = basis[2];
  const tex = basis[3];
  const tey = basis[4];
  const tez = basis[5];
  const tnx = basis[6];
  const tny = basis[7];
  const tnz = basis[8];
  const fx = basis[9];
  const fy = basis[10];
  const fz = basis[11];
  let i = 0;
  for (let y = 0; y < h; y++) {
    const lat = HALF_PI - (y + 0.5) * invH * Math.PI;
    const ny = Math.sin(lat);
    const ring = Math.cos(lat);
    const vv = (1 - (y + 0.5) * invH) * pv;
    let row = Math.floor(vv);
    if (row >= pv) row = pv - 1;
    const fv = vv - row;
    for (let x = 0; x < w; x++) {
      const nx = ring * cl[x];
      const nz = ring * sl[x];
      const lon = (x + 0.5) * lonStep - Math.PI;
      const uu = ((x + 0.5) / w) * pu + (row & 1) * 0.5;
      const iu = Math.floor(uu);
      const fu = uu - iu;
      const tone = hash2i(iu, row, seed);
      const shade = 0.24 + tone * 0.56;
      let r = mr + (lr - mr) * shade;
      let g = mg + (lg - mg) * shade;
      let b = mb + (lb - mb) * shade;
      const su = Math.min(fu, 1 - fu);
      const sv = Math.min(fv, 1 - fv);
      let seam = 0;
      if (su < 0.035) seam = 1 - su / 0.035;
      if (sv < 0.06) {
        const t = 1 - sv / 0.06;
        if (t > seam) seam = t;
      }
      if (seam > 0) {
        r += (dr - r) * seam * 0.8;
        g += (dg - g) * seam * 0.8;
        b += (db - b) * seam * 0.8;
      }
      if (Math.abs(fu - 0.1) < 0.045 && Math.abs(fv - 0.14) < 0.07) {
        r += (lr * 1.1 - r) * 0.45;
        g += (lg * 1.1 - g) * 0.45;
        b += (lb * 1.1 - b) * 0.45;
      }
      const brush = (fbm3(nx * 26, ny * 26, nz * 26, 2, seed + 5) - 0.5) * 16;
      r += brush;
      g += brush;
      b += brush;

      for (let c = 0; c < 2; c++) {
        const j = c * 9;
        const d = Math.abs(nx * basis[j] + ny * basis[j + 1] + nz * basis[j + 2]);
        if (d < 0.018) {
          r += (lr * 1.12 - r) * 0.7;
          g += (lg * 1.12 - g) * 0.7;
          b += (lb * 1.12 - b) * 0.7;
        } else if (d < 0.05) {
          const t = (1 - (d - 0.018) / 0.032) * 0.4;
          r += (dr - r) * t;
          g += (dg - g) * t;
          b += (db - b) * t;
        }
      }

      if (cannon) {
        const d = Math.abs(nx * ax + ny * ay + nz * az);
        if (d < 0.26) {
          const q = nx * tex + ny * tey + nz * tez;
          const s2 = nx * tnx + ny * tny + nz * tnz;
          const ang = Math.atan2(s2, q);
          const e = d / 0.26;
          const lit = 0.62 + 0.38 * Math.sqrt(1 - e * e) + 0.12 * Math.sin(ang * 14);
          r += (lr * lit - r) * 0.8;
          g += (lg * lit - g) * 0.8;
          b += (lb * lit - b) * 0.8;
          if (Math.abs(Math.sin(ang * 7)) > 0.94) {
            r += (dr - r) * 0.5;
            g += (dg - g) * 0.5;
            b += (db - b) * 0.5;
          }
        }
      }
      if (probe) {
        const sp = Math.sin(lon * 3 + lat * 17 + fbm3(nx * 3, ny * 3, nz * 3, 3, seed + 9) * 2.5);
        const t = smoothstep(0.62, 0.92, sp);
        if (t > 0) {
          r += (lr - r) * t * 0.9;
          g += (lg - g) * t * 0.9;
          b += (lb - b) * t * 0.9;
        } else {
          const d2 = smoothstep(0.3, -0.4, sp);
          r += (dr - r) * d2 * 0.6;
          g += (dg - g) * d2 * 0.6;
          b += (db - b) * d2 * 0.6;
        }
      }
      if (broken) {
        const jag = (fbm3(nx * 11, ny * 11, nz * 11, 3, seed + 13) - 0.5) * 0.05;
        const d = Math.abs(nx * ax + ny * ay + nz * az) + jag;
        if (d < 0.04) {
          r += (dr * 0.3 - r) * 0.95;
          g += (dg * 0.3 - g) * 0.95;
          b += (db * 0.3 - b) * 0.95;
        } else if (d < 0.1) {
          const fold = nx * fx + ny * fy + nz * fz > 0 ? 1.25 : 0.7;
          const t = (1 - (d - 0.04) / 0.06) * 0.75;
          r += (lr * fold - r) * t;
          g += (lg * fold - g) * t;
          b += (lb * fold - b) * t;
        }
      }
      if (engulfed) {
        const soot = fbm3(nx * 2.6, ny * 2.6, nz * 2.6, 4, seed + 77);
        const s = 0.45 + soot * 0.4;
        r += (dr * 0.45 - r) * s;
        g += (dg * 0.45 - g) * s;
        b += (db * 0.45 - b) * s;
        if (seam > 0) {
          const t = seam * 0.8 + 0.15;
          r += (ACCENT.hot[0] - r) * t;
          g += (ACCENT.hot[1] - g) * t;
          b += (ACCENT.hot[2] - b) * t;
        }
        const heat = (1 - Math.abs(ny)) * 0.22;
        r += ACCENT.hot[0] * heat;
        g += ACCENT.hot[1] * heat * 0.7;
        b += ACCENT.hot[2] * heat * 0.4;
      }
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
      i += 4;
    }
  }
}

/** Dark worlds: Dark Bramble thorn mass, and the Stranger's hull / solar sails. */
function paintDark(p) {
  const w = p.w;
  const h = p.h;
  const out = p.out;
  const pal = p.pal;
  const cfg = p.cfg;
  const flags = p.flags;
  const cl = p.cosLon;
  const sl = p.sinLon;
  const lr = pal[0];
  const lg = pal[1];
  const lb = pal[2];
  const mr = pal[3];
  const mg = pal[4];
  const mb = pal[5];
  const dr = pal[6];
  const dg = pal[7];
  const db = pal[8];
  const seed = p.seed;
  const invH = 1 / h;
  const thorns = cfg.thorns === true;
  const hull = cfg.hull === true;
  const sails = flags.sails === true;
  const pu = 10;
  const pv = 4;
  if (sails) makeSectors(p, SAIL_SECTORS);
  let i = 0;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) * invH) * Math.PI;
    const ny = Math.sin(lat);
    const ring = Math.cos(lat);
    const vv = (1 - (y + 0.5) * invH) * pv;
    let row = Math.floor(vv);
    if (row >= pv) row = pv - 1;
    const fv = vv - row;
    for (let x = 0; x < w; x++) {
      const nx = ring * cl[x];
      const nz = ring * sl[x];
      const base = fbm3(nx * 2.4, ny * 2.4, nz * 2.4, 4, seed);
      let r = dr + (mr - dr) * (base * 0.95);
      let g = dg + (mg - dg) * (base * 0.95);
      let b = db + (mb - db) * (base * 0.95);

      if (thorns) {
        const rg = ridge3(nx * 5.2, ny * 5.2, nz * 5.2, 5, seed + 41);
        const t = smoothstep(0.52, 0.9, rg);
        if (t > 0) {
          r += (lr - r) * t * 0.85;
          g += (lg - g) * t * 0.85;
          b += (lb - b) * t * 0.85;
        }
        const pod = smoothstep(0.68, 0.82, fbm3(nx * 2, ny * 2, nz * 2, 3, seed + 71));
        if (pod > 0) {
          r += (ACCENT.spore[0] - r) * pod * 0.35;
          g += (ACCENT.spore[1] - g) * pod * 0.35;
          b += (ACCENT.spore[2] - b) * pod * 0.35;
        }
        const shade = 0.72 + base * 0.42;
        r *= shade;
        g *= shade;
        b *= shade;
      }

      if (hull) {
        const uu = ((x + 0.5) / w) * pu + (row & 1) * 0.5;
        const iu = Math.floor(uu);
        const fu = uu - iu;
        const tone = 0.3 + hash2i(iu, row, seed) * 0.5;
        r += (mr + (lr - mr) * tone - r) * 0.55;
        g += (mg + (lg - mg) * tone - g) * 0.55;
        b += (mb + (lb - mb) * tone - b) * 0.55;
        const su = Math.min(fu, 1 - fu);
        const sv = Math.min(fv, 1 - fv);
        const seam = Math.max(su < 0.03 ? 1 - su / 0.03 : 0, sv < 0.05 ? 1 - sv / 0.05 : 0);
        if (seam > 0) {
          r += (dr - r) * seam * 0.85;
          g += (dg - g) * seam * 0.85;
          b += (db - b) * seam * 0.85;
        }
        if (sails) {
          const uu2 = ((x + 0.5) / w) * pu;
          const lu = uu2 - Math.floor(uu2);
          let lit = 0;
          for (let k = 0; k < SAIL_SECTORS; k++) {
            const j = k * 3;
            const dot = nx * p.sectors[j] + ny * p.sectors[j + 1] + nz * p.sectors[j + 2];
            const s = smoothstep(0.05, 0.72, dot);
            if (s > lit) lit = s;
          }
          const panel = 0.55 + lit * 0.4;
          r += (ACCENT.sail[0] * panel - r) * 0.75;
          g += (ACCENT.sail[1] * panel - g) * 0.75;
          b += (ACCENT.sail[2] * panel - b) * 0.75;
          const ds = Math.sin((lu * 7 + fv * 3) * TAU);
          if (ds > 0.86) {
            r += (dr - r) * 0.6;
            g += (dg - g) * 0.6;
            b += (db - b) * 0.6;
          }
          const edge = smoothstep(0.9, 0.99, lit);
          if (edge > 0) {
            r += (ACCENT.sailEdge[0] - r) * edge * 0.6;
            g += (ACCENT.sailEdge[1] - g) * edge * 0.6;
            b += (ACCENT.sailEdge[2] - b) * edge * 0.6;
          }
        }
      }
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
      i += 4;
    }
  }
}

/** Hourglass Twins: wind-carved dunes. `full` = sand-choked, `empty` = bare rock. */
function paintSand(p) {
  const w = p.w;
  const h = p.h;
  const out = p.out;
  const pal = p.pal;
  const cfg = p.cfg;
  const flags = p.flags;
  const cl = p.cosLon;
  const sl = p.sinLon;
  const lr = pal[0];
  const lg = pal[1];
  const lb = pal[2];
  const mr = pal[3];
  const mg = pal[4];
  const mb = pal[5];
  const dr = pal[6];
  const dg = pal[7];
  const db = pal[8];
  const seed = p.seed;
  const invH = 1 / h;
  const bands = cfg.bands || 15;
  const full = flags.full === true;
  const empty = flags.empty === true;
  let i = 0;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) * invH) * Math.PI;
    const ny = Math.sin(lat);
    const ring = Math.cos(lat);
    for (let x = 0; x < w; x++) {
      const nx = ring * cl[x];
      const nz = ring * sl[x];
      const warp = fbm3(nx * 1.7, ny * 1.7, nz * 1.7, 3, seed) - 0.5;
      const s = Math.sin((ny * bands + warp * 3.2) * 1.6);
      const t = smoothstep(0, 1, (s + 1) * 0.5);
      let sr = mr + (lr - mr) * t;
      let sg = mg + (lg - mg) * t;
      let sb = mb + (lb - mb) * t;
      const trough = smoothstep(0.55, 0, t) * 0.35;
      sr += (dr - sr) * trough;
      sg += (dg - sg) * trough;
      sb += (db - sb) * trough;
      const crest = smoothstep(0.86, 1, t) * 26;
      const ripple = (fbm3(nx * 26, ny * 26, nz * 26, 2, seed + 11) - 0.5) * 14;
      sr += crest + ripple;
      sg += crest + ripple;
      sb += crest + ripple;

      const grain = fbm3(nx * 7, ny * 7, nz * 7, 3, seed + 43);
      let rr = dr + (mr - dr) * grain;
      let rg = dg + (mg - dg) * grain;
      let rb = db + (mb - db) * grain;
      let cover = 0.85;
      if (full) {
        cover = 1;
        const outcrop = smoothstep(0.76, 0.88, fbm3(nx * 2.6, ny * 2.6, nz * 2.6, 3, seed + 31));
        if (outcrop > 0) {
          sr += (rr - sr) * outcrop * 0.7;
          sg += (rg - sg) * outcrop * 0.7;
          sb += (rb - sb) * outcrop * 0.7;
        }
      } else if (empty) {
        cover = smoothstep(0.42, 0.6, fbm3(nx * 2.1, ny * 2.1, nz * 2.1, 3, seed + 27)) * 0.9;
      }
      let r = rr + (sr - rr) * cover;
      let g = rg + (sg - rg) * cover;
      let b = rb + (sb - rb) * cover;
      if (cfg.warm === true) {
        r *= 1.05;
        b *= 0.93;
      }
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
      i += 4;
    }
  }
}

/** White Hole: an over-bright swirl. */
function paintGlow(p) {
  const w = p.w;
  const h = p.h;
  const out = p.out;
  const pal = p.pal;
  const cl = p.cosLon;
  const sl = p.sinLon;
  const lr = pal[0];
  const lg = pal[1];
  const lb = pal[2];
  const mr = pal[3];
  const mg = pal[4];
  const mb = pal[5];
  const dr = pal[6];
  const dg = pal[7];
  const db = pal[8];
  const seed = p.seed;
  const invH = 1 / h;
  const lonStep = p.lonStep;
  let i = 0;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) * invH) * Math.PI;
    const ny = Math.sin(lat);
    const ring = Math.cos(lat);
    for (let x = 0; x < w; x++) {
      const nx = ring * cl[x];
      const nz = ring * sl[x];
      const lon = (x + 0.5) * lonStep - Math.PI;
      const base = fbm3(nx * 3, ny * 3, nz * 3, 4, seed);
      const k = smoothstep(0.25, 0.75, base);
      let r = lr + (mr - lr) * k;
      let g = lg + (mg - lg) * k;
      let b = lb + (mb - lb) * k;
      const ringK = smoothstep(0.45, 0.95, 1 - Math.abs(ny));
      r += (ACCENT.white[0] - r) * ringK * 0.5;
      g += (ACCENT.white[1] - g) * ringK * 0.5;
      b += (ACCENT.white[2] - b) * ringK * 0.5;
      const fil = Math.sin(lon * 5 + fbm3(nx * 4, ny * 4, nz * 4, 3, seed + 17) * 7);
      const filK = smoothstep(0.7, 0.95, fil) * 0.55;
      if (filK > 0) {
        r += ACCENT.white[0] * filK * 0.4;
        g += ACCENT.white[1] * filK * 0.4;
        b += ACCENT.white[2] * filK * 0.4;
      }
      const pole = smoothstep(0.82, 1, Math.abs(ny)) * 0.55;
      r += (dr - r) * pole;
      g += (dg - g) * pole;
      b += (db - b) * pole;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
      i += 4;
    }
  }
}

/** Eye of the Universe: a dark sphere with one luminous iris. */
function paintEye(p) {
  const w = p.w;
  const h = p.h;
  const out = p.out;
  const pal = p.pal;
  const cl = p.cosLon;
  const sl = p.sinLon;
  const lr = pal[0];
  const lg = pal[1];
  const lb = pal[2];
  const mr = pal[3];
  const mg = pal[4];
  const mb = pal[5];
  const dr = pal[6];
  const dg = pal[7];
  const db = pal[8];
  const seed = p.seed;
  const invH = 1 / h;
  const basis = p.basis;
  featureBasis(basis, 0, 2.4, 0.18);
  const cx = basis[0];
  const cy = basis[1];
  const cz = basis[2];
  const ex = basis[3];
  const ez = basis[5];
  const nxv = basis[6];
  const nyv = basis[7];
  const nzv = basis[8];
  let i = 0;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) * invH) * Math.PI;
    const ny = Math.sin(lat);
    const ring = Math.cos(lat);
    for (let x = 0; x < w; x++) {
      const nx = ring * cl[x];
      const nz = ring * sl[x];
      const base = fbm3(nx * 3.2, ny * 3.2, nz * 3.2, 4, seed);
      let r = dr + (mr - dr) * (base * 0.9);
      let g = dg + (mg - dg) * (base * 0.9);
      let b = db + (mb - db) * (base * 0.9);
      const dz = nx * cx + ny * cy + nz * cz;
      if (dz > -0.05) {
        const dx = (nx * ex + nz * ez) / 1.3;
        const dy = (nx * nxv + ny * nyv + nz * nzv) / 0.95;
        const rr = Math.sqrt(dx * dx + dy * dy);
        if (rr < 1) {
          const ang = Math.atan2(dy, dx);
          const fil = 0.5 + 0.5 * Math.sin(ang * 9 + rr * 7);
          const ir = smoothstep(1.2, 0.2, rr);
          r += (lr * (0.75 + fil * 0.45) - r) * ir * 0.92;
          g += (lg * (0.75 + fil * 0.45) - g) * ir * 0.92;
          b += (lb * (0.75 + fil * 0.45) - b) * ir * 0.92;
          const pupil = smoothstep(0.24, 0.06, rr);
          if (pupil > 0) {
            r += (dr * 0.2 - r) * pupil;
            g += (dg * 0.2 - g) * pupil;
            b += (db * 0.2 - b) * pupil;
          }
          const rim = smoothstep(0.86, 0.97, rr);
          if (rim > 0) {
            r += (ACCENT.white[0] - r) * rim * 0.7;
            g += (ACCENT.white[1] - g) * rim * 0.7;
            b += (ACCENT.white[2] - b) * rim * 0.7;
          }
        } else if (rr < 1.45) {
          const halo = (1 - (rr - 1) / 0.45) * 0.32;
          r += ACCENT.white[0] * halo * 0.35;
          g += ACCENT.white[1] * halo * 0.35;
          b += ACCENT.white[2] * halo * 0.35;
        }
      }
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
      i += 4;
    }
  }
}

const PAINTERS = Object.freeze({
  plasma: paintPlasma,
  rock: paintRock,
  gas: paintGas,
  ice: paintIce,
  lava: paintLava,
  metal: paintMetal,
  dark: paintDark,
  sand: paintSand,
  glow: paintGlow,
  eye: paintEye,
});

/** Fallback for texture keys that are not in bodies.json yet. */
function inferKind(key) {
  if (key.indexOf('ice') >= 0 || key.indexOf('comet') >= 0 || key.indexOf('frost') >= 0) return 'ice';
  if (key.indexOf('gas') >= 0 || key.indexOf('giant') >= 0) return 'gas';
  if (key.indexOf('station') >= 0 || key.indexOf('cannon') >= 0 || key.indexOf('probe') >= 0) return 'metal';
  if (key.indexOf('satellite') >= 0 || key.indexOf('shutter') >= 0) return 'metal';
  if (key.indexOf('lava') >= 0 || key.indexOf('volcan') >= 0 || key.indexOf('lantern') >= 0) return 'lava';
  if (key.indexOf('twin') >= 0 || key.indexOf('sand') >= 0) return 'sand';
  if (key.indexOf('eye') >= 0) return 'eye';
  return 'rock';
}

// ---------------------------------------------------------------------------
// Layer baking
// ---------------------------------------------------------------------------

function configFor(key) {
  return KIND_CONFIG[key] || DEFAULT_CONFIG;
}

/** The pure core: fill `job.out` with one layer's pixels. No DOM, no gl. */
function paintInto(job, cfg, pal, flags, seed) {
  job.cfg = cfg;
  job.flags = flags;
  job.seed = seed;
  fillPalette(job.pal, pal);
  job.rng.seed(seed);
  const painter = PAINTERS[cfg.kind] || paintRock;
  painter(job);
}

/**
 * Pure, DOM-free convenience wrapper around the same generator: bake one layer into a
 * fresh RGBA8 buffer. Deterministic in (`${textureKey}/${variant}`, palette, w, h).
 */
export function paintLayerPixels(textureKey, palette, variant, width, height) {
  const key = typeof textureKey === 'string' ? textureKey : String(textureKey);
  const v = typeof variant === 'string' ? variant : 'default';
  const job = createJob(width | 0, height | 0);
  paintInto(job, configFor(key), palette, VARIANT_FLAGS[v] || VARIANT_FLAGS.default, hashKey(key + '/' + v, 0x9e3779b9));
  return job.out;
}

// ---------------------------------------------------------------------------
// Canvas + GL plumbing
// ---------------------------------------------------------------------------

function createSurface(w, h) {
  let canvas = null;
  if (typeof OffscreenCanvas !== 'undefined' && OffscreenCanvas !== null) {
    try {
      canvas = new OffscreenCanvas(w, h);
    } catch (e) {
      canvas = null;
    }
  }
  if (canvas === null && typeof document !== 'undefined' && document.createElement) {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
  }
  if (canvas === null) throw new Error('textures: no canvas implementation (OffscreenCanvas / document)');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('textures: 2D context unavailable');
  const img = ctx.createImageData(w, h);
  return { canvas, ctx, img };
}

function applyAnisotropy(gl) {
  const ext = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
  if (!ext || typeof ext.TEXTURE_MAX_ANISOTROPY_EXT !== 'number') return 0;
  const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
  const value = Math.min(8, max);
  if (value > 1) gl.texParameterf(gl.TEXTURE_2D_ARRAY, ext.TEXTURE_MAX_ANISOTROPY_EXT, value);
  return value;
}

function createHandle(state) {
  const gl = state.gl;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, state.w, state.h, state.maxLayers, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  applyAnisotropy(gl);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  return tex;
}

function uploadLayer(state, layer) {
  const gl = state.gl;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, state.handle);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, state.w, state.h, 1, gl.RGBA, gl.UNSIGNED_BYTE, state.surf.img);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  state.mipsStale = true;
}

function refreshMips(state) {
  if (!state.mipsStale) return;
  const gl = state.gl;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, state.handle);
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  state.mipsStale = false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const STATES = new WeakMap();

function makeEntry(key, texture, defaultVariantName, extraNames) {
  const cfg = configFor(key);
  const names = [];
  names.push(key);
  if (texture && typeof texture.key === 'string') names.push(texture.key);
  if (extraNames) {
    for (let i = 0; i < extraNames.length; i++) {
      if (typeof extraNames[i] === 'string' && extraNames[i]) names.push(extraNames[i]);
    }
  }
  return {
    key,
    names,
    cfg,
    palette: texture && texture.palette ? texture.palette : DEFAULT_PALETTE,
    declared: texture && Array.isArray(texture.variants) && texture.variants.length ? texture.variants : ['default'],
    defaultVariant: defaultVariantName,
    variants: new Map(),
  };
}

function register(state, entry) {
  for (let i = 0; i < entry.names.length; i++) {
    const name = entry.names[i];
    if (!state.byName.has(name)) state.byName.set(name, entry);
  }
  state.entries.push(entry);
  return entry;
}

/** Unknown name: give it a stable neutral look instead of failing the whole frame. */
function addFallbackEntry(state, name) {
  const entry = makeEntry(name, null, 'default', null);
  entry.cfg = { kind: inferKind(name) };
  return register(state, entry);
}

function bakeLayer(state, entry, variant, deferMips) {
  if (state.nextLayer >= state.maxLayers) {
    throw new RangeError(
      'textures: maxLayers (' + state.maxLayers + ') exceeded while baking "' + entry.key + '" / "' + variant + '"'
    );
  }
  const layer = state.nextLayer++;
  const seed = hashKey(entry.key + '/' + variant, 0x9e3779b9);
  paintInto(state.job, entry.cfg, entry.palette, VARIANT_FLAGS[variant] || VARIANT_FLAGS.default, seed);
  state.surf.ctx.putImageData(state.surf.img, 0, 0);
  uploadLayer(state, layer);
  if (!deferMips) refreshMips(state);
  entry.variants.set(variant, layer);
  return layer;
}

function bakeAllInto(state, bodies) {
  const list = Array.isArray(bodies) ? bodies : state.bodies;
  let baked = 0;
  for (let i = 0; i < list.length; i++) {
    const body = list[i];
    if (!body || typeof body.id !== 'string') continue;
    let entry = state.byName.get(body.id);
    if (entry === undefined) {
      entry = body.texture ? register(state, makeEntry(body.id, body.texture, defaultVariantOf(body.texture), [body.internal])) : null;
    }
    if (entry === null) continue;
    const variants = entry.declared;
    for (let v = 0; v < variants.length; v++) {
      const name = variants[v];
      if (entry.variants.has(name)) continue;
      bakeLayer(state, entry, name, true);
      baked++;
    }
  }
  refreshMips(state);
  return baked;
}

function defaultVariantOf(texture) {
  return texture && Array.isArray(texture.variants) && texture.variants.length ? texture.variants[0] : 'default';
}

/**
 * Build the body texture array.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {Array<object>} bodies parsed wallpaper/data/bodies.json `.bodies`
 * @param {{size?: number, maxLayers?: number}} [opts] layer size (default 512x256), array capacity (default 64)
 * @returns {{handle: WebGLTexture, layerOf: (bodyId: string, variant?: string) => number, layerCount: number, bytes: number, dispose: () => void}}
 */
export function createTextureSet(gl, bodies, opts) {
  if (!gl || typeof gl.TEXTURE_2D_ARRAY !== 'number' || typeof gl.texImage3D !== 'function') {
    throw new Error('textures: a WebGL2 context is required (TEXTURE_2D_ARRAY + texImage3D)');
  }
  const options = opts || {};
  const w = options.size === undefined ? 512 : options.size | 0;
  const maxLayers = options.maxLayers === undefined ? 64 : options.maxLayers | 0;
  if (w < 2 || (w & 1) !== 0) throw new RangeError('textures: size must be a positive even integer, got ' + options.size);
  if (maxLayers < 1) throw new RangeError('textures: maxLayers must be >= 1, got ' + options.maxLayers);
  const h = w >> 1;

  const surf = createSurface(w, h);
  const state = {
    gl,
    w,
    h,
    maxLayers,
    nextLayer: 0,
    handle: null,
    mipsStale: false,
    disposed: false,
    byName: new Map(),
    entries: [],
    bodies: Array.isArray(bodies) ? bodies : [],
    surf,
    job: createJob(w, h, surf.img.data),
  };
  state.handle = createHandle(state);
  for (let i = 0; i < state.bodies.length; i++) {
    const body = state.bodies[i];
    if (!body || typeof body.id !== 'string' || !body.texture) continue;
    const key = typeof body.texture.key === 'string' ? body.texture.key : body.id;
    register(state, makeEntry(key, body.texture, defaultVariantOf(body.texture), [body.id, body.internal]));
  }

  const texSet = {
    handle: state.handle,
    get layerCount() {
      return state.nextLayer;
    },
    get bytes() {
      return Math.round(w * h * 4 * state.nextLayer * 1.34);
    },
    /**
     * Layer index for a body/variant pair — the layer is identified by
     * `${texture.key}/${variant}` (main.js caches the result per changed variant).
     * A variant that bodies.json does not declare falls back to the body's first
     * layer instead of baking a new one; only running out of layers throws.
     *
     * @param {string} bodyId texture key, body id or internal name
     * @param {string} [variant] defaults to the body's first declared variant
     * @returns {number} layer index in the array texture
     */
    layerOf(bodyId, variant) {
      if (state.disposed) throw new Error('textures: layerOf() on a disposed texture set');
      let entry = state.byName.get(bodyId);
      if (entry === undefined) entry = addFallbackEntry(state, bodyId);
      const declared = entry.declared;
      const name = typeof variant === 'string' && declared.indexOf(variant) >= 0 ? variant : entry.defaultVariant;
      let layer = entry.variants.get(name);
      if (layer === undefined) layer = bakeLayer(state, entry, name, false);
      return layer;
    },
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      gl.deleteTexture(state.handle);
      state.byName.clear();
      state.entries.length = 0;
      state.nextLayer = 0;
      STATES.delete(texSet);
    },
  };
  STATES.set(texSet, state);
  return texSet;
}

/**
 * Bake every variant declared in bodies.json in one go, so no layer is generated
 * during the first seconds of the loop. Lazy baking via layerOf() keeps working.
 *
 * @returns {number} layers baked by this call
 */
export function bakeAll(texSet, bodies) {
  const state = STATES.get(texSet);
  if (!state) throw new Error('textures: bakeAll() expects a set from createTextureSet()');
  if (state.disposed) throw new Error('textures: bakeAll() on a disposed texture set');
  return bakeAllInto(state, bodies);
}
