// Scene renderer — Phase 2 skeleton. Implements render/CONTRACT.md.
//
// Batches per frame (one draw call each unless noted):
//   stars POINTS (1) | orbit rings (1 per visible ring) | planet spheres instanced (1) |
//   sun core (1) | atmosphere shells instanced (1, only when a body has one) |
//   sun halo billboard (1) | particles POINTS (1, only when non-empty).
//
// Zero allocation per frame: every buffer, matrix and scratch array is created in
// createScene and written in place. No `new`, no literals, no closures and no
// iterator protocols inside draw().
//
// Contract notes (deliberately kept out of the frozen CONTRACT.md, see the report):
//   * draw() clears colour + depth by default, so the renderer is self-sufficient
//     for the caller that owns no other pass; pass { clear: false } to own it.
//   * frame.bodies carries no atmosphere information, so shells come from
//     opts.atmospheres (bodyId -> shell thickness in view units). PLAN §4.3 needs
//     giants_deep only: 959 m atmosphere -> 959 * k_body(1.4) = 1343 view units.
//   * frame.sun carries no colour either, so the sun/atmosphere palette is
//     hard-coded from bodies.json (sun: #fff6d8 / #ffb347 / #ff5e2b).
//   * the star field is POINTS with a re-uploaded brightness buffer, not the baked
//     cube texture sketched in PLAN §4.2 (per the Phase 2 assignment).
//   * frame.particles[].size is treated as a point size in CSS pixels (scaled by
//     the dpr passed to resize()).
//   * texture-array layers are read straight from frame.bodies[i].layer (CONTRACT.md
//     "帧内 layer 字段"); draw() never calls texSet.layerOf(), builds keys or hashes.
//   * frame.orbits entries with type === 'polyline' carry flat XZ pairs in absolute
//     world space (interloper's mapped ellipse) and are drawn as LINE_STRIP;
//     every other entry is a unit ring scaled by radiusVisual at (cx, 0, cz).

import {
  createProgram, createBuffer, updateBuffer, createVAO,
  destroyProgram, destroyBuffer, destroyVAO,
} from './gl.js';
import { makeUvSphere, makeUnitRing, makeQuad, makeStarField } from './mesh.js';
import {
  BODY_VS, BODY_FS, ATM_FS, SUN_VS, SUN_FS, GLOW_VS, GLOW_FS, SHOCK_VS, SHOCK_FS,
  SKY_VS, SKY_FS, LINE_VS, LINE_FS, PART_VS, PART_FS, MASK_VS, MASK_FS,
} from './shaders.js';

const MAX_INSTANCES = 48;      // frame.bodies is 20 entries; headroom for sub-bodies
const MAX_ORBITS = 64;         // frame.orbits is ~17 entries (orbit -> body index cache)
const INST_FLOATS = 19;        // mat4 (16) + radius + layer + opacity
const INST_BYTES = INST_FLOATS * 4;
const PART_FLOATS = 8;         // xyz + rgb + size + opacity
const POLYLINE_MAX = 2048;     // points per polyline orbit (longer ones are truncated)
const LINE_ALPHA = 0.62;       // peak alpha, right behind the body (LINE_VS fades the lap)
const EXTINCTION_INTERVAL_S = 2;     // setStarExtinction re-uploads at most this often
const SUN_POS = new Float32Array(3); // the sun sits at the origin (CONTRACT.md)
const NO_EYE = new Float32Array(3);
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const EMPTY_OPTS = {};
// bodyId -> shell thickness in view units, or { shell, color: [r, g, b] }.
// giants_deep: 959 m * k_body 1.4 (PLAN §3.7). timber_hearth: thin blue rim (design).
const DEFAULT_ATMOSPHERES = {
  giants_deep: 1343,
  timber_hearth: { shell: 46, color: [0.55, 0.74, 1.0] },
};
const DEFAULT_ATMOSPHERE_COLOR = [0.42, 0.72, 0.66];
const ATM_COLOR_SLOTS = 4;               // uColors[4] in ATM_FS
// Sunlight seen by the planets: warm white at t=0, sliding to a red-giant orange.
const SUN_LIGHT_WARM = [1.0, 0.955, 0.89];
const SUN_LIGHT_RED = [1.0, 0.60, 0.38];

// performance.now is the only global touched, and only for stats.lastMs.
const nowMs = typeof performance === 'object' && performance !== null &&
  typeof performance.now === 'function'
  ? () => performance.now()
  : () => 0;

