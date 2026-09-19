@echo off
REM ==========================================================================
REM PLAN.md Phase 0 / Spike A —— 关键闸门：Wallpaper Engine 会不会把鼠标输入
REM （尤其是滚轮）送进 Web 壁纸？
REM
REM 双击本文件即可。它会：
REM   1) 启动 beacon 接收器（把结果写成文本，不需要人工抄数字）
REM   2) 在 WE 里把探针壁纸开成一个窗口
REM 请在窗口里：按住左键拖动一次、滚一次滚轮、敲一下键盘。
REM 屏幕上方的横幅会直接给出结论（拖动 / 滚轮 / 键盘 各自 OK 或 X）。
REM 按回车结束测试并关闭窗口。
REM ==========================================================================
setlocal
chcp 936 >nul
set "WE=E:\SteamLibrary\steamapps\common\wallpaper_engine\wallpaper64.exe"
set "HERE=%~dp0"
set "PROJ=%HERE%input-probe\project.json"

if not exist "%WE%" (
  echo [x] 找不到 Wallpaper Engine:
  echo     %WE%
  echo     请用记事本打开本文件，把上面的 WE= 改成实际安装路径。
  pause
  exit /b 1
)
if not exist "%PROJ%" (
  echo [x] 找不到探针工程: %PROJ%
  pause
  exit /b 1
)

echo [1/3] 启动 beacon 接收器 (127.0.0.1:8124)...
start "ow-beacon" /min cmd /c node "%HERE%beacon-server.mjs"
timeout /t 2 /nobreak >nul

echo [2/3] 在 Wallpaper Engine 里打开探针窗口（要求 WE 已在运行）...
"%WE%" -control openWallpaper -file "%PROJ%" -playInWindow "OW Input Probe" -width 1024 -height 640 -x 80 -y 80 -activate

echo.
echo [3/3] 请在弹出的窗口里依次做三件事:
echo        1. 按住左键拖动  -- 看横幅里的 拖动 是否变成 OK
echo        2. 滚动滚轮      -- 看 滚轮 是否变成 OK  (这是最关键的未知项)
echo        3. 随便敲一下键盘 -- 看 键盘 是否变成 OK
echo      横幅显示 OK 的项目 = WE 确实把该输入转发进了网页。
echo.
pause

echo 关闭探针窗口...
"%WE%" -control closeWallpaper -location "OW Input Probe"
echo 结果已记录在: %HERE%beacon.log
timeout /t 3 /nobreak >nul
endlocal
