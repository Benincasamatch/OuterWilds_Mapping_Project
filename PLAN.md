# 《星际拓荒》太阳系 3D 复刻 —— 实施计划（v2）

> **2026-09-19 状态修订**：当前为 0.2.0-dev 本地预发布。本轮已实测横屏拖动、双屏显示和默认暂停恢复；滚轮及连续足时性能仍未通过。最新证据与未决闸门见 [STATUS.md](STATUS.md)。下面部分内容为历史设计/实测记录；预览交互通过不等于桌面交互通过。旧桌面报告缺少持续帧证据，应判为不确定。2026-09-19 新测试在核实横向屏幕后收到真实拖动，但未收到滚轮；已增加缩放按钮作为备用，尚未闭合原滚轮硬约束。

> 非官方同人作品。与 Mobius Digital 及 Annapurna Interactive 无关。
> 《Outer Wilds》及其中的名称、设定、美术归其各自版权方所有。
> 发布到 Steam Workshop 时必须随附官方免责句：*"This work is unofficial Fan Content created under permission from the Mobius Digital Fan Content Policy. It includes materials which are the property of Mobius Digital and it is neither approved nor endorsed by Mobius Digital."*

**v2 变更**：2026-09-17 复核（逐条回抓上游证据）后重写。① 修正 §2.3 对官方公告的误读与由此得出的栈变更理由；② 明确发布渠道 = Workshop；③ 引入分级一致性容差（§9.1），取代原先不可达的「逐条 ±1s」；④ 新增太阳半径曲线（§3.8）、闯入者联立解（§3.9）、设计值总表（§3.10）三张强制交付物；⑤ 新增事件逐条映射（§3.5）、目录结构（§4.5）、复核闭环表（§9.3）。

---

## 0. 已锁定的决策

| 项 | 决定 | 依据 |
|---|---|---|
| 形态 | **3D 真实轨道视图**（相机环绕/缩放/平移） | 用户决策 |
| 交付物 | **Wallpaper Engine Web 壁纸**（HTML / CSS / JS + WebGL2 静态文件目录） | 用户决策 + §2.3 |
| **发布渠道** | **Steam Workshop（Web 壁纸类型）** —— 本机自用只是副产品 | 用户决策（2026-09-17） |
| 宿主 | **Wallpaper Engine**（Web 壁纸类型） | 用户决策 |
| 天体呈现 | **贴图球体**（真实球体 + 等距柱状投影贴图，程序化生成） | 用户决策 |
| 输入 | **DOM 事件**（`pointermove` / `pointerdown` / `wheel`）——预览已验证，桌面仍待复测 | 见 §2.4 |
| 数据 | 社区源码级 datamine 表（§3.2）+ 缺失字段走设计值（§3.10） | 侦察取得源码级数据 |
| 范围 | 轨道运动 + 完整 22 分钟剧本；只读浏览 | 用户决策 |
| **循环长度** | **`t ∈ [0, 1360s)`**，含超新星后 40s 尾段（ATP 黑洞 1330）；`t→1360` 复位到初值，用超新星白闪遮盖接缝 | 复核 P0-4（原 §5 写 1320s 与事件表 1360s 冲突） |
| **一致性容差** | **分级容差**（§9.1）：锚点 ±1s / 轨道耦合 ±5s / 装饰性只约束频率 ±25% | 用户决策（2026-09-17：允许小差别） |
| **尺度策略** | 日心距离走**单调幂压缩**；**太阳半径走同一映射**（使 690s 吞没精确涌现）；卫星/互绕距离走**局部线性放大**；天体半径独立放大并有上限 | §3.7 |
| 音频 | **无**（挂机开销优先；Phase 6 之后可作为用户属性再加） | 用户未要求；避免静默期耗电 |
| 代码许可 | `LICENSE` = MIT（仅代码）；数据/署名见 `NOTICE.md` | Workshop 分发需要明确授权 |
| 硬约束 | 长期挂机开销低；壁纸状态下可拖动 + 滚轮缩放 | 用户决策 |

### 决策演进记录（为什么栈换了两次）

```
自研壁纸宿主(C++/Win32/D3D11)
   └─ 放弃：WorkerW 子窗口收不到鼠标；Raw Input 绕行成本高、风险集中
普通互动程序(C++/D3D11) + 交给 WE 托管
   └─ 放弃：目标改为"发布到 Workshop"，而 WE 2.8.42 起 Application 类型
            （含本地运行的 exe 壁纸）已无法上传 Workshop（§2.3）
WE Web 壁纸(HTML/JS/WebGL2)   ← 当前
   └─ 唯一风险：WE 是否把鼠标（尤其滚轮）转发进 CEF —— 由 Phase 0 Spike A 判定
```

> **修正记录（2026-09-17 复核）**：v1 把官方公告读成"本地也无法运行 exe 壁纸"，据此写下的理由是错的。公告原文明确 *"you can still continue to run custom app wallpapers locally on your own machine using the app, but public distribution through Steam is being sunsetted."* —— 被下架的只有 **Workshop 分发**。结论仍是 Web 壁纸，但**正确理由是"要上 Workshop"**，而不是"exe 不能本地跑"。这也意味着：如果哪天用户放弃发布，exe 路线仍可作为本机自用的备选（代价是 §2.1 的 Raw Input 绕行）。

---

## 1. 目标与验收标准

### 1.1 目标

将《星际拓荒》的太阳系复刻为一个可发布到 Steam Workshop 的 Wallpaper Engine Web 壁纸：3D 真实轨道、可拖动环绕、可滚轮缩放，天体运行逻辑覆盖全部 22 分钟剧本事件，挂机开销低，且**不含任何游戏素材**（贴图全部程序化生成）。

### 1.2 验收标准（可测）

| 项 | 标准 | 验证方式 |
|---|---|---|
| 核心交互 | 桌面为前台时，拖动旋转 + 右下角按钮缩放/复位均生效（**2026-09-19 用户决定**：桌面不转发滚轮，标准由"滚轮缩放"改写为"按钮缩放"；浏览器滚轮仅作附加能力） | `spike/input-probe/` 探针，实测截图，用户桌面点击确认 |
| 挂机开销 | 空闲（**无输入 且 无活跃事件**）时记录 CPU / GPU / 工作集，**不设硬门槛**（**2026-09-19 用户决定**：视觉优先，可接受占用上升；只要求不影响前台使用且不出现持续满载）（**实测对象**：`webwallpaper64.exe` 及其 CEF 子进程树 + `wallpaperui.exe`；单显示器 2560×1600；连续 10 分钟采样） | 任务管理器（含子进程）/ PresentMon，日志留档 |
| 交互帧率 | 拖动/缩放时 **≥ 60fps**（前置条件：WE FPS Limiter = 60、显示器 ≥ 60Hz；分辨率按实际显示器记录） | 探针 rAF 计数 + PresentMon |
| **轨道正确性** | 每个天体公转周期与 `wallpaper/data/bodies.json` 的 `periodS` **逐天体一致**（HUD 对比）；`t→1360s` 复位后与 `t=0` 初值一致 | debug HUD 输出累计角度与 `t/T` 比对；复位帧截图 |
| 自转正确性 | 自转周期与 `bodies.json` 的 `rotationPeriodS` 一致；`angularVelocity=0` 的天体不转 | debug HUD |
| **太阳半径** | `R(0)=2001.75`、`R(690)=2315`、`R(1320)=4000`（§3.8）；映射后 **690s 处太阳视半径 ≥ 太阳站视轨道半径**（吞没精确涌现） | debug HUD 打印 R 与两者视半径 |
| **事件时刻** | 按 §9.1 分级容差：锚点 ±1s；轨道耦合事件 ±5s 且残差表留档；装饰性事件只约束频率 ±25% | debug HUD 打点日志 + `test/` 断言 |
| WebGL2 / GPU | `WEBGL_debug_renderer_info` 的 UNMASKED_RENDERER **不是 SwiftShader**；`EXT_texture_filter_anisotropic` 可用；10 分钟内无 context lost | debug HUD 首帧打印 + 日志 |
| 无网络请求 | 所有资源随壁纸打包，运行期零请求 | DevTools Network 面板为空 |
| Workshop 合规 | 无游戏素材、无商业字体、免费、无 NFT、注明非官方 | §7 清单逐项打勾 |

> 注：挂机开销阈值比原生 C++ 方案放宽（3% / 5%），因为 CEF + WebGL2 有固定基线，这是选 Web 栈的固有代价。

---

## 2. 关键侦察结论（逐条有据）

### 2.1 为什么不自研壁纸宿主（**已放弃，存档**）

- 所有壁纸宿主都用 **WorkerW / Progman 父子窗口**技术把渲染窗口挂在桌面图标层之下，而 **SHELLDLL_DefView / SysListView32（桌面图标层）在其之上** → 纯 WorkerW 子窗口**收不到真实鼠标事件**。
- Lively 用 `RIDEV_INPUTSINK` + `PostMessage` 合成转发绕行，但**滚轮分支在源码里被整段注释掉**（`RawInputMsgWindow.xaml.cs`，注释原文 `Disabled, not tested yet`），维护者承认做不了（issue **#3042**，open）；issue **#853**（2021 起 open）报告 Web 壁纸滚轮与拖动失效。
- Win11 上 WorkerW 结构已变（`Progman` 新增 `WS_EX_NOREDIRECTIONBITMAP`、`DefView` 变 layered child、`0x052C` 需 `wParam=0xD, lParam=0x1`），需双分支。
- **结论：自研宿主成本高、风险集中，放弃。**

### 2.2 性能：不能指望宿主全权代劳

- **Lively 无全局 FPS 上限**（`SettingsModel.cs` 全文件无该字段），靠 `DebugActiveProcess` 冻结子进程暂停。
- Lively 对 Application 壁纸禁用暂停；参考实测：Godot Forward+ ~350MB vs Compatibility ~100MB（Lively #3278）。
- **对本项目的意义**：自身仍要实现**帧率上限**与**空闲降帧**，不能只依赖 WE 的 FPS Limiter。

### 2.3 WE 2.8.42 起 Application 壁纸无法上传 Workshop —— 这是栈变更的直接原因

**官方公告（Wallpaper Engine 2.8.42，发布日 2026-06-29，`appid=431960` 的 Steam 公告）**，逐字引用：