export function createScene(gl, opts) {
  const o = opts || EMPTY_OPTS;
  const starCount = o.starCount === undefined ? 12000 : o.starCount | 0;
  const ringSeg = o.orbitSegments === undefined ? 256 : o.orbitSegments | 0;
  const maxParticles = o.maxParticles === undefined ? 4096 : o.maxParticles | 0;
  const glowScale = o.glowScale === undefined ? 3.0 : o.glowScale;
  const seed = o.seed === undefined ? 1 : o.seed;
  const atmColor = o.atmosphereColor || DEFAULT_ATMOSPHERE_COLOR;
  const doClear = o.clear !== false;

  // Atmosphere shells: bodyId -> { shell (view units), colorIdx (slot in atmColors) }.
  // Slot 0 is always the default colour (opts.atmosphereColor).
  const atmSrc = o.atmospheres === undefined ? DEFAULT_ATMOSPHERES : o.atmospheres;
  const atmShells = new Map();
  const atmColors = new Float32Array(ATM_COLOR_SLOTS * 3);
  let atmColorCount = 0;
  function atmColorIndex(c) {
    const r = Math.fround(c[0]);
    const g = Math.fround(c[1]);
    const b = Math.fround(c[2]);
    for (let i = 0; i < atmColorCount; i++) {
      if (atmColors[i * 3] === r && atmColors[i * 3 + 1] === g && atmColors[i * 3 + 2] === b) return i;
    }
    if (atmColorCount >= ATM_COLOR_SLOTS) return 0;
    const i = atmColorCount++;
    atmColors[i * 3] = r; atmColors[i * 3 + 1] = g; atmColors[i * 3 + 2] = b;
    return i;
  }
  atmColorIndex(atmColor);
  function addShell(id, v) {
    if (v === null || v === undefined) return;
    const shell = typeof v === 'number' ? v : +v.shell;
    if (!(shell > 0)) return;
    const color = typeof v === 'object' && v.color ? v.color : atmColor;
    atmShells.set(id, { shell, colorIdx: atmColorIndex(color) });
  }
  if (atmSrc instanceof Map) {
    atmSrc.forEach((v, k) => addShell(k, v));
  } else if (atmSrc) {
    const keys = Object.keys(atmSrc);
    for (let i = 0; i < keys.length; i++) addShell(keys[i], atmSrc[keys[i]]);
  }

  const programs = [];
  const buffers = [];
  const vaos = [];

  // ---- programs ------------------------------------------------------------
  const bodyProg = createProgram(gl, BODY_VS, BODY_FS);
  const atmProg = createProgram(gl, BODY_VS, ATM_FS);
  const sunProg = createProgram(gl, SUN_VS, SUN_FS);
  const glowProg = createProgram(gl, GLOW_VS, GLOW_FS);
  const shockProg = createProgram(gl, SHOCK_VS, SHOCK_FS);
  const skyProg = createProgram(gl, SKY_VS, SKY_FS);
  const lineProg = createProgram(gl, LINE_VS, LINE_FS);
  const partProg = createProgram(gl, PART_VS, PART_FS);
  const maskProg = createProgram(gl, MASK_VS, MASK_FS);
  programs.push(bodyProg, atmProg, sunProg, glowProg, shockProg, skyProg, lineProg, partProg, maskProg);

  // ---- geometry ------------------------------------------------------------
  const sphere = makeUvSphere(48, 24);
  const sphereIndexCount = sphere.indices.length;
  const sphereTris = sphereIndexCount / 3;
  const spherePos = createBuffer(gl, gl.ARRAY_BUFFER, sphere.positions, gl.STATIC_DRAW);
  const sphereNrm = createBuffer(gl, gl.ARRAY_BUFFER, sphere.normals, gl.STATIC_DRAW);
  const sphereUv = createBuffer(gl, gl.ARRAY_BUFFER, sphere.uvs, gl.STATIC_DRAW);
  const sphereIdx = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, sphere.indices, gl.STATIC_DRAW);
  buffers.push(spherePos, sphereNrm, sphereUv, sphereIdx);

  const ring = makeUnitRing(ringSeg);
  const ringBuf = createBuffer(gl, gl.ARRAY_BUFFER, ring, gl.STATIC_DRAW);
  buffers.push(ringBuf);

  const polyData = new Float32Array(POLYLINE_MAX * 3);
  const polyBuf = createBuffer(gl, gl.ARRAY_BUFFER, polyData, gl.DYNAMIC_DRAW);
  buffers.push(polyBuf);

  const quad = makeQuad();
  const quadPos = createBuffer(gl, gl.ARRAY_BUFFER, quad.positions, gl.STATIC_DRAW);
  const quadUv = createBuffer(gl, gl.ARRAY_BUFFER, quad.uvs, gl.STATIC_DRAW);
  const quadIdx = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, quad.indices, gl.STATIC_DRAW);
  buffers.push(quadPos, quadUv, quadIdx);

  const stars = makeStarField(starCount, seed);
  const starCountReal = stars.dirs.length / 3;
  const starBase = stars.brightness;
  const starLive = new Float32Array(starCountReal);
  const starDirBuf = createBuffer(gl, gl.ARRAY_BUFFER, stars.dirs, gl.STATIC_DRAW);
  const starBrightBuf = createBuffer(gl, gl.ARRAY_BUFFER, starBase, gl.DYNAMIC_DRAW);
  const starSizeBuf = createBuffer(gl, gl.ARRAY_BUFFER, stars.sizes, gl.STATIC_DRAW);
  buffers.push(starDirBuf, starBrightBuf, starSizeBuf);

  const instData = new Float32Array(MAX_INSTANCES * INST_FLOATS);
  const atmData = new Float32Array(MAX_INSTANCES * INST_FLOATS);
  const instBuf = createBuffer(gl, gl.ARRAY_BUFFER, instData, gl.DYNAMIC_DRAW);
  const atmBuf = createBuffer(gl, gl.ARRAY_BUFFER, atmData, gl.DYNAMIC_DRAW);
  buffers.push(instBuf, atmBuf);

  const partData = new Float32Array(maxParticles * PART_FLOATS);
  const partBuf = createBuffer(gl, gl.ARRAY_BUFFER, partData, gl.DYNAMIC_DRAW);
  buffers.push(partBuf);

  // ---- vertex arrays -------------------------------------------------------
  function instancedAttribs(instBuffer) {
    return [
      { location: 0, buffer: spherePos, size: 3 },
      { location: 1, buffer: sphereNrm, size: 3 },
      { location: 2, buffer: sphereUv, size: 2 },
      { location: 3, buffer: instBuffer, size: 4, stride: INST_BYTES, offset: 0, divisor: 1 },
      { location: 4, buffer: instBuffer, size: 4, stride: INST_BYTES, offset: 16, divisor: 1 },
      { location: 5, buffer: instBuffer, size: 4, stride: INST_BYTES, offset: 32, divisor: 1 },
      { location: 6, buffer: instBuffer, size: 4, stride: INST_BYTES, offset: 48, divisor: 1 },
      { location: 7, buffer: instBuffer, size: 1, stride: INST_BYTES, offset: 64, divisor: 1 },
      { location: 8, buffer: instBuffer, size: 1, stride: INST_BYTES, offset: 68, divisor: 1 },
      { location: 9, buffer: instBuffer, size: 1, stride: INST_BYTES, offset: 72, divisor: 1 },
    ];
  }
  const bodyVao = createVAO(gl, { index: sphereIdx, attributes: instancedAttribs(instBuf) });
  const atmVao = createVAO(gl, { index: sphereIdx, attributes: instancedAttribs(atmBuf) });
  const sunVao = createVAO(gl, {
    index: sphereIdx,
    attributes: [
      { location: 0, buffer: spherePos, size: 3 },
      { location: 1, buffer: sphereNrm, size: 3 },
      { location: 2, buffer: sphereUv, size: 2 },
    ],
  });
  const ringVao = createVAO(gl, { attributes: [{ location: 0, buffer: ringBuf, size: 3 }] });
  const polyVao = createVAO(gl, { attributes: [{ location: 0, buffer: polyBuf, size: 3 }] });
  const quadVao = createVAO(gl, {
    index: quadIdx,
    attributes: [
      { location: 0, buffer: quadPos, size: 2 },
      { location: 1, buffer: quadUv, size: 2 },
    ],
  });
  const skyVao = createVAO(gl, {
    attributes: [
      { location: 0, buffer: starDirBuf, size: 3 },
      { location: 1, buffer: starBrightBuf, size: 1 },
      { location: 2, buffer: starSizeBuf, size: 1 },
    ],
  });
  const partVao = createVAO(gl, {
    attributes: [
      { location: 0, buffer: partBuf, size: 3, stride: PART_FLOATS * 4, offset: 0 },
      { location: 1, buffer: partBuf, size: 3, stride: PART_FLOATS * 4, offset: 12 },
      { location: 2, buffer: partBuf, size: 1, stride: PART_FLOATS * 4, offset: 24 },
      { location: 3, buffer: partBuf, size: 1, stride: PART_FLOATS * 4, offset: 28 },
    ],
  });
  vaos.push(bodyVao, atmVao, sunVao, ringVao, quadVao, skyVao, partVao);

  // ---- per-frame scratch (never reallocated) -------------------------------
  const model = new Float32Array(16);

  // orbit index -> body index (same id) so the trail head needs no per-frame lookup;
  // rebuilt only when the integrator hands over a different frame object.
  const orbitBodyIdx = new Int32Array(MAX_ORBITS);
  let indexedFrame = null;
  let indexedOrbits = -1;
  function indexOrbits(frame) {
    const orbits = frame.orbits;
    const bodies = frame.bodies;
    indexedFrame = frame;
    indexedOrbits = orbits ? orbits.length : 0;
    for (let i = 0; i < MAX_ORBITS; i++) {
      orbitBodyIdx[i] = -1;
      if (!orbits || !bodies || i >= orbits.length || !orbits[i]) continue;
      const id = orbits[i].id;
      for (let j = 0; j < bodies.length; j++) {
        if (bodies[j] && bodies[j].id === id) { orbitBodyIdx[i] = j; break; }
      }
    }
  }

  // 1x1x1 grey TEXTURE_2D_ARRAY so the body pass stays valid before setTextures().
  let fallbackTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, fallbackTex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1);
  const fallbackPx = new Uint8Array([128, 128, 128, 255]);
  gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, fallbackPx);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);          // stars are pinned to depth 1.0
  gl.disable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.frontFace(gl.CCW);
  gl.clearColor(0, 0, 0, 1);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

  let texSet = null;
  let pointScale = 1;
  let disposed = false;
  let prevT = 0;
  let clockS = 0;
  let pendingExtinction = 0;
  let appliedExtinction = 0;
  let extinctionDirty = false;
  let lastExtinctionS = -1e9;
  let starGain = 1;                  // `starBrightness` multiplier, applied with the extinction
  let flashOverlay = 0;              // full-screen mask alpha (0 = off)

  const scene = {
    stats: { drawCalls: 0, draws: 0, lastMs: 0, triangles: 0 },

    setTextures(set) {
      texSet = set || null;
    },

    resize(widthPx, heightPx, dpr) {
      if (disposed) return;
      const scale = dpr > 0 ? dpr : 1;
      pointScale = scale;
      const w = Math.max(1, Math.round((widthPx > 0 ? widthPx : 1)));
      const h = Math.max(1, Math.round((heightPx > 0 ? heightPx : 1)));
      gl.viewport(0, 0, w, h);
    },

    setStarExtinction(progress01) {
      let p = progress01;
      if (!(p > 0)) p = 0;
      else if (p > 1) p = 1;
      if (p === pendingExtinction) return;
      pendingExtinction = p;
      if (p !== appliedExtinction) extinctionDirty = true;
    },

    /** Star brightness multiplier (the `starBrightness` user property). Uploads at once. */
    setStarBrightness(multiplier) {
      let m = Number(multiplier);
      if (!Number.isFinite(m)) return;
      m = Math.min(4, Math.max(0, m));
      if (m === starGain) return;
      starGain = m;
      lastExtinctionS = -1e9;          // re-upload on the next draw, do not wait out the throttle
      extinctionDirty = true;
    },

    /**
     * Full-screen white mask alpha (0 = off). The integrator drives it for the loop
     * seam and for a wall-clock resume, where the scene would otherwise cut silently
     * (PLAN.md §4.4 / §5 Phase 3).
     */
    setFlashOverlay(alpha) {
      const a = Number(alpha);
      flashOverlay = Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 0;
    },

    draw(frame, camera, drawOpts) {
      if (disposed || !frame || !camera) return;
      const t0 = nowMs();
      const d = drawOpts || EMPTY_OPTS;
      const soft = d.quality === 'low' ? 0 : 1;
      const octaves = d.quality === 'low' ? 2 : 5;
      const viewProj = camera.viewProj;
      const eye = camera.eye || NO_EYE;
      const cull = camera.visibleSphere;
      let drawCalls = 0;
      let triangles = 0;

      // Scene clock (monotone, wrap- and pause-safe) drives the extinction throttle.
      const ft = frame.t === undefined ? prevT : frame.t;
      let dt = ft - prevT;
      if (!(dt >= 0)) dt = 0;
      else if (dt > 0.25) dt = 0.25;
      clockS += dt;
      prevT = ft;

      if (doClear) {
        gl.depthMask(true);          // a masked depth clear would be a no-op
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      }

      if (extinctionDirty && clockS - lastExtinctionS >= EXTINCTION_INTERVAL_S) {
        const k = (1 - pendingExtinction) * starGain;
        for (let i = 0; i < starCountReal; i++) starLive[i] = starBase[i] * k;
        updateBuffer(gl, starBrightBuf, starLive);
        appliedExtinction = pendingExtinction;
        lastExtinctionS = clockS;
        extinctionDirty = false;
      }

      // ---- stars -----------------------------------------------------------
      if (d.stars !== false && starCountReal > 0) {
        gl.useProgram(skyProg.program);
        gl.uniformMatrix4fv(skyProg.u.uViewProj, false, viewProj);
        gl.uniform1f(skyProg.u.uPointScale, pointScale);
        gl.uniform1f(skyProg.u.uSoft, soft);
        gl.disable(gl.CULL_FACE);
        gl.depthMask(false);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindVertexArray(skyVao.vao);
        gl.drawArrays(gl.POINTS, 0, starCountReal);
        drawCalls++;
      }

      const bodies = frame.bodies;
      const bodyCount = bodies ? bodies.length : 0;
      const capped = bodyCount < MAX_INSTANCES ? bodyCount : MAX_INSTANCES;

      // ---- orbit lines -----------------------------------------------------
      // ring: unit ring * radiusVisual moved to (cx, 0, cz).
      // polyline: flat XZ pairs in absolute world coords (interloper ellipse), y = 0.
      // Each line is brightest just behind its body and fades along the lap
      // (LINE_VS uHead/uTrail); a body that is hidden gets a uniform line.
      const orbits = frame.orbits;
      if (d.orbitLines !== false && orbits) {
        if (frame !== indexedFrame || orbits.length !== indexedOrbits) indexOrbits(frame);
        gl.useProgram(lineProg.program);
        gl.uniformMatrix4fv(lineProg.u.uViewProj, false, viewProj);
        gl.disable(gl.CULL_FACE);
        gl.depthMask(false);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        for (let i = 0; i < orbits.length; i++) {
          const orb = orbits[i];
          if (!orb || orb.visible === false) continue;
          const col = orb.color;
          let head = 0;
          let trail = 0;
          const bi = i < MAX_ORBITS ? orbitBodyIdx[i] : -1;
          if (bi >= 0 && bi < bodyCount) {
            const hb = bodies[bi];
            if (hb && hb.visible !== false && hb.opacity > 0) {
              head = Math.atan2(hb.z - orb.cz, hb.x - orb.cx);
              trail = 1;
            }
          }
          gl.uniform1f(lineProg.u.uHead, head);
          gl.uniform1f(lineProg.u.uTrail, trail);
          if (orb.type === 'polyline') {
            const pts = orb.points;
            if (!pts) continue;
            let n = (pts.length / 2) | 0;
            if (n > POLYLINE_MAX) n = POLYLINE_MAX;
            if (n < 2) continue;
            for (let k = 0, w = 0; k < n; k++, w += 3) {
              polyData[w] = pts[k * 2];
              polyData[w + 1] = 0;
              polyData[w + 2] = pts[k * 2 + 1];
            }
            updateBuffer(gl, polyBuf, polyData, 0, 0, n * 3);
            gl.bindVertexArray(polyVao.vao);
            gl.uniformMatrix4fv(lineProg.u.uModel, false, IDENTITY);
            if (col) gl.uniform4f(lineProg.u.uColor, col[0], col[1], col[2], LINE_ALPHA);
            else gl.uniform4f(lineProg.u.uColor, 0.80, 0.85, 0.95, LINE_ALPHA);
            gl.drawArrays(gl.LINE_STRIP, 0, n);
            drawCalls++;
            continue;
          }
          const r = orb.radiusVisual;
          if (!(r > 0)) continue;
          if (cull && !cull.call(camera, orb.cx, 0, orb.cz, r)) continue;
          model[0] = r; model[1] = 0; model[2] = 0; model[3] = 0;
          model[4] = 0; model[5] = r; model[6] = 0; model[7] = 0;
          model[8] = 0; model[9] = 0; model[10] = r; model[11] = 0;
          model[12] = orb.cx; model[13] = 0; model[14] = orb.cz; model[15] = 1;
          gl.bindVertexArray(ringVao.vao);
          gl.uniformMatrix4fv(lineProg.u.uModel, false, model);
          if (col) gl.uniform4f(lineProg.u.uColor, col[0], col[1], col[2], LINE_ALPHA);
          else gl.uniform4f(lineProg.u.uColor, 0.80, 0.85, 0.95, LINE_ALPHA);
          gl.drawArrays(gl.LINE_LOOP, 0, ringSeg);
          drawCalls++;
        }
      }

      // ---- sun state (the planet lighting needs it before the sun is drawn) ----
      const sun = frame.sun;
      const sunVisible = !!(sun && sun.visible !== false && sun.visualRadius > 0);
      let sunRadius = 0;
      let sunMix = 0;
      let sunFlash = 0;
      let sunRemnant = 0;
      let sunCollapse = 0;
      let coreRadius = 0;                 // drawn radius: the remnant shrinks to ~1/4
      if (sunVisible) {
        sunRadius = sun.visualRadius;
        sunMix = sun.mix || 0;
        sunFlash = sun.flash || 0;
        const rem = sun.remnant;
        sunRemnant = rem === true ? 1 : (rem > 0 ? +rem : 0);
        sunCollapse = sun.collapse > 0 ? (sun.collapse < 1 ? +sun.collapse : 1) : 0;
        coreRadius = sunRadius * (1 - 0.74 * sunCollapse);
      }
      // Sunlight on the planets: warm -> red giant, mostly gone once only the remnant
      // is left, and blasted white for the supernova flash.
      const lightDim = 1 - 0.8 * sunCollapse;
      const lightR = (SUN_LIGHT_WARM[0] + (SUN_LIGHT_RED[0] - SUN_LIGHT_WARM[0]) * sunMix) * lightDim + 2.5 * sunFlash;
      const lightG = (SUN_LIGHT_WARM[1] + (SUN_LIGHT_RED[1] - SUN_LIGHT_WARM[1]) * sunMix) * lightDim + 2.5 * sunFlash;
      const lightB = (SUN_LIGHT_WARM[2] + (SUN_LIGHT_RED[2] - SUN_LIGHT_WARM[2]) * sunMix) * lightDim + 2.5 * sunFlash;

      // ---- planet spheres: one instanced draw call -------------------------
      let instCount = 0;
      for (let i = 0; i < capped && instCount < MAX_INSTANCES; i++) {
        const b = bodies[i];
        if (!b || b.visible === false || b.id === 'sun') continue;
        if (!(b.visualRadius > 0) || !(b.opacity > 0) || !b.textureKey) continue;
        if (cull && !cull.call(camera, b.x, b.y, b.z, b.visualRadius)) continue;

        // Texture-array layer comes from the integrator (CONTRACT.md "帧内 layer 字段"):
        // draw() must not call layerOf / build keys. Missing or negative -> layer 0.
        let layer = b.layer | 0;
        if (layer < 0) layer = 0;

        const spin = b.spinRad || 0;
        const cs = Math.cos(spin);
        const sn = Math.sin(spin);
        const p0 = instCount * INST_FLOATS;
        instData[p0] = cs; instData[p0 + 1] = 0; instData[p0 + 2] = -sn; instData[p0 + 3] = 0;
        instData[p0 + 4] = 0; instData[p0 + 5] = 1; instData[p0 + 6] = 0; instData[p0 + 7] = 0;
        instData[p0 + 8] = sn; instData[p0 + 9] = 0; instData[p0 + 10] = cs; instData[p0 + 11] = 0;
        instData[p0 + 12] = b.x; instData[p0 + 13] = b.y; instData[p0 + 14] = b.z;
        instData[p0 + 15] = 1;
        instData[p0 + 16] = b.visualRadius;
        instData[p0 + 17] = layer;
        instData[p0 + 18] = b.opacity;
        instCount++;
      }
      if (instCount > 0) {
        updateBuffer(gl, instBuf, instData, 0, 0, instCount * INST_FLOATS);
        gl.useProgram(bodyProg.program);
        gl.uniformMatrix4fv(bodyProg.u.uViewProj, false, viewProj);
        gl.uniform3fv(bodyProg.u.uCamPos, eye);
        gl.uniform3f(bodyProg.u.uSunLight, lightR, lightG, lightB);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY,
          texSet && texSet.layerCount > 0 && texSet.handle ? texSet.handle : fallbackTex);
        gl.uniform1i(bodyProg.u.uTex, 0);
        gl.enable(gl.CULL_FACE);
        gl.depthMask(true);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(bodyVao.vao);
        gl.drawElementsInstanced(gl.TRIANGLES, sphereIndexCount, gl.UNSIGNED_SHORT, 0, instCount);
        drawCalls++;
        triangles += instCount * sphereTris;
      }

      // ---- sun core --------------------------------------------------------
      if (sunVisible) {
        model[0] = coreRadius; model[1] = 0; model[2] = 0; model[3] = 0;
        model[4] = 0; model[5] = coreRadius; model[6] = 0; model[7] = 0;
        model[8] = 0; model[9] = 0; model[10] = coreRadius; model[11] = 0;
        model[12] = 0; model[13] = 0; model[14] = 0; model[15] = 1;

        gl.useProgram(sunProg.program);
        gl.uniformMatrix4fv(sunProg.u.uViewProj, false, viewProj);
        gl.uniformMatrix4fv(sunProg.u.uModel, false, model);
        gl.uniform3fv(sunProg.u.uCamPos, eye);
        gl.uniform1f(sunProg.u.uMix, sunMix);
        gl.uniform1f(sunProg.u.uFlash, sunFlash);
        gl.uniform1f(sunProg.u.uRemnant, sunRemnant);
        gl.uniform1i(sunProg.u.uOctaves, octaves);
        gl.uniform1f(sunProg.u.uTime, ft);
        gl.enable(gl.CULL_FACE);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(sunVao.vao);
        gl.drawElements(gl.TRIANGLES, sphereIndexCount, gl.UNSIGNED_SHORT, 0);
        drawCalls++;
        triangles += sphereTris;
      }

      // ---- atmosphere shells: one instanced draw call ----------------------
      if (atmShells.size > 0) {
        let atmCount = 0;
        for (let i = 0; i < capped && atmCount < MAX_INSTANCES; i++) {
          const b = bodies[i];
          if (!b || b.visible === false) continue;
          const shell = atmShells.get(b.id);
          if (!shell || !(b.visualRadius > 0) || !(b.opacity > 0)) continue;
          const ar = b.visualRadius + shell.shell;
          if (cull && !cull.call(camera, b.x, b.y, b.z, ar)) continue;
          const p1 = atmCount * INST_FLOATS;
          atmData[p1] = 1; atmData[p1 + 1] = 0; atmData[p1 + 2] = 0; atmData[p1 + 3] = 0;
          atmData[p1 + 4] = 0; atmData[p1 + 5] = 1; atmData[p1 + 6] = 0; atmData[p1 + 7] = 0;
          atmData[p1 + 8] = 0; atmData[p1 + 9] = 0; atmData[p1 + 10] = 1; atmData[p1 + 11] = 0;
          atmData[p1 + 12] = b.x; atmData[p1 + 13] = b.y; atmData[p1 + 14] = b.z;
          atmData[p1 + 15] = 1;
          atmData[p1 + 16] = ar;
          atmData[p1 + 17] = shell.colorIdx;
          atmData[p1 + 18] = b.opacity;
          atmCount++;
        }
        if (atmCount > 0) {
          updateBuffer(gl, atmBuf, atmData, 0, 0, atmCount * INST_FLOATS);
          gl.useProgram(atmProg.program);
          gl.uniformMatrix4fv(atmProg.u.uViewProj, false, viewProj);
          gl.uniform3fv(atmProg.u.uCamPos, eye);
          gl.uniform3fv(atmProg.u.uColors, atmColors);
          gl.enable(gl.CULL_FACE);
          gl.depthMask(false);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.bindVertexArray(atmVao.vao);
          gl.drawElementsInstanced(gl.TRIANGLES, sphereIndexCount, gl.UNSIGNED_SHORT, 0, atmCount);
          drawCalls++;
          triangles += atmCount * sphereTris;
        }
      }

      // ---- additive sun halo billboard -------------------------------------
      if (sunVisible && glowScale > 0) {
        const glowIntensity = 0.9 * (1 - 0.45 * sunCollapse) + 6 * sunFlash;
        if (glowIntensity > 0.01) {
          gl.useProgram(glowProg.program);
          gl.uniformMatrix4fv(glowProg.u.uViewProj, false, viewProj);
          if (camera.view) gl.uniformMatrix4fv(glowProg.u.uView, false, camera.view);
          gl.uniform3fv(glowProg.u.uCenter, SUN_POS);
          gl.uniform1f(glowProg.u.uRadius, coreRadius * glowScale * (1 + 1.5 * sunFlash));
          gl.uniform1f(glowProg.u.uIntensity, glowIntensity);
          gl.uniform1f(glowProg.u.uMix, sunMix);
          gl.uniform1f(glowProg.u.uFlash, sunFlash);
          gl.disable(gl.CULL_FACE);
          gl.depthMask(false);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.bindVertexArray(quadVao.vao);
          gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
          drawCalls++;
          triangles += 2;
        }
      }

      // ---- supernova shock front: additive ring sweeping the orbital plane ---
      // frame.sun.shock is the 0..1 progress, frame.sun.shockRadius the reach in
      // view units (both from world.js). The front leaves from the sun's full
      // (pre-collapse) surface. Depth test off so it passes over planets.
      const shock = sun && sun.shock > 0 ? sun.shock : 0;
      if (shock > 0 && shock < 1 && sun.shockRadius > sunRadius) {
        gl.useProgram(shockProg.program);
        gl.uniformMatrix4fv(shockProg.u.uViewProj, false, viewProj);
        gl.uniform1f(shockProg.u.uRadius, sun.shockRadius);
        gl.uniform1f(shockProg.u.uInner, sunRadius / sun.shockRadius);
        gl.uniform1f(shockProg.u.uProgress, shock);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindVertexArray(quadVao.vao);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        gl.enable(gl.DEPTH_TEST);
        drawCalls++;
        triangles += 2;
      }

      // ---- particles -------------------------------------------------------
      const parts = frame.particles;
      let partCount = 0;
      if (parts && maxParticles > 0) {
        const limit = parts.length < maxParticles ? parts.length : maxParticles;
        for (let i = 0; i < limit; i++) {
          const p = parts[i];
          if (!p || !(p.opacity > 0.004)) continue;
          const p2 = partCount * PART_FLOATS;
          partData[p2] = p.x; partData[p2 + 1] = p.y; partData[p2 + 2] = p.z;
          const c = p.color;
          if (c) {
            partData[p2 + 3] = c[0]; partData[p2 + 4] = c[1]; partData[p2 + 5] = c[2];
          } else {
            partData[p2 + 3] = 1; partData[p2 + 4] = 1; partData[p2 + 5] = 1;
          }
          partData[p2 + 6] = p.size || 2;
          partData[p2 + 7] = p.opacity;
          partCount++;
        }
      }
      if (partCount > 0) {
        updateBuffer(gl, partBuf, partData, 0, 0, partCount * PART_FLOATS);
        gl.useProgram(partProg.program);
        gl.uniformMatrix4fv(partProg.u.uViewProj, false, viewProj);
        gl.uniform1f(partProg.u.uPointScale, pointScale);
        gl.uniform1f(partProg.u.uSoft, soft);
        gl.disable(gl.CULL_FACE);
        gl.depthMask(false);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindVertexArray(partVao.vao);
        gl.drawArrays(gl.POINTS, 0, partCount);
        drawCalls++;
      }

      // ---- full-screen mask (loop seam / wall-clock resync) -----------------
      // Drawn last, with the depth test off, so it covers stars, halo and particles.
      if (flashOverlay > 0.002) {
        gl.useProgram(maskProg.program);
        gl.uniform1f(maskProg.u.uAlpha, flashOverlay);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(quadVao.vao);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        gl.enable(gl.DEPTH_TEST);
        drawCalls++;
        triangles += 2;
      }

      gl.bindVertexArray(null);
      gl.depthMask(true);

      const st = scene.stats;
      if (st) {
        st.draws++;
        st.drawCalls = drawCalls;
        st.triangles = triangles;
        st.lastMs = nowMs() - t0;
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      texSet = null;
      for (let i = 0; i < vaos.length; i++) destroyVAO(gl, vaos[i]);
      for (let i = 0; i < buffers.length; i++) destroyBuffer(gl, buffers[i]);
      for (let i = 0; i < programs.length; i++) destroyProgram(gl, programs[i]);
      vaos.length = 0;
      buffers.length = 0;
      programs.length = 0;
      if (fallbackTex) {
        gl.deleteTexture(fallbackTex);
        fallbackTex = null;
      }
    },
  };

  return scene;
}
