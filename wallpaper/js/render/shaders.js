// GLSL ES 3.00 sources for the wallpaper renderer (WebGL2 only, no extensions).
//
// Scene conventions: y up, orbital plane XZ, the sun at the origin. All world-space
// values are already in *view units* (the post-mapping scale from lib/scale.js) —
// nothing here rescales anything.
//
// Pass / attribute / uniform map (locations are declared in the shaders):
//
//   BODY_VS + BODY_FS   instanced planet spheres, textured via sampler2DArray
//     attribs 0 aPosition(vec3) 1 aNormal(vec3) 2 aUv(vec2)
//             3..6 aModel(mat4, unit scale: rotation+translation)
//             7 aRadius(float, view units) 8 aLayer(float) 9 aOpacity(float)
//     uniforms uViewProj, uCamPos, uTex, uSunLight
//   BODY_VS + ATM_FS    additive atmosphere shells (same instance layout; aLayer = colour slot)
//     uniforms uViewProj, uCamPos, uColors[4]
//   SUN_VS  + SUN_FS    procedural sun core (non-instanced unit sphere)
//     uniforms uViewProj, uModel, uCamPos, uMix, uFlash, uRemnant, uOctaves, uTime
//   GLOW_VS + GLOW_FS   additive camera-facing billboard halo
//     uniforms uViewProj, uView, uCenter, uRadius, uIntensity, uMix, uFlash
//   SHOCK_VS + SHOCK_FS supernova shock front: additive ring expanding in the XZ plane
//     attribs 0 aCorner(vec2) 1 aUv(vec2)  uniforms uViewProj, uRadius, uInner, uProgress
//   SKY_VS  + SKY_FS    star field drawn as POINTS, one vertex per star
//     attribs 0 aDir(vec3, unit) 1 aBrightness(float) 2 aSize(float, CSS px)
//     uniforms uViewProj, uPointScale, uSoft
//     (no extinction uniform: the caller re-uploads the brightness buffer)
//   LINE_VS + LINE_FS   orbit rings (LINE_LOOP over the unit ring mesh)
//     attribs 0 aPosition(vec3)  uniforms uViewProj, uModel, uColor, uHead, uTrail
//   PART_VS + PART_FS   additively blended particles (POINTS)
//     attribs 0 aPosition(vec3) 1 aColor(vec3) 2 aSize(float) 3 aOpacity(float)
//     uniforms uViewProj, uPointScale, uSoft
//   MASK_VS + MASK_FS    full-screen white mask, drawn last (loop seam / resync flash)
//     attribs 0 aPosition(vec2)  uniforms uAlpha

/**
 * Planet spheres (instanced) and atmosphere shells (same VS, additive FS).
 * Lighting: the sun at the origin is the only light source; the local sphere is
 * scaled by the per-instance radius before the model matrix is applied.
 */
export const BODY_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in mat4 aModel;
layout(location = 7) in float aRadius;
layout(location = 8) in float aLayer;
layout(location = 9) in float aOpacity;

uniform mat4 uViewProj;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
flat out float vLayer;
out float vOpacity;

void main() {
  vec4 world = aModel * vec4(aPosition * aRadius, 1.0);
  vWorldPos = world.xyz;
  vNormal = mat3(aModel) * aNormal;
  vUv = aUv;
  vLayer = aLayer;
  vOpacity = aOpacity;
  gl_Position = uViewProj * world;
}
`;

/**
 * Opaque planet surface: texture array sample, wrapped Lambert with a soft
 * terminator, a faint cool ambient so night sides still read as spheres, a broad
 * specular lobe, limb darkening and a thin cool rim.
 */
export const BODY_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
flat in float vLayer;
in float vOpacity;

uniform sampler2DArray uTex;
uniform vec3 uCamPos;
uniform vec3 uSunLight;                          // sunlight colour * intensity (scene.js)

out vec4 outColor;

const vec3 SKY_COOL = vec3(0.30, 0.40, 0.62);   // starlight fill on the night side

void main() {
  if (vOpacity < 0.004) discard;

  vec3 N = normalize(vNormal);
  vec3 L = normalize(-vWorldPos);            // the sun sits at the origin
  vec3 V = normalize(uCamPos - vWorldPos);
  float ndl = dot(N, L);
  float lit = max(ndl, 0.0);
  float ndv = max(dot(N, V), 0.0);

  vec3 albedo = texture(uTex, vec3(vUv, vLayer)).rgb;

  // wrapped diffuse: the terminator softens into the night side instead of cutting hard
  float diff = pow(clamp((ndl + 0.15) / 1.15, 0.0, 1.0), 1.4);
  vec3 col = albedo * uSunLight * (0.86 * diff + 0.03);
  col += albedo * uSunLight * pow(lit, 3.0) * 0.16;  // warm sunward hemisphere
  col += albedo * SKY_COOL * 0.11 * (1.0 - 0.5 * lit);

  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 26.0) * lit;
  col += uSunLight * spec * 0.09;

  float limb = 1.0 - ndv;
  col *= 1.0 - 0.36 * limb * limb;                   // limb darkening
  col += SKY_COOL * pow(limb, 4.0) * 0.07;           // cool rim keeps the silhouette readable
  outColor = vec4(col, vOpacity);
}
`;