> **"Wallpaper Engine 2.8.42 - Removal of Application Wallpapers from the Workshop"**
> "this update introduces a security change to Wallpaper Engine. In the next week, we will be permanently removing the "Application" wallpaper type from the public Steam Workshop."
> "Starting with this new update, you will no longer be able to upload or download Application wallpapers to and from the Steam Workshop."
> "Application wallpapers are essentially just ordinary Windows apps that have full access to your computer."
> **"Of course, you can still continue to run custom app wallpapers locally on your own machine using the app, but public distribution through Steam is being sunsetted."**

**旁证**：WE 官方设计器文档（`docs.wallpaperengine.io`）的壁纸类型**只有三种** —— **Scene / Web / Video**，sitemap 中不存在 Application 相关页面。

→ **因为要发布到 Workshop，交付物必须是 Web 壁纸**；「普通 exe 交给 WE 托管」这条分发路径不成立（但本地运行仍可行，见 §0 修正记录）。

### 2.4 输入能力现状：滚轮能否用，文档答不了，必须实测

> **2026-09-19 勘误**：下述“通过/备选不启用”仅由预览窗口支持，不能用于判定桌面闸门已通过。旧桌面记录无持续帧证据；新探针和复测流程见 spike/README.md。

**已确证（有据）**：

| 事实 | 证据 |
|---|---|
| WE 壁纸层**能**收到鼠标位置与点击（与 Lively 不同，WE 已解决这个问题） | Scene Script 提供 `cursorMove` / `cursorDown` / `cursorUp` / `cursorClick` 四个事件；另有官方 `Cursor Ripple` 效果 |
| **Scene** 壁纸**没有滚轮**（连轮询接口都没有） | `event/cursor.html` 只列上述四个事件；`class/IInput.html` 的全部属性只有 `cursorWorldPosition` / `cursorScreenPosition` / `cursorLeftDown`，无 wheel / scroll |
| WE 官方提供**隐藏桌面图标**手段，即官方承认图标与输入的冲突 | CLI：`-control hideIcons` / `-control showIcons` |
| WE Web 壁纸**没有任何输入相关文档** | `/en/web/` 共 **12** 个页面（overview · api/icue · api/rgb · api/propertylistener · audio/media · audio/visualizer · customization/displaycondition · customization/localization · customization/properties · debug/debug · first/gettingstarted · performance/fps），输入相关页面数为 0（由站点 `sitemap.xml` 穷举） |
| WE 确实会向 Web 壁纸转发**点击**（间接证据） | WE 2.5.28 热修日志："Fixed web-based wallpaper screensavers requiring a mouse click to leave screensaver" |

**实测结论（2026-09-18，WE 2.8.42，`spike/run-input-probe.cmd` 在预览窗口内真手操作）**：

| 输入 | 结果 | 证据（`spike/beacon.log`，探针页回传） |
|---|---|---|
| **拖动** | ✅ **可用** | `mdown=3`、`up=7`、`drag=403px`、`ptr=267` |
| **滚轮** | ✅ **可用，且可取消** | `wheel=15`、`dy` 累计 ±200、`deltaMode=0`、`cancelable=true`、`preventDefault` 成功 15/15 |
| 键盘 | ✗ 不转发 | `key=0`；页面收到了 `focus` 事件（`focus=true`）却收不到任何 `keydown` —— WE 自己吃掉了按键 |

⇒ **§2.4 的最大未知项关闭**：`pointermove` / `pointerdown` / `pointerup` / **`wheel`** 全部转发进 CEF，且滚轮事件 `cancelable`，对数缩放与 `touch-action:none` 的原设计可直接用；§2.4 的三条备选路径**均不需要**。键盘交互按原计划不实现（用户属性面板承担全部设置）。

**仍未测的一项**：以上是**窗口态**（`-playInWindow`）结果。**桌面态**（壁纸铺在桌面图标层之下、桌面前景）尚未实测 —— 那才是最终验收形态，也正是 `-control hideIcons` 存在的理由（见 Spike D）。

**另有两项待实测的老化风险**：

- ~~**键盘焦点**~~（已实测关闭）：预览窗口内 `key=0` 而 `focus=true` —— 页面能拿到焦点事件，但 WE 不转发按键（热键被宿主吃掉）。⇒ 键盘交互不实现，用户属性面板承担全部设置；`main.js` 里保留的 `H/P/R` 与方向键只在浏览器/编辑器预览里可用。
- **DevTools 入口已变**：WE 2.8 变更日志原文 *"Replaced the DevTools port with built-in DevTools, as the old custom remote debugging has stopped working due to forced changes in CEF."*，而官方文档 `web/debug/debug.html` 仍在描述旧的 "CEF devtools port" 流程 → **Phase 0 必须实测 2.8+ 的 DevTools 入口**，否则整轮 spike 不可观测（R10）。
  > 本轮找到了**不依赖 DevTools 的观测通道**：探针页向 `127.0.0.1:8124` 发 beacon（HTTP 图片请求），把"WE 内部发生了什么"变成文本；`file://` 页面 → localhost 未被拦。这条通道对 Phase 4 的性能/行为验证同样适用，DevTools 只用于临时排查。

**判定手段（已交付并已完成实测）**：`spike/input-probe/index.html`（人读横幅）+ `spike/run-input-probe.cmd`（一键开窗）+ `spike/beacon-server.mjs`（机器可读回传）。结果见上表：拖动 ✅ / 滚轮 ✅ / 键盘 ✗。

**§2.4 备选路径（**结论：均不启用**）**：滚轮可用，故 §2.4 的"缩放按钮"、"换宿主 octos"、"降级纯观赏"三条备选路径全部作废，仅作为历史记录保留。

### 2.5 数据层：直接 dump 不存在，但取得了**源码级**社区 datamine

已穷举排除的渠道（均已核实内容，不是"没搜到"）：

| 渠道 | 实际结果 |
|---|---|
| `Raicuparta/ow-object-browser` 的 `objects.json` | 仅 GameObject 层级路径，**无任何组件/轨道数值** |
| `ow-mods/outer-wilds-unity-wiki` | **空仓库**（0 分支 0 提交），无 `OrbitalParameters` 页 |
| `MikelSalazar/CelestialOrrery` | 用 NH 自建静态天体（`semiMajorAxis=10000, inclination=90`），非原版值 |
| `TacoTechnica/OW_NBodyChaos` 的 `FixPlanets.cs` | 31KB，全文无 `semiMajorAxis`/`eccentricity`/`trueAnomaly` |
| `daniel12610/OuterWildsStellarVisualizer` | 自述 "**approximate** orbits" |
| GitHub / gist 全局搜索 | 无原版 `OrbitalParameters` 逐值导出 |

**但**取得了一份社区 datamine 表格（来源标注 "from the source code"、"Mister Nebula (Datamining)"），见 §3.2；手测周期表来自 `r/outerwilds` 的 AltorinianUniverse（§8.A）。

---

## 3. 数据层

### 3.1 字段定义（权威）

游戏内 `OrbitalParameters` 的字段集，由 New Horizons 的 schema 与实现确认：

```
primaryBody · isMoon · semiMajorAxis · eccentricity · inclination
longitudeOfAscendingNode · argumentOfPeriapsis · trueAnomaly · axialTilt · siderealPeriod
```

- `siderealPeriod` = 自转周期，单位**分钟**（NH schema 原文）。
- 由真近点角反解初始位置/速度的完整数学可直接复用 NH 的 `OrbitalParameters.cs`（URL 见附录）。

### 3.2 主数据源：社区 datamine 表

**来源**：Google Sheets（社区协作，含 datamining 数据）
**本地归档**：`data/sources/ow-game-data-community.csv`（sha256 `c631a2e06ca67c2255aa54d3ae84e24f92f8916dde4b8d82e2150b7ca12a1e26`，抓取于 2026-09-17，本轮复核时重新校验一致）
**贡献者**（**已补全**）：Lilac Peregrine（数据收集与整理）、Mister Nebula（**Datamining**）、**Gorfinhofin（见 CSV 首行 credit，v1 遗漏）**、Thomas（太阳半径）、Brungo（质量）、Brady（typo）
**来源标注**：`D` = datamine（表内值）· `M` = 手测（AltorinianUniverse）· `X` = 由 D/M 反解 · `★` = 本项目设计值（§3.10）

| 天体 | 半径 (m) | 质量 | 角速度 | 自转周期 (s) | 父天体 | 轨道半径 (m) | 公转周期 (s) |
|---|---|---|---|---|---|---|---|
| 太阳 Sun | 2001.75 → **4000（末段）** `D` | 4.00E+11 `D` | — | —（CSV 备注原文 "Inconclusive"） | — | — | — |
| 灰烬双星 Ash Twin | 169 `D` | 1.60E+06 `D` | 100/7 `D` | **89.75** `D` | Sun | **5000** `D` | **110.76** `D` |
| 余烬双星 Ember Twin | 170 `D` | 1.60E+06 `D` | 20 `D` | **125.66** `D` | Sun | **5000** `D` | **110.76** `D` |
| 木炉星 Timber Hearth | 254 `D` | 3.00E+06 `D` | 100 `D` | **628.31** `D` | Sun | **8593.085981** `D` | **250.25** `D` |
| 阿特勒岩 Attlerock | 80 `D` | 5.00E+07 `D` | 16.43911407 `D` | **103.29** `D` | Timber Hearth | 900 `D` | **103.29** `D` |
| 脆空 Brittle Hollow | 272 `D` | 3.00E+06 `D` | 50 `D` | **314.15** `D` | Sun | **11690.89092** `D` | **397.94** `D` |
| 空心灯 Hollow's Lantern | 97.3 `D` | 9.10E+05 `D` | 5 `D` | **31.41** `D` | Brittle Hollow | 1000 `D` | **115** `M` |
| 深巨星 Giant's Deep | 500（大气 959）`D` | 2.18E+07 `D` | **0** `D` | — | Sun | **16457.58738** `D` | **650** `M` |
| 黑棘 Dark Bramble | 203.3 `D` | 3.25E+06 `D` | **0** `D` | — | Sun | **20000** `D` | **875.16** `D` |
| 闯入者 Interloper | 83 `D` | 5.50E+05 `D` | ?（潮汐锁定）`D` | — | Sun | **a=13250, e=0.8113**（近日点 2500 / 远日点 24000）`X` | **479.15** `X`（§3.9） |
| 量子月 Quantum Moon | 73 `D` | 5.50E+05 `D` | **0** `D` | — | 多个（§3.6） | 见 §3.6 `D` | ★（随宿主，§3.10） |
| 宇宙之眼 Eye of the Universe | 201 `D` | 9.00E+06 `D` | **0** `D` | — | Sun | **500000 定值** `★`（D 的 410000–657000 是三角测量误差带） | **§3.10** |
| 太阳站 Sun Station | **60** `★` | 3.00E+05 `D` | 潮汐锁定 | — | Sun | **2315** `X`（35s + μ_sun，合法） | **35** `M` |
| 白洞站 White Hole Station | **90** `★` | — | — | — | **白洞** `★`（非 Sun，见 §3.6） | 绕白洞 **300** `★` | **§3.10** |
| 陌生者 The Stranger | **600** `★` | — | 有自身朝向 | — | Sun | **22000 → 30000 漂移** `★` | **§3.10** |
| 轨道探测炮 OPC | **250** `★` | — | 炮口随瞄准转 | — | Giant's Deep | **1100** `★`（反解 2937 违法，见 §3.4 规则 3） | **50** `M` |
| 天空快门卫星 SkyShutter Satellite | **20** `★` | — | — | — | Timber Hearth | **500** `★`（官方 wiki："very low orbit"，必须 < 阿特勒岩 900） | **40** `M` |

