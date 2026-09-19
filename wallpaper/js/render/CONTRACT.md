# 渲染层接口契约（冻结，Phase 2 起点）

供 `wallpaper/js/render/*` 与 `wallpaper/js/{camera,hud,main}.js` 共同遵循。任何一方都不得单方面改动本契约；需要变更先改本文件。

## 运行环境

- Wallpaper Engine Web 壁纸（CEF，Chromium），**WebGL2 / GLSL ES 3.00**。发布产物是**单个经典脚本** `wallpaper/bundle.js`（由 `tools/build-bundle.mjs` 把 ESM 源码内联；WE 从普通文件夹加载时 `file://` 的模块与 `fetch` 都不可靠）。源码本身仍是 ESM，`wallpaper/js/lib/**` 可直接在 Node 下测试。
- 零依赖、零网络请求、零外部素材。所有贴图程序化生成。
- **逐帧零分配**：不得在 `draw()` 里 `new` 对象/数组/`Float32Array`；所有缓冲预分配。热路径里禁用闭包分配。
- 不依赖 DOM，除 `gl` 与传入的 frame 对象外不引用全局。

## 帧内 `layer` 字段（**契约补充 2026-09-17**）

`main.js`（集成方）负责把贴图层号写进 `frame.bodies[i].layer`（`int`）：它只在**变体变化时**调用一次 `texSet.layerOf(textureKey, variant)` 并缓存。

- 渲染器**必须**直接读 `b.layer`（缺省 0），**不得**在 `draw()` 内调用 `layerOf`、拼接字符串或查 Map（那会破坏"逐帧零分配"）。
- 缺少 `layer` 时按 0 处理（不得抛错）。
- `textureKey === null` 的节点（未声明 `texture` 的虚拟节点，如沙漏双星质心）**不是**可绘制天体：`main.js` 给它 `layer = 0` 且不调用 `layerOf`（否则会烘出一层永不绘制的贴图），渲染器也要按"该天体不该被提交"处理。

## 数据源（`wallpaper/data/*.json`）

`bodies.json`：
```
meta · sun{radiusM,radiusSource} · quantumHosts[] · clearance[]
bodies[] : { id, name, nameEn, internal, primary, frame:"root"|"heliocentric"|"local",
             virtual?, radiusM, radiusSource, atmosphereM?, massKg?,
             orbit: null | { kind:"circle"|"ellipse"|"drift"|"host-switch", distanceM|aM+eM|distanceStartM,
                             periodS, phaseDeg, perihelionEpochS?, variants? },
             rotation: { periodS|null, tidalLock? },
             texture: { key, palette:[hex,hex,hex], variants:[...] } }
```
`events.json`：`meta{cycleS,prng} · sunRadius{anchors,segments} · sunStation{...} · interloper{...} · events[] · decorative[] · dropped[] · quantumMoon{...}`

## world 采样输出（`wallpaper/js/lib/world.js` 提供给渲染层）

`world.sample(t, observer?)` 返回**同一个被复用的对象**（不得保留引用跨帧）：

```js
frame = {
  t, cyclePhase,                       // number
  sun: { realRadius, visualRadius, mix, flash, remnant, visible,
         collapse, shock, shockRadius },   // 补充 2026-09-19：collapse 0..1 核心坍缩进度；shock 0..1 超新星激波前沿进度；shockRadius 前沿最远视距
  bodies: [ { id, x, y, z, visualRadius, spinRad, textureKey, variant, opacity, visible } ],
  orbits: [ { id, cx, cz, radiusVisual, color: [r,g,b], visible } ],
  particles: [ { kind, x, y, z, size, color:[r,g,b], opacity } ],   // 可为空数组
  flags: { sandFlowing, blackHole, telescope, ... }
}
```
坐标：**y 轴朝上**，轨道平面为 XZ，太阳在原点，单位 = 视单位（1 视单位 ≈ 1 屏幕单位）。所有位置已经过尺度映射，渲染层不得再做缩放。

## 相机（`wallpaper/js/camera.js` 提供）

```js
camera = {
  eye: Float32Array(3), target: Float32Array(3), up: Float32Array(3),
  fovY, aspect, near, far, zoom,
  view: Float32Array(16), proj: Float32Array(16), viewProj: Float32Array(16),
  frustum: { planes: Float32Array(24) },        // 6 × (nx,ny,nz,d)
  visibleSphere(x, y, z, r) -> boolean
}
```

## 渲染器契约（`wallpaper/js/render/scene.js`）