/**
 * Additive atmosphere/rime shell: fresnel rim, brighter on the sunward side.
 * aLayer carries the shell's colour slot (0..3) into uColors.
 */
export const ATM_FS = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
flat in float vLayer;
in float vOpacity;

uniform vec3 uCamPos;
uniform vec3 uColors[4];

out vec4 outColor;

void main() {
  if (vOpacity < 0.004) discard;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  float ndv = max(dot(N, V), 0.0);
  float rim = pow(1.0 - ndv, 2.6);
  float ndl = max(dot(N, normalize(-vWorldPos)), 0.0);
  float a = rim * (0.22 + 0.78 * ndl) * 0.95 * vOpacity;
  if (a < 0.002) discard;
  vec3 base = uColors[int(clamp(vLayer + 0.5, 0.0, 3.0))];
  // slightly whiter where the rim is thinnest (forward scattering near the limb)
  vec3 c = mix(base, vec3(0.85, 0.95, 1.0), pow(1.0 - ndv, 6.0) * 0.45);
  outColor = vec4(c * a, 0.0);               // premultiplied, blended with ONE/ONE
}
`;

/** Sun core geometry (a unit sphere scaled by uModel). */
export const SUN_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;

uniform mat4 uViewProj;
uniform mat4 uModel;

out vec3 vLocal;
out vec3 vNormal;
out vec3 vWorldPos;

void main() {
  vLocal = aPosition;
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uViewProj * world;
}
`;

/**
 * Emissive sun surface: 3D value-noise fbm granulation (bright cells, darker lanes,
 * a few sunspots) that slowly convects with uTime, plus a chromosphere rim.
 * uMix    0..1  reddening as the loop progresses
 * uFlash  0..1  supernova white-out
 * uRemnant 0..1 collapse into a remnant / black-hole point (dark disc + hot ring + core dot)
 * uOctaves       fbm octave count (quality lever)
 * uTime          loop time in seconds (the seam flash hides the wrap)
 */
export const SUN_FS = `#version 300 es
precision highp float;

in vec3 vLocal;
in vec3 vNormal;
in vec3 vWorldPos;

uniform vec3 uCamPos;
uniform float uMix;
uniform float uFlash;
uniform float uRemnant;
uniform int uOctaves;
uniform float uTime;

out vec4 outColor;

float hash13(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

float fbm(vec3 p, int octaves) {
  float amp = 0.5;
  float sum = 0.0;
  vec3 q = p;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves || i >= uOctaves) break;
    sum += amp * vnoise(q);
    q *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  float ndv = max(dot(N, V), 0.0);

  // slow convection: the two noise layers drift against each other
  vec3 drift = vec3(uTime * 0.040, uTime * 0.026, -uTime * 0.031);
  float cells = fbm(vLocal * 3.0 + drift, 6);
  float grain = fbm(vLocal * 9.5 - drift * 1.5 + vec3(4.7, 1.3, 8.9), 4);
  float g = cells * 0.75 + grain * 0.45;
  float surf = smoothstep(0.30, 0.78, g);                 // bright granules
  float lane = 1.0 - smoothstep(0.38, 0.60, g);           // darker inter-granule lanes
  float spot = 1.0 - smoothstep(0.21, 0.30, fbm(vLocal * 1.6 + drift * 0.5 + vec3(9.1, 2.2, 5.5), 3));

  const vec3 HOT = vec3(1.0, 0.965, 0.847);   // #fff6d8
  const vec3 MID = vec3(1.0, 0.702, 0.278);   // #ffb347
  const vec3 DEEP = vec3(1.0, 0.369, 0.169);  // #ff5e2b

  // red-giant phase: the whole palette slides towards orange-red
  vec3 hot = mix(HOT, vec3(1.0, 0.74, 0.44), uMix);
  vec3 mid = mix(MID, vec3(1.0, 0.42, 0.16), uMix);
  vec3 deep = mix(DEEP, vec3(0.72, 0.13, 0.05), uMix);

  vec3 col = mix(mid, hot, surf);
  col = mix(col, deep, lane * 0.55);
  col = mix(col, deep * 0.5, spot * (1.0 - uMix) * 0.55);
  col *= 0.90 + 0.16 * ndv;                                // gentle centre brightening

  // chromosphere: the limb glows orange and blends into the additive halo outside
  float fres = pow(1.0 - ndv, 2.4);
  vec3 rim = mix(vec3(1.0, 0.62, 0.22), vec3(1.0, 0.30, 0.08), uMix);
  col = mix(col, rim, fres * 0.72);
  col += rim * fres * (0.30 + 0.45 * uMix);

  if (uRemnant > 0.0) {
    float ring = pow(1.0 - ndv, 6.0);
    float core = pow(ndv, 40.0);
    vec3 rem = vec3(0.012, 0.012, 0.016) * (1.0 - ring)
             + vec3(1.0, 0.62, 0.28) * ring * (1.6 + 0.6 * surf)
             + vec3(1.0, 0.93, 0.80) * core * 3.0;
    col = mix(col, rem, uRemnant);
  }

  // the flash goes on top of everything, so the remnant only shows once it decays
  col = mix(col, vec3(1.0, 0.99, 0.96), uFlash);
  col *= 1.0 + 3.0 * uFlash;

  outColor = vec4(col, 1.0);
}
`;