**表格自带的注意事项（必须尊重，不可当精确值用）**：
- 太阳半径末段膨胀到 4000 m（**红巨星膨胀是必须实现的剧本事件**，曲线见 §3.8）。
- 脆空半径"variance 很高"（±13 m）；深巨星半径从海平面量，大气到 959 m。
- 黑棘从种子量是 203.3 m，从冰壳量则是 612±16 或 651±13。
- 闯入者"自转可见但缓慢，且潮汐锁定于太阳"；角速度标注 `?`（无确定值）。
- 宇宙之眼的 410000–657000 m 是三角测量值，表格自述"不确定是否反映本体"。
- 太阳站 / 白洞站 / 陌生者**无数据行**。

**命名修正（本轮复核）**：v1 的"炉星卫星 Hearthian Satellite"应改称 **SkyShutter Satellite**（官方 wiki 页名；fandom 上 `Hearthian Satellite` 是到该页的**重定向**），内部 astro 名为 `MapSatellite`（其子体为 `HearthianRecorder_Body`）。原"反解 2531 m"用的是太阳的 μ（违反 §3.4 规则 3），且与 wiki 的"very low orbit"矛盾（2531 m 比阿特勒岩轨道 900 m 还高 2.8×）→ 改为设计值 500 m。

### 3.3 交叉验证

**验证一（原"datamine vs 手测反解"）→ 重新定性为内部自洽性检查**
v1 的"手测反解"列其实由**同一张表的 `Year length`** 反解而来，属循环论证：`r_of_T(250.25)=8593.09` 与 datamine 的 8593.086 逐位重合（偏差 0.00% 即证据），双星 4990.63、脆空 11706.99、黑棘 19798.17 同理；仅深巨星一行用了手测 650s。它证明的是"表格与 `μ=4×10⁸` 自洽"，**不是独立校验**。

**验证一·补｜真正的独立校验（手测 T → 反解 r vs datamine r）**：

| 天体 | 手测 T (s) | 反解 r (m) | datamine r (m) | 偏差 |
|---|---|---|---|---|
| 灰烬/余烬双星 | 110 | 4967.8 | 5000 | −0.64% |
| 木炉星 | 250 | 8587.4 | 8593.086 | −0.07% |
| 脆空 | 397 | 11688.5 | 11690.891 | −0.02% |
| 深巨星 | 650 | 16237.1 | 16457.587 | −1.34% |
| 黑棘 | 900 | 20171.0 | 20000 | **+0.86%** |

→ 全部 ≤1.34%，**结论（周期与轨道半径两个维度精度足够直接使用）仍然成立**，但论据已按上表重写，v1 的"三方独立一致"降级为"两组独立校验 + 两组自洽性检查"。

**验证二｜周期：datamine vs 手测**：木炉星 250.25 vs 250s（+0.10%）、脆空 397.94 vs 397s（+0.20%）、双星 110.76 vs 110s（+0.69%）、黑棘 875.16 vs 900s（**−2.76%**，v1 符号写反；手测只记到 15:00 整）。

**验证三｜独立 wiki 值**：木炉星轨道半径 datamine 8593 m vs fandom infobox "roughly 9 km" ✅

**验证四｜物理自洽**：
- 闯入者由近日点 2500 / 远日点 24000 推出 `a = 13250 m`、`e = 0.8113`；`μ = 4×10⁸` 预测 `T = 479.15s`，手测 480s → 偏差 0.18% ✅
- 太阳站手测 35s → `a = 2315 m`（父体是太阳 ⇒ 用 μ_sun 合法）✅ 但"自洽解释 690s 被吞没"这一句**在 v1 里是空的**：需要 §3.8 的 R(t) 曲线 + §3.7 的映射才对得上，现已补齐。
- 阿特勒岩的 `Year length` 与 `Day length` **都等于 103.29s** → 数据自身确认其**潮汐锁定**于木炉星 ✅

### 3.4 仍需设计的字段（自洽化路线）

datamine 表**未提供**：`inclination` · `longitudeOfAscendingNode` · `argumentOfPeriapsis` · `trueAnomaly`（初始相位） · `axialTilt`
datamine 表**未覆盖**：太阳站 / 白洞站 / 陌生者 / 轨道探测炮 / 天空快门卫星的完整轨道参数，以及**上述所有缺半径天体的半径**。

处理原则：
1. **周期与轨道半径一律用实测/datamine 值**，不自行发明；**无法适用时按 §3.10 给设计值**。
2. 缺失自由度按物理合理性与视觉自行设计；`bodies.json` 与 README **逐字段标注来源**：`datamine` / `实测` / `反解` / `设计` / `推断`。
3. **卫星的周期不能用 `μ=4×10⁸` 反解** —— 该 μ 是太阳的。游戏对卫星周期是脚本化的（例：空心灯若按真实两体引力算应得 ~10⁷s，实际 115s），因此**卫星一律采用实测周期**；相应地，**绕行星的轨道半径也不得用 μ_sun 反解**（v1 的 OPC 2937 m / 卫星 2531 m 因此作废，见 §3.10）。
4. 闯入者**必须单独解椭圆**（§3.9），不可套圆轨道公式。
5. **半径缺失的渲染对象必须给设计值**（太阳站 / 白洞站 / 陌生者 / OPC / 卫星 / 探测器），否则画不出球体；设计值集中在 §3.10。

### 3.5 22 分钟事件表（验收基准）

**权威来源**：`clubby789/OWClock` 的 `ClockLib/events.json` —— **87 条、0–1360s 秒级时间戳**（本轮复核：条目数 87 确认）。
> 注意：该仓库根目录的 `events.json` 是空模板，真数据在 `ClockLib/events.json`。

**独立互校**：`SeekNHack/Outer-Wilds-Star-System-LIVE-Wallpaper` README 的逐秒事件表。

**锚点（三方一致）**：

| 时间 | 事件 | OWClock | SeekNHack |
|---|---|---|---|
| 0s | 循环开始 | 0.0 | 22:00 |
| **120s** | 沙漏开始沙流 | 120.0 | 20:00 ✅ |
| 1185s | 闯入者撞太阳 | 1185.0 | ~2:00 ✅ |
| **1220s** | 沙流停止 | 1220.0 | 1:40 ✅ |
| 1235s | 终局开始 | 1235.0 | ~1:30 ✅ |
| **1320s** | 超新星 | 1320.0 | 0:00 ✅ |
| 1360s | 循环结束 | 1360.0 | — |

#### 3.5.1 逐条映射（87 → 实现 / 弃置）**——Phase 1 必须交付的成品表**

**实现（19 项来自 OWClock + 1 项设计）**：时刻标注来源，容差按 §9.1。

| 时间 | OWClock 名称 | 视觉表现 | 来源 |
|---|---|---|---|
| 0 | Loop Begins | 全部天体复位到初值；探测炮完整、炮口朝种子方向 | OWClock |
| 1 | —（OWClock 无此条） | 探测炮解体 + 发射探测器（发光小体沿抛物轨离场） | **设计/推断** |
| 120 | Sand Begins Flowing | 灰烬双星 → 余烬双星沙流（粒子带 + 双星贴图渐变） | OWClock |
| 200 | Satellite Reaches 40° | 天空快门卫星轨道角 = 40°（200 = 5×40，正好钉死初相位） | OWClock（相位锚点） |
| 220 / 695 / 1175 | Interloper Opens | 冰壳展开（§3.9 阈值模型驱动） | OWClock |
| 260 / 735 | Interloper Closes | 冰壳收拢（开→闭固定 40s） | OWClock |
| 400 | Stranger's Sails Deploy | 帆展开：几何 + 亮度变化 | OWClock |
| 690 | Sun Station Destroyed | 太阳视半径越过太阳站视轨道半径（**精确涌现**，§3.7） | OWClock（推定成因 `推断`） |
| 780 | Dam Bursts | 深巨星上一道细小高光/水花（低优先，可弃） | OWClock |
| 1085 | Quantum Tower Exits White Hole | 量子塔自白洞升起（白洞站旁新增几何） | OWClock |
| 1185 | Interloper Collides with Sun | 闯入者淡出 + 太阳局部闪光 | OWClock |
| 1220 | Hourglass Sand Stops Flowing | 沙流停 + 双星切终态贴图 | OWClock |
| 1230 | Cinder Isles Tower Completely Falls | 深巨星高塔坍落（低优先，可弃） | OWClock |
| 1235 | Beginning of the End | 太阳转红 + 膨胀加速的视觉开端 | OWClock |
| 1320 | Supernova | 红日坍缩 → 转蓝 → 爆炸白闪 | OWClock |
| 1330 | ATP Black Hole Opens | 灰烬双星处出现黑洞点 | OWClock |
| 1360 | Loop Ends | 复位到初值（白闪遮盖接缝） | OWClock |

**全循环装饰性事件（来源 = 设计，只约束频率与总量，容差 ±25%）**：

| 事件 | 频率/总量 | 视觉 |
|---|---|---|
| 空心灯向脆空发射流星 | 首颗 ~45s；中段 ~1 次/分；末段 ~3 次/分；**共 5 次撞击后**脆空贴图出现破洞 | 发光轨迹 + 撞击闪光 |
| 深巨星红色闪电 | ~8 次/分 | 短线闪光 |
| 量子月跃迁 | 未被观测时在 6 个位置间迁移（§3.10） | 淡出/淡入 |
| 背景星熄灭 | ~1160s 起，至 1320s 全部熄灭 | 星点逐个熄灭 |
| ATP 黑洞 | 1330s 出现，持续到 1360s | 黑点 + 微透镜环 |