```js
import { createScene } from './render/scene.js';
const scene = createScene(gl, { starCount: 12000, orbitSegments: 256, maxParticles: 4096 });
scene.setTextures(texSet);              // 来自 textures.js，可多次调用（惰性变体补齐后重设）
scene.resize(widthPx, heightPx, dpr); // width/height 已是 framebuffer 像素，dpr 仅用于粒子尺寸
scene.draw(frame, camera, opts);        // opts: { orbitLines:true, stars:true, quality:'high'|'low' }
scene.setStarExtinction(progress01);    // 星空熄灭进度（0..1），内部节流到 ≥1 次/2s 才重传缓冲
scene.setStarBrightness(multiplier);    // starBrightness 用户属性（0..4），立即重传星表亮度
scene.setFlashOverlay(alpha);           // 全屏白闪遮盖（0..1）：循环接缝 / 挂机恢复的硬切用它遮住
scene.stats = { drawCalls, draws, lastMs, triangles };
scene.dispose();
```

- 批次（每帧 draw call 目标 ≤ 12）：星空 POINTS（1）· 天体球 instanced（1）· 大气壳（1）· 太阳核 + billboard 辉光（2）· 轨道线（~10，每环 1）· 粒子 POINTS（1）· 超新星激波环（仅 `0 < sun.shock < 1` 时 1）· 白闪遮盖（仅在 alpha > 0 时 1）。
- 遮盖最后绘制：关闭深度测试、`SRC_ALPHA/ONE_MINUS_SRC_ALPHA`，必须盖住加性辉光与粒子（否则接缝在星野熄灭→复原的瞬间仍会露出来）。
- 天体贴图必须用 `TEXTURE_2D_ARRAY` + 实例化的 **layer index**，做到**单次 draw call 画完所有天体**（每体的变体 = 不同层）。
- 光照：唯一光源 = 原点的太阳（方向光）；包裹式 Lambert（柔和明暗线）+ 微弱冷色环境光 + 宽高光 + 边缘暗化；光色随 `sun.mix` 由暖白转橙红、随 `sun.collapse` 变暗、随 `sun.flash` 爆白。无阴影、无后处理、无 bloom（太阳辉光用双层加性 billboard）。
- 太阳不贴图：程序化噪声（米粒组织随 `frame.t` 缓慢对流）+ 色球层边缘；`sun.mix` 驱动转红，`sun.flash` 驱动超新星白闪，`sun.collapse` 让核心缩小到约 1/4，`sun.remnant` 时表现为残骸/黑洞点；`sun.shock` 驱动 XZ 平面上的加性激波环从太阳表面扫到 `sun.shockRadius`。
- 星空：`mesh.makeStarField` 输出 `dirs / brightness / sizes` 三个缓冲；一部分星集中在一条倾斜的银河带上，少量大而暗的"尘埃"精灵（size > 8 px）构成带的雾感；星色按方向确定性分为橙 / 白 / 蓝白。
- 轨道线：每环按其天体当前相位做"尾迹"渐变（天体正后方最亮，绕一圈渐暗）；天体不可见时画均匀线。渲染器在帧对象首次出现（或 orbits 长度变化）时缓存 orbit→body 索引，`draw()` 内不查表。
- 大气壳：`createScene` 的 `atmospheres` 选项每项可为厚度数值或 `{ shell, color:[r,g,b] }`（最多 4 种颜色，槽位经实例的 `aLayer` 传入着色器）。默认：深巨星 1343（青色）、木炉星 46（淡蓝）。
- 必须处理：`gl` 上下文丢失由外部负责重建 → 渲染器只需在 `dispose()` 后不再被调用。

## 贴图契约（`wallpaper/js/render/textures.js`）

```js
import { createTextureSet } from './render/textures.js';
const texSet = createTextureSet(gl, bodies, { size: 512, maxLayers: 64 });
texSet.handle                     // WebGLTexture（TEXTURE_2D_ARRAY）
texSet.layerOf(bodyId, variant)   // -> number；未知变体**回退到该 body 的第一层**，不新建层、不抛错
texSet.layerCount                 // number
texSet.bytes                      // 估算显存占用
texSet.dispose()                  // 释放纹理（上下文丢失/重建路径）
```
- 层容量：`maxLayers` 只在**确实需要新建层**时才抛 `RangeError`（烘焙失败不改变 `layerCount`）。
- 全变体需求 = **26 层**（19 个有贴图天体），运行时用 `maxLayers: 32` 即可（64 会让驱动按 64 层预留显存）。
- `bakeAll(texSet, bodies)` 预热所有已声明变体（幂等，返回本次新建的层数）。
- 等距柱状投影 2:1（默认 512×256），值噪声 + 每体调色板 + 天体特征（岩石坑、气态条带、冰壳裂纹、发光洞）。
- 变体：`wallpaper/data/bodies.json` 的 `texture.variants`，例如 `brittle_hollow: intact|holed`、`interloper: closed|open`、`opc: intact|broken`、双星 `full|empty`、`stranger: cloaked|sails`。
- 只用 `OffscreenCanvas`（或 `document.createElement('canvas')`）+ 2D context；不加载任何文件。
- 生成必须**确定性**（同 key 同结果）：内置固定种子的 PRNG。
