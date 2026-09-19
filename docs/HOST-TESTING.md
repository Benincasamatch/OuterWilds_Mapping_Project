# WE 桌面验收工具

这些工具只用于本机测试，不会进入壁纸交付包，也不改变正式 bundle 中的渲染代码。

## 操作边界

- 先获得使用者对临时切换桌面、播放规则与测试时长的许可。
- 先将原壁纸/设置保存在本机 `.desktop-test/restore-state.json`；该目录已忽略，不应提交或分享。
- 官方 CLI 的 monitor 编号从 0 开始，但存在历史编号、断开的显示器和缓存映射。不能用旧 `monitormap` 推断哪个是主屏；必须同时核对 UI 标签和探针实际回传尺寸。
- 打开 WE 浏览器可能重新应用上次选中的项目；性能测量前应关闭浏览器，并重新核对目标壁纸与 CEF 进程池。
- 脚本不能替代真实桌面拖动/滚轮操作。不要把预览窗口通过当作桌面通过。

## 工具

1. `node tools/build-host-probe.mjs natural|idle|active|peak`
   - 复制当前正式 bundle 到 `.desktop-test/runtime-<mode>/`，记录 SHA-256。
   - 仅在副本 HTML 后增加诊断层，每 5 秒回传绘制数、模拟时间、相机和尺寸到 localhost:8124。
   - natural 不改变时间线；idle 重复 10–40s（无事件）；active 重复 200–260s（沙流）；peak 重复 1319–1324s（超新星峰值）。
   - 重复测试时段是受控工作负载，不能伪装成自然连续循环性能。
2. `node spike/beacon-server.mjs`
   - 仅监听 127.0.0.1，默认追加 `spike/beacon.log`，可用 BEACON_LOG 指定本机测试日志。
3. `tools/measure-host.ps1 -Seconds 600 -Label <唯一标签>`
   - 只读 CPU/GPU/工作集，不操作窗口或壁纸。
   - CPU 为整机百分比，CEF 与 wallpaperui 合计；wallpaper64 单独记录。
   - GPU 为相关进程的 GPU Engine 利用率求和，不等同于任务管理器整卡百分比；不可跨硬件直接比较。
   - 进程池活动不能证明壁纸运行，必须关联诊断层的持续绘制证据。
4. `tools/run-host-acceptance.ps1 -Monitor <已核实编号> -Seconds 600 -Run <唯一标签>`
   - 依次运行空闲 10 分钟、活跃 10 分钟、峰值 1 分钟；失败或结束后在 finally 中恢复目标屏幕原壁纸。
   - 使用已存在的恢复记录，不猜原壁纸；不隐藏图标、不注入输入、不修改播放规则。
   - 播放规则需单独记录并通过 UI 恢复。脚本恢复后还必须核对配置和实际显示。
5. `node tools/summarize-host.mjs .desktop-test/<标签> .desktop-test/<beacon日志>`
   - 验证采样时长、连续绘制、同一会话、稳定尺寸、无暂停及 idle 确实无活跃事件。
   - 输出 measured 只代表该测试条件测到了有效数据，不代表发布闸门全部通过。

## 结果应记录

版本/哈希、WE 版本、GPU、显示器物理分辨率与页面 CSS/Framebuffer 尺寸、DPR、用户播放规则、单屏/双屏、采样时长、空闲/活跃/峰值、用户是否实际操作、是否恢复。

2026-09-19 首次临时 CPU 采样曾触发 PowerShell `Math.Max` 的整数重载，低于 1 秒的 CPU 差值被错误舍入为零；已改为显式 double。该初步记录被标记无效，不能作为“零 CPU”宣传依据。