**弃置（分类说明，避免"是不是漏了"的反复）**：
- **传送门类（type 2）共 47 条**：`Warp: Sun Station/Ash Twin/Ember Twin/Timber Hearth/Brittle Hollow/Giant's Deep` 等 —— 行星内部的传送塔，轨道视角不可见。
- **NPC 类（type 3）3 条**：Chert 660 / 1020 / 1230 —— 角色，不渲染。
- **行星地表状态（type 4/5）其余条目**：HEL 可达性 350/370、六个塔开启、Stepping Stone District 665、River Lowlands 790、Cinder Isles 810、Hidden Gorge 820、E.Twin G.Canon 860、Anglerfish Overlook 865、Temple of the Eye 900、Escape Pod #2 980、Sunless City 1005 —— 行星地表细节，轨道视角不可辨认（除已列 780/1230）。
- 逐条弃置清单以 `wallpaper/data/events.json` 的 `dropped[]` 字段落库（含原文名称与理由），保证 87 条**条条有归属**。

**确定性策略**：所有随机性（探测炮朝向、流星、闪电、量子月迁移、背景星熄灭顺序）使用**固定种子 PRNG**，且**由 `t` 驱动**（绝不用帧计数 —— WE 限帧会改变频率）。种子写入 `events.json`，HUD 显示当前种子。

### 3.6 天体层级

```
太阳 Sun
├── 太阳站 Sun Station        日心低轨道（a=2315m），潮汐锁定于太阳，690s 被吞没
├── 闯入者 Interloper          a=13250m, e=0.8113, 近日点 2500m / 远日点 24000m，潮汐锁定于太阳
├── 陌生者 The Stranger        22000 → 30000m 线性漂移（400s 张帆后加速），自持朝向
├── 沙漏双星 Hourglass Twins
│   ├── 灰烬双星 Ash Twin      (内部名 TOWER_TWIN)
│   └── 余烬双星 Ember Twin    (内部名 CAVE_TWIN)
│       双星质心绕太阳 5000m；两星互绕半径 250m，互绕周期 55s（手测 0:55）
├── 木炉星 Timber Hearth
│   ├── 阿特勒岩 Attlerock     900m，潮汐锁定（年=日=103.29s）
│   └── 天空快门卫星 SkyShutter Satellite  500m，40s（内名 MAPSATELLITE）
├── 脆空 Brittle Hollow
│   └── 空心灯 Hollow's Lantern 1000m，115s
├── 深巨星 Giant's Deep
│   ├── 轨道探测炮 OPC         1100m（大气 959m 之外），50s，含 NomaiProbe 子体
│   └── 量子月 Quantum Moon    六个宿主位置
├── 黑棘 Dark Bramble
├── 白洞 + 白洞站              ★父体是白洞，不是太阳；与脆空共轨 11690.89m、相位 +120°，站绕白洞 300m
└── 宇宙之眼 Eye of the Universe  500000m（定值）
```

**量子月的六个轨道半径**（datamine 原值）：余烬双星 **1700** · 木炉星 **1100** · 脆空 **1400** · 深巨星 **1500** · 黑棘 **1500** · 宇宙之眼 **6000**。
> 注意：量子月**不环绕灰烬双星**，只环绕余烬双星。附着后随宿主公转；迁移判定与驻留见 §3.10。

内部命名映射（对齐社区数据用，源自 NH `AstroObjectLocator.cs`，本轮已核对原文）：
`ATTLEROCK→TIMBER_MOON`、`HOLLOWS_LANTERN→VOLCANIC_MOON`、`ASH_TWIN→TOWER_TWIN`、`EMBER_TWIN→CAVE_TWIN`、`INTERLOPER→COMET`、`EYE→EYE_OF_THE_UNIVERSE`、`SKYSHUTTER SATELLITE→MAP_SATELLITE`（其子体 `HearthianRecorder_Body`）、`OPC→PROBE_CANNON`（子体 `NomaiProbe_Body` 等 8 个）、`WHITE HOLE STATION→WHITE_HOLE` 的子体 `WhiteholeStation_Body`。

### 3.7 视觉尺度映射（具体化，取代 v1 的"两套尺度"描述）

**映射定义**（`wallpaper/js/lib/scale.js`，参数全部暴露为用户属性）：

```
日心距离（含太阳半径）：  r_vis(r) = K_sun · (r / R_sun0)^p
                          K_sun = 4000（= 太阳 t=0 视半径）  R_sun0 = 2001.75  p = 0.45
太阳视半径：              R_sun_vis(t) = r_vis(R_sun_real(t))   ← 与轨道半径同一函数
卫星/互绕距离：           r_vis = k_local · r      k_local 默认 2.0
天体半径：                radius_vis = k_body · r_body    k_body 默认 1.4
真实比例开关：            p = 1、k_local = 1、k_body = 1 ⇒ 完全真实数值
```

**关键性质（本轮复核得出的设计决定）**：太阳半径与轨道半径走**同一个单调函数** ⇒ ① 序关系自动保持；② **690s"太阳站被吞没"是精确涌现的**，不需要单独授权一个视觉事件（v1 把两者当成独立旋钮，导致任何 `k_body > 1.157` 都会让太阳在 t=0 就吞掉太阳站）。

**实测的涌现时间点**（`events.json.sunStation`，由 `tools/build-data.mjs` 反解映射得到）：太阳表面**首次触及站体近缘 = 493.9s**（此后站体逐帧淡出，透明度按 `(轨道视距 − 太阳视半径) / 站体视半径` 线性衰减），**抵达站心 = 690.0s**（与 OWClock `Sun Station Destroyed` 完全重合）。两处都不需要脚本化的定时器 —— 它们只是映射的推论。

**映射后的距离表**（`p=0.45`，供 HUD 与测试断言）：

| 真实 r (m) | 视距 | 说明 |
|---|---|---|
| 2001.75 | **4000** | 太阳 t=0 视半径 |
| 2315 | 4270 | 太阳站轨道；真实半径涨到 2315 时两者相等 ⇒ 690s 吞没 |
| 2500 | 4421 | 闯入者近日点（视距 > 太阳视半径 ⇒ 前两次近日点安全） |
| 5000 | 6040 | 双星质心 |
| 8593.086 | 7706 | 木炉星 |
| 11690.891 | 8850 | 脆空 / 白洞 |
| 16457.587 | 10322 | 深巨星 |
| 20000 | 11269 | 黑棘 |
| 24000 | 12232 | 闯入者远日点 |
| 410000–657000 | 43864–54240 | 宇宙之眼（取定值 500000 → 47470） |

**间隙校验**（视单位，全部为正 ⇒ 不重叠）：

| 组合 | 视距 | 半径和 | 间隙 |
|---|---|---|---|
| 双星互绕 | 1000（500×k_local） | 2×236.6 | **526.8** ✅ |
| 阿特勒岩 vs 木炉星 | 1800（900×2） | 355.6 + 112 | 1332 ✅ |
| 天空快门卫星 vs 木炉星 | 1000（500×2） | 355.6 + 28 | 616 ✅ |
| 空心灯 vs 脆空 | 2000（1000×2） | 380.8 + 136.2 | 1483 ✅ |
| OPC vs 深巨星（含大气） | 2200（1100×2） | 1342.6（959×1.4） + 350 | 507 ✅ |
| 太阳站 vs 太阳（t=0） | 4270 | 4000 + 84（60×1.4） | 186 ✅（t=690 归零 ⇒ 吞没） |
| 白洞站 vs 白洞 | 600（300×2） | 35 + 126 | 439 ✅ |

> `k_body` 上限：由最紧组合（双星）决定 ⇒ `k_body ≤ 500/338 = 1.479`；默认 1.4 留 5% 余量。用户属性允许调高，但 HUD 在越界时告警。

### 3.8 太阳半径曲线 `R_sun(t)`（**Phase 1 必须交付的成品表之一**）

```
0 ≤ t ≤ 690 :  R = 2001.75 + 313.25 · (t/690)^1.15
690 < t ≤ 1320:  R = 2315 + 1685 · ((t−690)/630)^1.35
t > 1320    :  R = 4000（维持到 1360 复位）
```

**锚点与理由**：`R(0)=2001.75`（datamine）、`R(690)=2315`（OWClock `Sun Station Destroyed`，且 2315 是太阳站被手测 35s 反解出的轨道半径 ⇒ 两者相等即"吞没"）、`R(1320)=4000`（datamine 的"末段 4000 m"）。

**校验点（测试断言）**：`R(226.6)=2088.8`、`R(706)=2326.8`、`R(812.6)=2500`（此后 r<2500 的天体不复存在）、`R(1185)=3531.5`。
**约束**：`R(t) < 2500` 必须覆盖闯入者前两次近日点（226.6s / 706s）✅；分段线性/多项式均可，但**不得用一条直线**（v1 的隐含线性假设会在 t=207s 就吞掉太阳站）。

### 3.9 闯入者联立解（**Phase 1 必须交付的成品表之一**）

**冲突来源**：OWClock 的三次"开壳"221/695/1175 间距为 475s 与 480s（本身不自洽 ⇒ 事件表精度约 ±2.5s）；kepler 由 datamine 的 `a=13250, e=0.8113, μ_sun=4×10⁸` 得 `T=479.15s`；而撞日时刻又依赖 `R_sun(t)`。

**求解顺序**：
1. 取 **`T = 479.15s`**（不采用事件拟合值 477.5s —— 后者会破坏与 datamine 近日点/远日点的一致性）。
2. 由 `R(1185)=3531.8 m` 反解椭圆上"入轨半径 = 3531.8"的时刻 ⇒ 撞日发生在**近日点前 Δ≈7.2s** ⇒ 第三次近日点 `p3 = 1192.2s`。
3. `p1 = p3 − 2T = 233.9s`、`p2 = p3 − T = 713.1s`。
4. 冰壳阈值模型：`r_open(t) = c0 + c1·R_sun(t)`，用三次开壳时刻（220 / 695 / 1175）**最小二乘**拟合 ⇒ **`c0 = 4872.9 m`、`c1 = 0.3171`**；闭壳 = 开壳 + 40s（OWClock 两处均为 40s）。
5. 落库 `events.json.fits.interloper = { T, p1, p2, p3, c0, c1, deltaBeforePerihelion, residuals[] }`。