/** Camera-facing billboard quad used for the sun halo. */
export const GLOW_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec2 aUv;

uniform mat4 uViewProj;
uniform mat4 uView;
uniform vec3 uCenter;
uniform float uRadius;

out vec2 vUv;

void main() {
  vec3 right = vec3(uView[0][0], uView[1][0], uView[2][0]);
  vec3 up = vec3(uView[0][1], uView[1][1], uView[2][1]);
  vec3 world = uCenter + (right * aCorner.x + up * aCorner.y) * uRadius;
  vUv = aUv;
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

/**
 * Two-layer additive halo: a tight bright chromosphere glow plus a broad faint
 * corona; blended with ONE/ONE (premultiplied colour).
 */
export const GLOW_FS = `#version 300 es
precision highp float;

in vec2 vUv;

uniform float uIntensity;
uniform float uMix;
uniform float uFlash;

out vec4 outColor;

void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float r = length(d);
  if (r >= 1.0) discard;
  float core = pow(1.0 - r, 5.0);
  float wide = pow(1.0 - r, 1.8) * 0.22;
  vec3 inner = mix(vec3(1.0, 0.93, 0.74), vec3(1.0, 0.55, 0.30), uMix);
  vec3 outer = mix(vec3(1.0, 0.52, 0.16), vec3(0.95, 0.24, 0.08), uMix);
  vec3 col = inner * core + outer * wide;
  col += vec3(1.0) * uFlash * (1.0 - r);
  outColor = vec4(col * uIntensity, 0.0);
}
`;

/**
 * Supernova shock front: a ring in the orbital plane (XZ, centred on the sun) whose
 * radius grows with uProgress (0..1) over the quad's uRadius. Additive, no depth
 * test, so it sweeps over planets as it passes them.
 */
export const SHOCK_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec2 aUv;

uniform mat4 uViewProj;
uniform float uRadius;

out vec2 vUv;

void main() {
  vUv = aUv;
  gl_Position = uViewProj * vec4(aCorner.x * uRadius, 0.0, aCorner.y * uRadius, 1.0);
}
`;

export const SHOCK_FS = `#version 300 es
precision highp float;

in vec2 vUv;

uniform float uProgress;
uniform float uInner;                 // start radius (the sun's surface) / uRadius

out vec4 outColor;

void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float r = length(d);
  float front = uInner + (1.0 - uInner) * (1.0 - pow(1.0 - uProgress, 1.6)); // fast, then decelerating
  if (r > front) discard;
  float w = (0.05 + 0.14 * uProgress) * (1.0 - uInner);   // the shell thickens as it expands
  float x = (front - r) / w;                             // 0 at the leading edge, grows inward
  float shell = exp(-x * x) + 0.10 * exp(-x * 0.9);
  float fade = pow(1.0 - uProgress, 1.4);
  vec3 col = mix(vec3(1.0, 0.96, 0.88), vec3(1.0, 0.50, 0.18), clamp(x * 0.5, 0.0, 1.0));
  outColor = vec4(col * shell * fade * 1.4, 0.0);
}
`;

/**
 * Star field. Directions are pushed to the far plane by writing z = w (depth == 1),
 * so the field is independent of the camera's far plane; brightness rides in the
 * attribute buffer and is refreshed when extinction advances. Sizes above 8 px are
 * the faint, large "dust" sprites that build the galactic band (mesh.makeStarField).
 */
export const SKY_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aDir;
layout(location = 1) in float aBrightness;
layout(location = 2) in float aSize;

uniform mat4 uViewProj;
uniform float uPointScale;

out float vBrightness;
out vec3 vColor;
out float vDust;

void main() {
  vec4 clip = uViewProj * vec4(aDir, 0.0);
  gl_Position = vec4(clip.xy, clip.w, clip.w);
  gl_PointSize = uPointScale * aSize;
  vBrightness = aBrightness;
  // deterministic per-star colour temperature: a few orange, a few blue-white
  float h = fract(sin(dot(aDir, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  vec3 tint = h < 0.12 ? vec3(1.0, 0.80, 0.60) : (h > 0.84 ? vec3(0.76, 0.85, 1.0) : vec3(1.0, 0.97, 0.92));
  vDust = aSize > 8.0 ? 1.0 : 0.0;
  vColor = mix(tint, vec3(0.62, 0.66, 1.0), vDust);
}
`;

