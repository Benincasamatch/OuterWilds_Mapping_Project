// Geometry generators. Flat typed arrays in, flat typed arrays out — no GL calls,
// no classes, deterministic (same args -> same bytes).
//
// Conventions (match render/CONTRACT.md): y is up, the orbital plane is XZ, the
// sun sits at the origin. Every mesh is built at unit size; scale comes from the
// caller (per-instance radius attribute or a model matrix).

/**
 * UV sphere on the unit sphere.
 * v = 0 at the +Y pole, v = 1 at -Y; u runs 0..1 with a duplicated seam column,
 * i.e. the layout an equirectangular (2:1) texture expects.
 * 48 x 24 -> 1225 vertices / 2304 triangles (fits an Uint16 index buffer).
 * Winding is counter-clockwise seen from outside (front faces default).
 */
export function makeUvSphere(lonSeg = 48, latSeg = 24) {
  const cols = lonSeg + 1;
  const rows = latSeg + 1;
  const positions = new Float32Array(cols * rows * 3);
  const normals = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const indices = new Uint16Array(lonSeg * latSeg * 6);

  let p = 0;
  let t = 0;
  for (let j = 0; j < rows; j++) {
    const v = j / latSeg;
    const theta = v * Math.PI; // 0 at +Y
    const ny = Math.cos(theta);
    const r = Math.sin(theta);
    for (let i = 0; i < cols; i++) {
      const phi = (i / lonSeg) * Math.PI * 2;
      const x = r * Math.sin(phi);
      const z = r * Math.cos(phi);
      positions[p] = x;
      positions[p + 1] = ny;
      positions[p + 2] = z;
      normals[p] = x;
      normals[p + 1] = ny;
      normals[p + 2] = z;
      p += 3;
      uvs[t] = i / lonSeg;
      uvs[t + 1] = v;
      t += 2;
    }
  }

  let k = 0;
  for (let j = 0; j < latSeg; j++) {
    for (let i = 0; i < lonSeg; i++) {
      const a = j * cols + i;
      const b = a + cols; // one row down (south)
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = a + 1;
      indices[k++] = a + 1;
      indices[k++] = b;
      indices[k++] = b + 1;
    }
  }
  return { positions, normals, uvs, indices };
}

/**
 * Unit circle on the XZ plane (y = 0), radius 1, `seg` unique points.
 * Draw with gl.LINE_LOOP; scale by an orbit radius and translate to (cx, 0, cz).
 */
export function makeUnitRing(seg = 256) {
  const out = new Float32Array(seg * 3);
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    out[i * 3] = Math.cos(a);
    out[i * 3 + 1] = 0;
    out[i * 3 + 2] = Math.sin(a);
  }
  return out;
}

/** Camera-facing quad in clip-style local space: xy in [-1, 1], uv 0..1. */
export function makeQuad() {
  const positions = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  return { positions, uvs, indices };
}

/** Great-circle normal of the galactic band (tilted away from the orbital plane so
 *  it never lines up with the orbit rings when the camera sits near the plane). */
const BAND_NORMAL = [0.42, 0.78, -0.46];
const DUST_FRACTION = 0.06;      // large faint sprites that build the band's haze
const BAND_FRACTION = 0.40;      // share of the remaining stars concentrated in the band
const DUST_MIN_SIZE = 9;         // px; SKY_VS treats sizes above 8 px as dust
const DUST_MAX_SIZE = 64;        // px; stays inside every driver's point-size range at dpr 1.5

/**
 * Star field: directions on the unit sphere + a power-law brightness + a per-star
 * point size (CSS px). The first `count * DUST_FRACTION` entries are big, very faint
 * "dust" sprites along a tilted galactic band; a further share of the real stars is
 * concentrated in the same band so it reads as a Milky Way; the rest are uniform.
 * Deterministic for a given (count, seed) — the renderer re-uploads brightness in
 * place to drive extinction, so the direction and size buffers stay static.
 */
export function makeStarField(count = 12000, seed = 1) {
  const n = count > 0 ? count | 0 : 0;
  const dirs = new Float32Array(n * 3);
  const brightness = new Float32Array(n);
  const sizes = new Float32Array(n);
  let s = (seed >>> 0) || 1;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  // band basis: bn (normal), bu / bv (in-plane, orthonormal)
  let bnx = BAND_NORMAL[0], bny = BAND_NORMAL[1], bnz = BAND_NORMAL[2];
  let len = Math.hypot(bnx, bny, bnz) || 1;
  bnx /= len; bny /= len; bnz /= len;
  let bux = 0, buy = bnz, buz = -bny;                       // bn × (1,0,0)
  len = Math.hypot(bux, buy, buz) || 1;
  bux /= len; buy /= len; buz /= len;
  const bvx = bny * buz - bnz * buy;                         // bn × bu
  const bvy = bnz * bux - bnx * buz;
  const bvz = bnx * buy - bny * bux;

  const dustCount = Math.min(n, Math.round(n * DUST_FRACTION));
  for (let i = 0; i < n; i++) {
    const dust = i < dustCount;
    const inBand = dust || rnd() < BAND_FRACTION;
    if (inBand) {
      const phi = rnd() * Math.PI * 2;
      // triangular-ish latitude spread around the band's great circle
      const spread = dust ? 0.15 : 0.20;
      const lat = (rnd() + rnd() + rnd() - 1.5) * spread;
      const cl = Math.cos(lat);
      const sl = Math.sin(lat);
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      dirs[i * 3] = cl * (cp * bux + sp * bvx) + sl * bnx;
      dirs[i * 3 + 1] = cl * (cp * buy + sp * bvy) + sl * bny;
      dirs[i * 3 + 2] = cl * (cp * buz + sp * bvz) + sl * bnz;
    } else {
      const z = rnd() * 2 - 1;
      const phi = rnd() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      dirs[i * 3] = r * Math.cos(phi);
      dirs[i * 3 + 1] = z;
      dirs[i * 3 + 2] = r * Math.sin(phi);
    }
    if (dust) {
      brightness[i] = 0.07 + 0.07 * rnd();
      sizes[i] = 36 + (DUST_MAX_SIZE - 36) * rnd();
      continue;
    }
    const u = rnd();
    const v = rnd();
    // mostly faint, a handful of bright ones (max ~1.07); band stars run fainter
    let b = 0.1 + 0.52 * u * u + 0.45 * v * v * v * v;
    if (inBand) b *= 0.78;
    let size = 1.0 + 1.9 * b;
    if (rnd() < 0.006) {                                   // a few naked-eye standouts
      b = Math.min(1.25, b * 1.25 + 0.3);
      size = 3.6 + rnd();
    }
    brightness[i] = b;
    sizes[i] = Math.min(size, DUST_MIN_SIZE - 1);
  }
  return { dirs, brightness, sizes };
}