**已落库结果**（`npm run build:data`，`data/fits-report.md`）：残差 **−1.73 / +2.11 / −0.35 s**（最大 2.11s，容差 B ≤5s ✅，略高于 2s 目标值但接受）。

**残差目标**：三窗口 ≤ 2.0s（§9.1 的"轨道耦合 ±5s"内留余量）；**实测 2.11s，达标（按容差 B）**。**若超标**，按优先级牺牲：1185 撞日 > 1175 开壳 > 695 > 220（末段观感优先）；并把实际残差写进 README，不做静默调整。

**备选方案（默认不启用）**：把 T 也当自由参数与三个窗口联合拟合（会牺牲 a/e 一致性），仅在残差超 5s 时启用，并记录启用原因。

### 3.10 设计值总表（**Phase 1 必须交付的成品表之一**）

| 对象 | 字段 | 设计值 | 理由 | 可调 |
|---|---|---|---|---|
| 太阳站 Sun Station | 半径 | 60 m | 真实未知；需在视距 4270 上可见 | — |
| 轨道探测炮 OPC | 半径 / 轨道半径 | 250 m / 1100 m | 深巨星大气 959 m 之外、观感紧贴大气；**不用 μ_sun 反解** | — |
| Nomai 探测器 | 半径 / 初速 | 15 m / 离炮后 60 m·s⁻¹ 匀减速 | 1s 发射，1360s 时仍在系统中可见 | — |
| 天空快门卫星 | 半径 / 轨道 / 周期 / 初相位 | 20 m / 500 m / 40 s / **40°** | wiki "very low orbit"（必须 < 阿特勒岩 900 m）；相位由 `Satellite Reaches 40°`@200s 钉死（200 = 5×40） | — |
| 白洞 / 白洞站 | 半径 / 站轨道 / 宿主 | 白洞 25 m、站 90 m、绕白洞 300 m | 父体是白洞（§3.6）；与脆空共轨 11690.891 m、相位 +120° | — |
| 陌生者 The Stranger | 半径 / 漂移 / 速度 | 600 m / 22000 → 30000 m / 400s 后 ×1.3 | v1 只写"初始静止，后远离"，无参数 | — |
| 宇宙之眼 | 轨道半径 | **500000 m 定值** | datamine 的 410000–657000 是三角测量误差带（若当椭圆则 e=0.231，会明显移动） | 「真实比例」开关下同值 |
| 量子月 | 附着/迁移 | 附着后随宿主公转（周期 = 宿主周期）；**迁移条件 = 相机视锥内不可见 且 距上次迁移 ≥ 30s**；6 个位置按种子随机游走；**不迁往宇宙之眼位**（该位仅在真实比例观测模式下可达） | v1 只写"未被观测时不迁移"，无判定/驻留规则 | 驻留时间可调 |
| 各天体周期（表内未给者） | 周期 | 白洞站 = 397.94 s（与脆空共轨）；量子月 = 宿主周期；宇宙之眼 = 静止（无穷） | 保持层级运动自洽 | — |
| 太阳自转 | 自转 | **不自转** | datamine 备注 "Inconclusive"，且 22 分钟内不可辨 | — |
| 轨道倾角族 | `inclination` / `RAAN` / `argPeriapsis` | 全部 0（共面） | 游戏地图视图即近共面；避免臆造 | 真实比例模式不显示倾角差异 |
| 相机默认 | fov / 距离 / 缩放范围 / 仰角 | 50° / 12000 视单位 / ×0.15–×10 对数 / 15° | 使 6040–11269 视单位的主轨道带占满画面 | ✅ 用户属性 |

> **一致性容差（§9.1）允许上表的取值与游戏观感存在小差别；上表是"可调参基线"，不是逐值精确承诺。**

---

## 4. 架构

### 4.1 分层

```
┌─ WE 宿主 ───────────────────────────────────────┐
│ Wallpaper Engine（Web 壁纸，CEF 内运行）          │
│   · FPS Limiter（官方，web/performance/fps）      │
│   · 全屏/最大化时自动暂停（官方）                  │
│   · `-control hideIcons` 隐藏桌面图标让出点击      │
│   · project.json → 用户属性面板（Workshop 同步）    │
└─────────────────────────────────────────────────┘
┌─ 壁纸本体（wallpaper/，静态文件目录，零网络请求）─┐
│ index.html · project.json · data/*.json · js/     │
│   WebGL2 渲染：星空 / 轨道线 / 天体球 / 太阳辉光   │
│   DOM 输入：pointermove / pointerdown / wheel ←待验证│
│   wallpaperPropertyListener → 用户设置            │
│   帧率上限 + 空闲降帧（不全靠宿主）                │
└─────────────────────────────────────────────────┘
```

**导入方式**：WE 编辑器 → 创建 Web 壁纸 → 指向 **`wallpaper/`**（WE 只认该目录为工程根，其 `index.html` 即入口）。`PLAN.md` / `data/sources/` / `spike/` / `tools/` / `test/` **不得**放进 `wallpaper/`，否则会被 WE 一并加载并可能进入 Workshop 包。

### 4.2 WebGL2 渲染管线与批次

场景极小：~18 个天体 + 轨道线 + 静态星空。目标是**把每帧工作量压到接近零**。

| 批次 | 做法 | 每帧成本 |
|---|---|---|
| 星空 | 初始化时烘焙成 cube texture，之后单个全屏 quad 采样 | 1 draw call，无计算 |
| 轨道线 | 初始化生成 `LINE_LOOP` VBO（映射后坐标，静态） | 1 draw call |
| 天体（不透明球） | 共享 UV 球 mesh（48×24），instanced draw 传每体模型矩阵 + 贴图索引 | 1 draw call |
| 大气壳 | 半透明球壳（深巨星 959 m） | 1 draw call |
| 太阳辉光 | 加性 billboard quad，径向衰减 | 1 draw call，**不做后处理 bloom** |
| 事件特效 | 仅在活跃事件窗口内提交（沙流/流星/闪电/超新星/白洞） | 通常 0–2 |
| 相机 | 阻尼积分 | — |

**硬性要求**：
- 逐帧零分配（预分配 typed array 与矩阵缓冲）；时间用**单调时钟累加** `t += clamp(dt, 0, 0.25)`（绝不用绝对时间戳当 `t`）。
- **空闲降帧**：`idle = 无输入 且 无活跃事件 且 无进行中的动画`；`idle` 时把渲染门控到 `idleFps`（默认 15，用户可调），**不**用"跳过整个 render"（22 分钟剧本里场景从不真正静止 —— v1 的"静止跳帧"前提不成立）。
- **能力检测（首帧）**：`WEBGL_debug_renderer_info` 的 UNMASKED_RENDERER 必须不是 SwiftShader；缺 `EXT_texture_filter_anisotropic` 时降级为双线性；**WebGL2 不可用或 context lost 时**显示静态兜底图 + 一行说明（不得黑屏）。
- 每次 `webglcontextlost` 都记录日志并尝试一次重建（重建失败 → 兜底图）。

### 4.3 贴图球体方案

- **Mesh**：一个共享 UV 球（经度 48 × 纬度 24），instanced attribute 传每体模型矩阵。
- **贴图**：等距柱状投影（equirectangular，2:1），单张 512×256，生成 mipmap + 各向异性过滤。
- **生成方式**：`OffscreenCanvas` + 2D context 程序化绘制（值噪声 + 每体调色板 + 特征），`texImage2D` 上传。**零外部素材、零网络请求。**
- **状态变体（v1 缺失，本轮补）**：每体可有多个 variant 贴图，由事件切换：

| 天体 | 变体 | 触发 |
|---|---|---|
| 灰烬/余烬双星 | `full` / `empty` | 120s 起渐变，1220s 切终态 |
| 脆空 | `intact` / `holed`（0–5 级破洞） | 空心灯流星每次撞击 +1 |
| 轨道探测炮 | `intact` / `broken` | 1s |
| 闯入者 | `shell_closed` / `shell_open` | §3.9 阈值 |
| 陌生者 | `cloaked` / `sails` | 400s |
| 木炉星/深巨星/黑棘/太阳 | 单变体 | — |

- **不自转的天体**（角速度 = 0）：深巨星、黑棘、量子月、宇宙之眼。
- **潮汐锁定**：阿特勒岩（锁木炉星）、闯入者（锁太阳）、太阳站（锁太阳）。
- **太阳**：不用贴图，程序化着色器（噪声 + fresnel + 边缘变暗）；半径随 `t` 按 §3.8 增长（**剧本事件，不只是外观**）。

### 4.4 WE 集成接口

| 能力 | 实现方式 |
|---|---|
| 用户可调参数 | `wallpaper/project.json` 的 `properties`：帧率上限 / 空闲帧率 / `p` 压缩指数 / `k_local` / `k_body` / 轨道线可见性 / 「真实比例」开关 / 量子月驻留 / 重置进度 | 
| 接收设置变更 | `window.wallpaperPropertyListener.applyUserProperties` |
| 隐藏桌面图标 | 用户经 WE CLI `-control hideIcons` 触发（解决拖动时触发桌面框选） |
| 帧率上限 | 自身帧率门控（`lib/framerate.js`）：`busy`（交互/粒子/超新星闪光）用 `fpsLimit`、空闲用 `idleFps`，**两者都有上限**——早期实现里 `busy` 走的是"每帧都画"分支，等于取消上限（Chromium 实测 200+ draw/s）。可与 WE 官方 FPS Limiter 叠加 |
| 用户属性键名 | **WE 会把属性名小写后传入**（`project.json` 写 `fpslimit`，回调收到也是 `fpslimit`），而场景字段是 camelCase ⇒ 必须做大小写无关映射（`lib/props.js` + `test/props.test.mjs`）。另外 slider 值可能是字符串，需转数字，否则 `dt * timeScale` 变 NaN |
| 暂停/恢复 | WE 自动暂停 + `document.hidden` 监听。**恢复策略 = 用户属性**：`wall-clock`（按真实时间补齐 `t`，跨度 > 60s 时先用白闪重同步）或 `paused-loop`（暂停期间停表）。默认 `paused-loop`（避免挂机一夜后跳到剧本末尾） |
| 调试（**修正**） | WE ≥ 2.8 已用**内置 DevTools** 取代旧的 "CEF devtools port"（官方文档页尚未更新）→ Phase 0 先实测入口（F12 / 设置内），再决定排查流程（R10） |
| 快速验证 | CLI `-control openWallpaper -file <project.json> -playInWindow "OW" -width 1920 -height 1080` 把壁纸开成**窗口**（比桌面态更可控，可脚本化截图）；`-control applyProperties -properties RAW~({"p":0.45})~END` 直接改用户属性验证参数 |

