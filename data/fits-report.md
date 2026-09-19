# 拟合与校验报告

生成：2026-09-17（`npm run build:data`）

## 闯入者联立解（PLAN.md §3.9）

- 由 datamine 近日点 2500 m / 远日点 24000 m ⇒ a=13250.0 m, e=0.8113
- μ_sun = 400000000 ⇒ T = **479.15 s**（手测 480 s，差 -0.18%）
- 三次近日点：233.9 / 713.1 / 1192.2 s
- 撞日：1185.00 s（目标 1185 s），此刻 R_sun = 3531.8 m
- 冰壳阈值：r_open(t) = 4872.9 + 0.3171·R_sun(t)，闭壳 = 开壳 + 40 s
- **残差**（目标 ≤2 s，容差 B ≤5 s）：第1次 -1.73 s · 第2次 2.11 s · 第3次 -0.35 s

## 太阳半径曲线（PLAN.md §3.8）

- 锚点：R(0)=2001.75 / R(690)=2315 / R(1320)=4000
- 校验：R(226.6)=2088.8 / R(706)=2326.8 / R(812.6)=2499.9 / R(1185)=3531.8 m
- 约束：R(t) < 2500 m 覆盖前两次近日点（2092.0、2334.4）✅

## 尺度间隙（PLAN.md §3.7）

| 组合 | 视距 | 间隙 |
|---|---|---|
| ash_twin ↔ hourglass_barycentre | 500.0 | 263.4 |
| ember_twin ↔ hourglass_barycentre | 500.0 | 262.0 |
| white_hole_station ↔ white_hole | 600.0 | 439.0 |
| attlerock ↔ timber_hearth | 1800.0 | 1332.4 |
| skyshutter ↔ timber_hearth | 1000.0 | 616.4 |
| hollows_lantern ↔ brittle_hollow | 2000.0 | 1483.0 |
| opc ↔ giants_deep | 2200.0 | 507.4 |
| sun ↔ sun_station (t=0, mapped) | 4270.4 | 186.4 |

k_body 上限 1.479（默认 1.4）

## 事件映射

- OWClock 共 87 条：实现 19 条，弃置 68 条（逐条理由见 events.json `dropped[]`）
- 装饰性事件 4 项（种子 221026，由 t 驱动）
