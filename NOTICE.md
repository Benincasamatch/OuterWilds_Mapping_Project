# NOTICE — 数据来源、署名与合规

本仓库是**非官方同人作品**。与 Mobius Digital 及 Annapurna Interactive 无关。

> This work is unofficial Fan Content created under permission from the Mobius Digital Fan Content Policy. It includes materials which are the property of Mobius Digital and it is neither approved nor endorsed by Mobius Digital.

## 1. 代码

`LICENSE` = MIT（仅覆盖本仓库源码）。

## 2. 数据与事件的来源（必须随作品署名）

| 用途 | 来源 | 说明 |
|---|---|---|
| 天体半径/质量/自转/轨道半径/公转周期 | 社区 datamine 表格（`data/sources/ow-game-data-community.csv`，sha256 `c631a2e0…`） | 署名：**Lilac Peregrine**（数据收集与整理）、**Mister Nebula**（Datamining）、**Gorfinhofin**、**Thomas**（太阳半径）、**Brungo**（质量）、**Brady** |
| 手测公转周期（太阳站 / 双星 / 卫星 / 科考炮 / 空心灯 / 深巨星 / 黑棘 / 闯入者） | r/outerwilds 帖子 `Orbital periods of all the planets`（`t3_dhx2if`，镜像 `data/sources`）中 **u/AltorinianUniverse** 的实测表 | 手测值误差约 ±2.5s（见 PLAN.md §3.9） |
| 开普勒拟合常数 `μ = 4×10⁸ m³/s²` | 同帖 **u/Jesper2k** 给出的社区拟合 | 用于反解与交叉校验 |
| 22 分钟事件时间戳（87 条） | **`clubby789/OWClock`** 的 `ClockLib/events.json`（`data/sources/ow-clock-events.json`，sha256 `7482a16a…`） | 验收基准 |
| 原版内部命名与父子关系 | **New Horizons**（`Outer-Wilds-New-Horizons/new-horizons`）的 `AstroObjectLocator.cs` 等 | 仅用于对齐社区数据 |

归档日期：**2026-09-17**。原始文件与哈希随仓保存；社区数据可能变动，`npm run build:data` 可重现本仓库使用的全部数值（`data/fits-report.md` 为构建产出的拟合报告）。

## 3. 素材合规（Workshop 发布前置）

- **贴图**：全部在运行时由 `OffscreenCanvas` **程序化生成**，不使用任何游戏素材或第三方图片。
- **字体**：只使用系统衬线/等宽字体栈（Georgia / Consolas 等），不使用游戏原用的商业字体 `ITC Serif Gothic`。
- **音频**：无。
- **未使用的外部资源**：`SeekNHack/…LIVE-Wallpaper` 的游戏素材贴图、`OuterWildsPlanetIcons` 的图标 —— 均**未使用**（许可不明或为游戏素材）。
- 运行期**零网络请求**：所有代码与数据随作品打包。

## 4. 许可与分发

- 免费发布，不含任何付费、捐赠引导或 NFT 相关内容。
- 官方 Fan Content Policy 明示 "Don't ask us for assets or files"（官方不提供素材）；本项目遵守该条。
- 官方保留随时叫停权；若收到要求，将下架。