### 4.5 目录结构与模块（v1 未定义，本轮补）

```
OuterWilds_Mapping_Project/
├─ PLAN.md · README.md（Phase 5）· LICENSE（MIT）· NOTICE.md（署名）
├─ data/sources/          ← 原始归档（CSV / OWClock JSON），不发布
├─ data/fits-report.md    ← 构建时生成的拟合与间隙校验报告
├─ tools/                 ← Node 脚本：build-data（拟合+落库）· build-bundle（打包）· serve（本地验证）
├─ test/                  ← `node --test` 纯逻辑测试（开普勒/事件/映射/曲线/复位/种子）
├─ spike/input-probe/     ← 输入探针（含 Pointer/滚轮/键盘焦点/WebGL2 检测），不发布
└─ wallpaper/             ← ★ WE 工程根，只装发布所需文件
   ├─ index.html · project.json · bundle.js      （bundle 入库，WE 可直接加载）
   ├─ preview.jpg                                （Phase 6 生成）
   ├─ data/bodies.json · events.json             （规范数据，工具/测试读）
   ├─ data/bodies.js · events.js                 （同内容的 ESM 孪生，供打包内联）
   └─ js/
      ├─ lib/kepler.js · scale.js · sun.js · interloper.js · time.js · events.js · world.js · framerate.js · props.js
      ├─ render/gl.js · mesh.js · shaders.js · scene.js · textures.js · CONTRACT.md
      ├─ camera.js · hud.js · main.js
```

**为什么打成一个 classic script（`bundle.js`）**：WE 从普通文件夹加载 Web 壁纸，而 ESM 与 `fetch()` 都取决于 CEF 的启动方式（`file://` 下模块会被 CORS 拦、`fetch` 本地 JSON 亦同）。单文件经典脚本消除这一整类"浏览器里正常、WE 里黑屏"的失败，并顺带满足 §1.2 的"零网络请求"。`tools/build-bundle.mjs` 做的是确定性 ESM→IIFE 内联（模块注册表 + `__require`），`test/bundle.test.mjs` 保证**提交的 bundle 与源码一致**（防"改了 lib 忘了重新打包"），并**在 `vm` 里真的跑一遍 import 语义**（default / named / namespace 三种形式各自的绑定正确）——打包器曾把 `import x from` 当成命名空间导入，bundle 能生成、能通过语法检查，但 `bodiesDoc.bodies` 是 `undefined`，页面黑屏。

**测试策略**：`wallpaper/js/lib/**` 与 `wallpaper/data/*.json` 是**可在 Node 下直接跑的纯逻辑**（ESM，无 DOM 依赖）；`render/**`、`camera.js`、`hud.js` 才依赖 WebGL2/DOM。因此 `node --test test/` 覆盖：周期一致、事件时刻（§9.1 容差）、`R_sun` 曲线锚点、映射间隙与吞没涌现、复位一致、量子月判定、种子可复现、bundle 新鲜度与打包语义、帧率门控、WE 属性映射。WE 里只做端到端 smoke（不用 WE 当测试环境）。

---

## 5. 分阶段计划

**进度（2026-09-19）**：Phase 1–3 已实现并回归验证；Phase 4 集成代码已补齐，真实桌面验收待完成；Phase 5 文档、默认设置与封面已补齐，视觉终审待用户确认；Phase 6 本地打包完成，未上传。Phase 0：预览输入通过，桌面输入不确定，正式性能/多屏待测。详见 STATUS.md。

**Phase 2 实测记录（Chromium + 真 WebGL2，RTX 4070 / ANGLE D3D11）**：

| 项 | 结果 |
|---|---|
| 启动 | `bundle.js` 单请求，无 favicon 请求（`<link rel="icon" href="data:,">`），`fallback` 不显示，26 层贴图一次烘完（18.3 MB） |
| 几何 | 20 天体全部按 `world.sample()` 的坐标投影到屏幕；太阳盘实测半径 296px vs 解析值 278px（差值 = 辉光半径）；行星/卫星投影点亮度远高于背景环（如 `ash_twin` 177 vs 3.2） |
| 拖动 | 120px → yaw −0.538 rad（= `SENSITIVITY` 0.0045 rad/px ×120），40px 下拖 → pitch +0.179 |
| 滚轮 | −300 步 → 距离 ×0.700（= `exp(−300×0.0012)`），+900 步 → ×2.932 |
| 帧率门控 | 空闲 14.5 draw/s（`idleFps` 15）、交互期 27.9 draw/s（`fpsLimit` 30）；loop 仍以 rAF 速率跑（HUD 分别显示 `loop` 与 `draw`） |
| 属性面板 | 12 个属性全部按 WE 的小写键名生效并重建世界（`kBody` 1.4→1.2、`p` 0.45→0.6、`kLocal` 2→3）；`starBrightness` 0 / 1 / 2 → 亮像素 0 / 56 / 129 |
| 剧本末段 | `seek(1315)`：1320s 星消光到 1.0，1321s 超新星闪 0.75→0.32→0（残骸 `remnant` 置位），1330s 起黑洞粒子出现，1360s 回绕到 t≈0 且贴图层数不变（无泄漏） |
| 事件表 | 0.5s 步长扫描整圈：**20/20 事件按表触发**（19 项 OWClock + `loop_begins`/`loop_ends` 设计项），时刻与 §3.5.1 一致（120/200/220/260/400/690/695/735/780/1085/1175/1185/1220/1230/1235/1320/1330s） |
| 装饰事件 | 粒子窗口覆盖：沙流 120→1220s 连续、炉岩流星间歇脉冲、1330s 黑洞点；全部由 `t` 驱动（与帧率无关） |
| 循环接缝 | 回绕时全屏白闪遮盖：暗角亮度实测 0（t=1360）→ 241（t=0.03）→ 0.5s 内衰减回 0；接缝期间按 `fpsLimit` 出帧（30/s） |

### Phase 0 —— 风险验证 spike（用户操作 + 可自动化部分已就绪）

**已自动化的部分（2026-09-18，本章节记录实测证据）**：

| 结论 | 证据 |
|---|---|
| WE 能从**普通文件夹**加载 Web 壁纸 | `wallpaper64.exe -control openWallpaper -file <project.json> -playInWindow` 打开成功；页面内的 `wallpaperPropertyListener` 收到 WE 注入的内建属性（`alignmentfliph` / `schemecolor` / `wec_*`） |
| 用户属性在 WE 里真的生效 | 用 CLI `-control applyProperties -properties RAW~({"realscale":true})~END` 改属性，预览窗口截图平均亮度 97 → 71 → 59 → 52（`showhud:false`、`compression:0.95` 各步同向变化） |
| WE 的 **web 壁纸跑在独立进程** | `webwallpaper64.exe`（CEF），宿主 `wallpaper64.exe` 只持有 `WPEOverlappedWallpaper` 窗口；截图要么在窗口未被遮挡时抓，要么改用探针回传 |
| **本地 HTTP 回传可用**（新的验证通道） | 探针页面在 WE 内 `boot` 后立刻向 `127.0.0.1:8124` 发出 beacon；`file://` 页面 → localhost 未被拦截 ⇒ 输入测试结果可以**变成文本**，不必靠读像素 |
| 指针移动会被转发 | 光标停在预览窗口上时，探针持续收到 `pointermove`（单次会话 n≈900） |
| **拖动 / 滚轮（关键闸门）** | ✅✅ **均已实测通过**，见 §2.4 实测结论表：`drag=403px`、`wheel=15` 且 `cancelable=true`、`preventDefault` 15/15 成功 |

1. **Spike A｜输入能力实测（关键闸门）—— ✅ 已完成（2026-09-18）**

   **结论：拖动 ✅ / 滚轮 ✅（可取消）/ 键盘 ✗（WE 吃掉按键）。** 判读表命中第一行「核心交互成立」+ 最后一行「键盘不实现」，§2.4 的三条备选路径全部作废。

   **复现方式（已简化为一键）**
   1. 双击 **`spike/run-input-probe.cmd`** —— 启动 beacon 接收器并在 WE 里把探针壁纸开成窗口（要求 WE 已在运行）。
   2. 在弹出的窗口里：**按住左键拖动一次** → **滚一次滚轮** → **敲一下键盘**；读顶部横幅后按回车关窗。
   3. 结果同时写进 `spike/beacon.log`（每类事件首发 + 每 5 秒一条 `summary`），不需要人工抄数字。

   （手工等价命令：`wallpaper64.exe -control openWallpaper -file "<abs>/spike/input-probe/project.json" -playInWindow "OW Input Probe" -width 1024 -height 640 -activate`；beacon 接收器：`node spike/beacon-server.mjs`。）

   **判读（保留作复测用；已完成，命中前两行）**

   | 探针结论 | 含义 | 后续 |
   |---|---|---|
   | 拖动 ✅ / 滚轮 ✅ | 核心交互成立 | 按本计划开工，交互如设计 |
   | 拖动 ✅ / 滚轮 ✗ | 只有滚轮被挡 | §2.4 备选 1（缩放按钮 + 拖动纵向缩放；**不用**键盘） |
   | 两者皆 ✗ | WE 未向 CEF 转发鼠标 | §2.4 备选 2（换宿主，但放弃 Workshop）或备选 3（降级纯观赏） |
   | keydown > 0 | 页面拿到了键盘焦点 | 可保留键盘备用交互 |
   | keydown = 0 | 焦点不在页面（**预期**） | 键盘交互不实现，用户属性面板承担全部设置 |

   **同时记录**
   - 「渲染帧率」：若显示 `渲染未运行 ⚠`，说明该环境 rAF 被限帧 → 影响 Phase 4 策略。
   - 「页面可见性」：确认 WE 暂停/恢复时正确翻转（Phase 3 时间补齐的依据）。
   - `wallpaperPropertyListener` 是否被触发（日志出现 `applyUserProperties: …`）。
   - **WebGL2 能力**：UNMASKED_RENDERER（必须不是 SwiftShader）、各向异性过滤、浮点纹理。
   - **DevTools 入口**：2.8+ 的内置 DevTools 从哪打开（F12 / 设置项），能否查到 `__probe`。
   - **WE 版本号** → 写入 README 的「已验证环境」小节。