export const SKY_FS = `#version 300 es
precision highp float;

in float vBrightness;
in vec3 vColor;
in float vDust;

uniform float uSoft;

out vec4 outColor;

void main() {
  if (vBrightness <= 0.004) discard;
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float disc = (1.0 - r2) * (1.0 - r2);
  disc *= mix(1.0, 1.0 - r2, vDust);           // dust sprites fall off even more softly
  float a = mix(1.0, disc, uSoft);
  outColor = vec4(vColor * (vBrightness * 1.6) * a, 0.0);
}
`;

/**
 * Orbit rings: unit circle scaled + translated by uModel, flat colour per ring.
 * uHead is the body's current angle on the ring (atan2(z, x) in the ring's local
 * frame); with uTrail = 1 the line is brightest just behind the body and fades
 * along the lap, like a trail. uTrail = 0 draws a uniform line.
 */
export const LINE_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform float uHead;
uniform float uTrail;

out float vFade;

const float TAU = 6.28318530718;

void main() {
  gl_Position = uViewProj * uModel * vec4(aPosition, 1.0);
  float a = atan(aPosition.z, aPosition.x);
  float behind = fract((uHead - a) / TAU);       // 0 at the body, -> 1 a full lap behind
  float trail = 0.28 + 0.72 * pow(1.0 - behind, 2.2);
  vFade = mix(1.0, trail, uTrail);
}
`;

export const LINE_FS = `#version 300 es
precision highp float;

in float vFade;

uniform vec4 uColor;

out vec4 outColor;

void main() {
  outColor = vec4(uColor.rgb, uColor.a * vFade);
}
`;

/** Particles (POINTS): position/colour/size/opacity are rebuilt every frame. */
export const PART_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aColor;
layout(location = 2) in float aSize;
layout(location = 3) in float aOpacity;

uniform mat4 uViewProj;
uniform float uPointScale;

out vec3 vColor;
out float vOpacity;

void main() {
  gl_Position = uViewProj * vec4(aPosition, 1.0);
  gl_PointSize = uPointScale * aSize;
  vColor = aColor;
  vOpacity = aOpacity;
}
`;

export const PART_FS = `#version 300 es
precision highp float;

in vec3 vColor;
in float vOpacity;

uniform float uSoft;

out vec4 outColor;

void main() {
  if (vOpacity <= 0.004) discard;
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float a = mix(1.0, (1.0 - r2) * (1.0 - r2), uSoft) * vOpacity;
  outColor = vec4(vColor * a, 0.0);
}
`;
/**
 * Full-screen mask. The scene snaps from the end of the loop back to t = 0, and a
 * wall-clock resume can jump an arbitrary distance; both are hidden behind a white
 * flash rather than a silent cut (PLAN.md §4.4 / §5 Phase 3). Drawn last, with
 * depth testing off and normal alpha blending — it must cover everything, including
 * the additive halo and particles.
 */
export const MASK_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const MASK_FS = `#version 300 es
precision highp float;

uniform float uAlpha;

out vec4 outColor;

void main() {
  outColor = vec4(1.0, 0.97, 0.92, uAlpha);
}
`;