2. **Spike B｜挂机开销基线（按真实负载测）**：渲染**完整场景**（18 体 + 轨道线 + 沙流特效 + 超新星峰值）各跑 10 分钟，分别记 `idle` 与 `交互` 两组 CPU/GPU，按 §1.2 的进程集合与分辨率记录。仅测"静态星空"会低估（v1 的问题）。
3. **Spike C｜静态资源与离线性**：确认 WE 从本地目录加载时 Network 面板为空。
4. **Spike D｜窗口态 vs 桌面态对照**：用 `-control openWallpaper … -playInWindow` 开窗，对比输入转发差异（若窗口态可用而桌面态不可用，说明是桌面图标层的遮挡问题，`hideIcons` 才值得尝试）。

**出口条件**：Spike A 有明确结论 → 进入 Phase 1（Phase 1 不阻塞于 A，可立即并行推进）。

### Phase 1 —— 数据层与骨架（已完成）

- 冻结 schema（§3.1 十个字段 + 半径 + 质量 + 母体 + **来源标签 + 变体键**）。
- **交付三张成品表**：① 设计值总表（§3.10）→ `bodies.json`；② `R_sun(t)` 曲线（§3.8）+ 闯入者联立解与残差（§3.9）→ `events.json.fits`；③ 事件逐条映射（§3.5.1）+ 种子策略 → `events.json`（含 `dropped[]` 逐条理由）。
- 实现 `lib/kepler.js` · `scale.js` · `time.js` · `events.js` · `world.js`。
- `index.html` + WebGL2 初始化（context、能力检测、resize、rAF 主循环）+ debug HUD（`t`、各天体累计角度与 `t/T`、活跃事件、`R_sun`、帧率、种子、映射参数）。
- `test/` 通过（周期 / 事件时刻 / 曲线锚点 / 映射间隙 / 复位一致 / 种子可复现）。

### Phase 2 —— 3D 渲染与相机

- 星空烘焙 + 天体球（instanced）+ 大气壳 + 轨道线 + 太阳辉光五批渲染。
- 环绕相机：拖动 = 方位角/极角（`pointercapture`），滚轮 = 对数缩放，平移；阻尼惯性。
- 程序化贴图生成器 + 变体切换（§4.3）。
- WebGL2 能力检测与兜底图。

### Phase 3 —— 轨道运行与剧本

- 时间推进 `t ∈ [0, 1360s)`；`t→1360` 复位到初值并由白闪遮盖；暂停恢复策略按 §4.4。
- 实现 §3.5.1 全部 16 项事件 + 装饰性事件（种子驱动）。
- 量子月六位置状态机（含"视锥内不可见 且 ≥30s"判定）。

### Phase 4 —— WE 集成

> 2026-09-19：属性校验、官方暂停回调、全局 FPS、DPI、图形恢复已实现并在浏览器回归；下面的真实宿主、多屏和性能验收仍未完成。

- `project.json` 用户属性面板（§4.4）在真实 WE 下复测。
- 帧率上限、空闲降帧、`hideIcons` 流程、多显示器（第二显示器 = 第二实例 ⇒ 开销翻倍，需实测）、暂停/恢复时间补齐。
- 按 §1.2 记录真实开销数字（含进程集合与分辨率）。

### Phase 5 —— 打磨与收尾

> 2026-09-19：中英文 README、NOTICE、默认隐藏 HUD、实际渲染封面已完成；仍待视觉终审。

- 轨道线着色（游戏地图视图有天体专属轨道线颜色）、天体特征细节（沙流、极冠、云带）。
- 字体（**不得使用 `ITC Serif Gothic`**，见 §7）。
- ⚠️ 剧透折叠的 README（中文社区惯例）+ 英文README（Workshop 需英文说明）。
- `NOTICE.md`：数据/事件/图示出处与授权清单。

### Phase 6 —— 发布到 Workshop（v1 缺失，本轮补）

> 2026-09-19：白名单打包、SHA-256 清单和显式未决验收状态已就绪；下面上传步骤未执行，必须先完成真实桌面验收与用户确认。

- 生成 `preview.jpg`（1920×1080，含标题与"非官方同人作品"字样）。
- WE → 选择壁纸 → 上传 → 类型 **Web Wallpaper**、可见性公开/好友。
- Workshop 说明：中英双语、非官方声明 + 官方免责句、署名（Lilac Peregrine / Mister Nebula / Gorfinhofin / Thomas / Brungo / Brady；事件表 `clubby789/OWClock`）、**不含任何游戏素材**的声明。
- 发布前自查 §7 清单（免费、无 NFT、无商业字体、无游戏素材、无外链请求）。
- **保留本地完整副本**（依据：Application 类型被下架的先例 ⇒ Workshop 政策可变，R11）。

---

## 6. 风险登记

| # | 风险 | 等级 | 影响 | 缓解 |
|---|---|---|---|---|
| **R1** | WE Web 壁纸收不到滚轮事件 | **高** | 核心交互缺一半 | Phase 0 Spike A 实测；备选见 §2.4（缩放按钮 + 拖动纵向缩放 → 换宿主 → 降级观赏） |
| R2 | WE Web 壁纸连 `pointerdown`/`pointermove` 都收不到 | 高 | 交互全失 | 同上；Spike D 区分"桌面图标层遮挡"与"根本不转发" |
| **R9** | CEF 回落到 SwiftShader / WebGL2 不可用 | 中 | CPU 爆表、黑屏 | Spike A 记录 UNMASKED_RENDERER；§4.2 能力检测 + 静态兜底图 |
| R3 | CEF + WebGL2 基线开销不达标 | 中 | 挂机耗电 | Spike B 按**真实负载**测；空闲降帧到 15fps、降分辨率、关轨道线 |
| R4 | 缺 `inclination`/`trueAnomaly` 等字段 | 中 | 与游戏不完全一致 | **容差已定（§9.1）**；缺失字段按 §3.10 设计值 + 逐字段标注来源 |
| R5 | 卫星周期不能用开普勒反解（游戏脚本化） | 低 | — | 已识别（§3.4 规则 3）；卫星一律用实测周期，半径用设计值 |
| R6 | WE 版本更新改变 Web 壁纸行为 | 中 | 长期可用性 | 只依赖最基础的 DOM/WebGL2，不依赖非文档化行为；README 记录已验证 WE 版本 |
| R7 | 贴图/字体版权 | 中 | 下架风险 | 贴图**程序化生成**（§4.3）；字体不用商业字体（§7） |
| R8 | 社区数据表可能被修改/删除 | 中 | 数据丢失 | **已本地归档 + sha256 校验通过**（§3.2） |
| **R10** | WE 2.8 起旧 DevTools 端口被内置 DevTools 取代（官方文档未更新） | 中 | 排查路径失效、spike 不可观测 | Phase 0 先实测入口（§2.4、§4.4）；保留 HUD 自证能力（不依赖外部 DevTools 也能读数） |
| **R11** | Workshop 政策变动（Application 类型被下架的同类先例） | 中 | 作品被下架 | 保留本地完整副本；不依赖 Workshop 专属 API；README 写明 WE 已验证版本 |
| **R12** | 多显示器/高 DPI 下开销翻倍 | 中 | 挂机目标不达 | Phase 4 实测多显示器；§1.2 记录分辨率与显示器数量；空闲降帧 |
| **R13** | 变体贴图数量增长（脆空 6 级 + 双星 2 + 炮 2 + 闯入者 2 + 陌生者 2） | 低 | 显存 | 单张 512×256 ⇒ 合计 < 5 MB；按需惰性生成（首次触发时才烘焙） |
| **R14** | 设计值（半径/白洞/陌生者/卫星）与游戏观感有出入 | 低 | 视觉还原度 | 全部集中 §3.10 且可调；容差已声明（§9.1） |

> **已消失的风险**（随栈变更作废）：WorkerW 挂载失败、Raw Input 滚轮失效、桌面图标冲突、Win11 双分支、普通 exe 无法交 WE 托管（仅 Workshop 受限，本地仍可）。

---

## 7. 素材与授权

**官方立场**（已通读 `Mobius Digital Fan Content Policy`，2022-05-19 版）：免费即可；不得暗示官方背书；**明文条款 "Don't ask us for assets or files"（官方不提供任何素材）**；禁止 NFT；mod 欢迎；官方保留随时叫停权。

**署名（本轮补全）**：datamine 表由 **Lilac Peregrine**（收集整理）、**Mister Nebula**（Datamining）、**Gorfinhofin**（CSV 首行 credit）、**Thomas**（太阳半径）、**Brungo**（质量）、**Brady** 协作产出；手测周期表来自 **u/AltorinianUniverse**，开普勒拟合来自 **u/Jesper2k**；事件表来自 **`clubby789/OWClock`**。**README 与 Workshop 说明必须逐名署名。**

**许可**：代码 `LICENSE` = MIT；数据（`bodies.json` / `events.json`）标注为"由上述社区数据整理"，随 `NOTICE.md` 声明来源，不主张额外权利。

| 用途 | 来源 | 授权状态 | 决定 |
|---|---|---|---|
| 天体贴图 | **程序化生成**（`OffscreenCanvas`，§4.3） | 自有 | ✅ **唯一使用**（Workshop 合规的关键） |
| 天体贴图 | `SeekNHack/…LIVE-Wallpaper/assets/*.png` | 游戏素材提取，同人灰区 | ❌ 不使用（Workshop 分发风险） |
| 天体图标 | `RiosDeterioratingMentalHealth/OuterWildsPlanetIcons` | 仓库无 LICENSE | ❌ 不使用（需作者许可） |
| 字体 | 游戏用 `ITC Serif Gothic ExtraBold` | 商业字体 | ❌ 替换为开源衬线体（Marcellus / Della Respira 类）或自绘 |
| preview 图 | 自渲染截图 | 自有 | ✅ 必须自己出图 |

**Workshop 合规清单（发布前逐项打勾）**：☐ 免费、无付费/捐赠引导 ☐ 无 NFT 相关字样 ☐ 无游戏素材/音频 ☐ 无商业字体 ☐ 无非官方背书暗示 ☐ 含官方免责句 ☐ 逐名署名 ☐ 运行期零网络请求 ☐ 不含 `.exe`/脚本外联 ☐ 保留本地副本。

---

## 8. 附录

### A. 已验证的 URL 清单（本轮复核新增项以 ★ 标注）

**事件时间表（权威）**
- `https://raw.githubusercontent.com/clubby789/OWClock/master/ClockLib/events.json` —— 87 条秒级事件（★ 本轮复核条目数 = 87 一致）

**轨道数据**
- `https://docs.google.com/spreadsheets/d/1MbGYmH20m5NLCEsCe-v_kkn3oldxVY67vj4bF5UJMko/export?format=csv` —— **datamine 主数据源**（已归档，★ sha256 复核一致）
- `https://api.pullpush.io/reddit/search/comment/?link_id=t3_dhx2if&size=100` —— 手测周期表（AltorinianUniverse）+ 开普勒拟合（Jesper2k）
- `http://outerwilds.fandom.com/api.php?action=parse&page=<页名>&prop=wikitext&format=json` —— ★ fandom 走 **http + api.php** 可用（https 会证书校验失败；直连 403）
- `https://raw.githubusercontent.com/Outer-Wilds-New-Horizons/new-horizons/main/NewHorizons/Components/Orbital/OrbitalParameters.cs` —— 字段与反解数学
- `https://raw.githubusercontent.com/Outer-Wilds-New-Horizons/new-horizons/main/NewHorizons/Schemas/body_schema.json` —— Orbit 字段权威定义
- `https://raw.githubusercontent.com/Outer-Wilds-New-Horizons/new-horizons/main/NewHorizons/Utility/OuterWilds/AstroObjectLocator.cs` —— ★ 内名映射与父子关系（`WhiteholeStation_Body` 属 `WhiteHole`；`MapSatellite` 子体 `HearthianRecorder_Body`）

**WE 宿主**
- ★ `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=431960&count=40&format=json` —— **官方公告全文**（比抓 store 页面可靠），2.8.42 条目日期 2026-06-29
- ★ `https://docs.wallpaperengine.io/sitemap.xml` —— 穷举文档页（`/en/web/` 共 12 页、无输入页；`/en/` 下无 Application 章节）
- `https://docs.wallpaperengine.io/en/scene/scenescript/reference/event/cursor.html` —— Scene 输入只有 cursorMove/Down/Up/Click，无滚轮
- ★ `https://docs.wallpaperengine.io/en/scene/scenescript/reference/class/IInput.html` —— 轮询接口也只有 cursorWorldPosition / cursorScreenPosition / cursorLeftDown（**无滚轮**）
- `https://docs.wallpaperengine.io/en/web/api/propertylistener.html` · `…/web/performance/fps.html` · `…/web/first/gettingstarted.html`
- `https://docs.wallpaperengine.io/en/web/debug/debug.html` —— ⚠️ **已滞后**：仍描述旧的 "CEF devtools port"，而 WE 2.8 已改为内置 DevTools
- `https://help.wallpaperengine.io/en/functionality/cli.html` —— `-control hideIcons` / `showIcons` / `openWallpaper -playInWindow` / `applyProperties`（★ 本轮核对原文）

**备选宿主 / 先例**
- `underpig1/octos`（774★）—— 交互式网页壁纸宿主，但**不能发布到 WE Workshop**
- `hexxone/audiorbits`（44★）· `HalcyonAlcedo/WallpaperEngine-WebTemplate`（17★）· `SeekNHack/Outer-Wilds-Star-System-LIVE-Wallpaper`（事件表互校）· `nottldr/outer-wilds-ventures`（非本项目目标）

### B. 归档、日期与复核记录

所有 URL 内容抓取于 **2026-09-17**（v1 与 v2 同日）。
本地归档：`data/sources/ow-game-data-community.csv`（sha256 `c631a2e06ca67c2255aa54d3ae84e24f92f8916dde4b8d82e2150b7ca12a1e26` —— ★ 本轮重新计算，一致）。

**本轮复核中"计划写错、已修正"的点**：① 公告误读（§0/§2.3）；② 黑棘偏差符号（§3.3）；③ 炉星卫星名称与半径（§3.2/§3.10）；④ 白洞站父体（§3.6）；⑤ 验证一循环论证（§3.3）；⑥ `/en/web/` 页数 11→12（§2.4）；⑦ 循环长度 1320/1360 冲突（§0）；⑧ 太阳半径线性假设的隐含错误（§3.8）。

---

## 9. 验收容差与闭环

### 9.1 一致性容差（分级，取代 v1 的"逐条 ±1s"）

| 级别 | 适用 | 容差 | 说明 |
|---|---|---|---|
| **A 锚点** | 直接由 `t` 驱动、无轨道耦合的事件：0 / 120 / 1220 / 1320 / 1330 / 1360s，太阳半径三点锚位，各天体周期 | **±1s / ±0.1%** | 必须精确，测试断言 |
| **B 轨道耦合** | 闯入者开闭壳（220/260/695/735/1175）、撞日 1185、太阳站被吞没 690、卫星 40° 200s、量子塔 1085 | **±5s**（目标 ≤2s） | 由 §3.9 联立解决定，残差表必须留档 |
| **C 装饰性** | 流星、闪电、量子月迁移、背景星熄灭、探测器轨迹 | **只约束频率/总量 ±25%**，单次时刻不约束 | 种子固定可复现即可 |
| **D 尺度/外观** | 映射压缩、半径放大、设计值（§3.10） | 与游戏观感一致即可，允许小差别 | 用户可调；「真实比例」开关可校验序关系 |

> 用户明确接受 C/D 级差别（2026-09-17）。B 级若超差，按 §3.9 的优先级牺牲并**在 README 公开残差**，不做静默调整。

### 9.2 未决策项（本轮全部闭合）

| 项 | 结论 |
|---|---|
| 发布渠道 | **Steam Workshop**（§0） |
| 音频 | **无**（Phase 6 后可加为用户属性） |
| 代码许可 | MIT（§7） |
| `project.json` 是否入库 | **入库**（便于 CLI 开窗测试） |
| 循环长度与复位 | 1360s + 白闪遮盖（§0） |
| 暂停恢复语义 | 默认 `paused-loop`，用户可切 `wall-clock`（§4.4） |
| 键盘交互 | 待 Spike A 焦点判定；默认不实现（§2.4） |

### 9.3 复核闭环表（2026-09-17 审阅的每一条 → 落点）

| 复核发现 | 处置 | 落点 |
|---|---|---|
| P0-1 官方公告误读、栈变更理由错 | 修正引文与结论，理由改为"要上 Workshop" | §0 修正记录、§2.3 |
| P0-1 发布渠道从未决策 | 决策为 Workshop；排除 octos 备选 | §0、§2.4 备选 2 |
| P0-2 事件 ±1s 数学上不可达 | 引入分级容差 A/B/C/D；闯入者事件降为 B 级 | §9.1、§3.9 |
| P0-3 太阳半径与 690s 吞没不自洽 | 交付分段曲线 + 锚点 + 校验点 | §3.8 |
| P0-4 双尺度映射与吞没事件冲突 | 太阳半径与轨道半径共用同一单调映射 ⇒ 精确涌现；给出间隙校验表与 `k_body` 上限 | §3.7 |
| 验证一循环论证 | 重新定性为自洽性检查，补真正独立的手测 T 反解表 | §3.3 |
| 黑棘偏差符号写反 | 改 −2.76% | §3.3 |
| 署名漏 Gorfinhofin | 补入三处 | §3.2、§7 |
| 太阳自转 "Inconclusive" 被写成 "—" | 标注原文备注，决定不自转 | §3.2、§3.10 |
| "反解"违反规则 3（OPC/卫星用 μ_sun） | 作废两值，改设计值并写进规则 | §3.4 规则 3、§3.10 |
| 炉星卫星命名与 2531 m 与 wiki 矛盾 | 改名 SkyShutter Satellite（内名 MAP_SATELLITE）、半径改 500 m、补 40° 相位锚 | §3.2、§3.6、§3.10 |
| 白洞站父体错挂太阳 | 父体改白洞，给共轨设计值 | §3.6、§3.10 |
| 宇宙之眼 410k–657k 是误差带 | 取定值 500000 m 并说明 | §3.10 |
| 5 个对象缺半径 ⇒ 画不出球 | 新增规则 5 + 设计值总表 | §3.4、§3.10 |
| 贴图状态变体未进架构 | 新增变体表（含惰性烘焙） | §4.3、R13 |
| 量子月判定/驻留/可达性未定义 | 定义附着、视锥不可见 +30s、种子游走、不进 Eye 位 | §3.10 |
| 87→实现 无逐条映射、漏 3 个闯入者窗口 | 新增逐条映射 + `dropped[]` 落库 | §3.5.1 |
| 无来源条目（探测炮解体/流星/闪电/星熄） | 标注来源列（设计/推断），并归入 C 级容差 | §3.5.1 |
| 随机事件无确定性策略 | 固定种子 + 由 `t` 驱动 | §3.5 |
| 事件"视觉表现"列空白 | 逐条补齐，可弃项显式标注 | §3.5.1 |
| "逐个 Year length 一致"无参考值 | 改为与 `bodies.json` 一致 + 来源标注 | §1.2 |
| "1320s 相位无缝"是伪需求 | 改 1360s 复位 + 白闪遮盖 | §0、§5 Phase 3 |
| 帧率验收未绑限帧器/分辨率 | 写入前置条件与分辨率记录要求 | §1.2 |
| 挂机开销未定义进程集合与 idle | 定义进程树、采样窗口、`idle = 无输入且无活跃事件`、降帧到 `idleFps` | §1.2、§4.2 |
| Spike B 低估负载 | 改为按真实负载（含超新星峰值）测 | §5 Phase 0.2 |
| DevTools 端口已被内置 DevTools 取代 | 新增检查项与风险，改为不依赖外部 DevTools 也能读数 | §2.4、§4.4、R10 |
| 未用 CLI 的 playInWindow / applyProperties | 写入验证流程 | §4.4、§5 Phase 0.4 |
| WebGL2/SwiftShader 未验证 | 加能力检测、兜底图、风险与验收项 | §1.2、§4.2、R9 |
| 无专用壁纸根目录 | 定义 `wallpaper/` 为工程根与完整目录结构 | §4.5 |
| 键盘回退不可靠 | 降为最低优先级 + 探针实测焦点 | §2.4、§5 Phase 0 判读表 |
| 未决策项（音频/许可/README 语言） | 全部闭合 | §9.2、§7、§5 Phase 5 |
| 逻辑层无测试策略 | 定义 Node 可测边界 + `test/` 覆盖清单 | §4.5、§5 Phase 1 |
| 探针未测 Pointer/键盘焦点 | 升级探针（Pointer Events、capture、keydown 焦点格） | §2.4、§5 Phase 0 |
