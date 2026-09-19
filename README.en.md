# Outer Wilds · Solar System Wallpaper

An unofficial, procedurally rendered 3D orrery for Wallpaper Engine (Web wallpaper).

**0.2.1-dev — local prerelease. Desktop acceptance is pending; not published to Workshop.**

[中文](README.md) · [Acceptance status](STATUS.md) · [Credits](NOTICE.md)

## Spoiler warning

The scene includes locations and time-dependent changes from the base game and DLC. Avoid it if you want a completely spoiler-free playthrough.

All planet textures are generated in code. No extracted game assets, audio, remote downloads or telemetry are included. This is an orrery, not a playable recreation of the game.

## Preview and controls

Open `wallpaper/index.html` in a browser with hardware-accelerated WebGL2. No server is required. Drag the left mouse button to orbit, scroll to zoom, and drag the middle button to pan. Browser-only shortcuts: Shift+drag to pan, H for the debug HUD, P to pause, R to reset the cycle. Keyboard delivery was not available in the tested WE preview.

Default draw caps are 15 FPS idle and 30 FPS active, further limited by Wallpaper Engine's global setting. The debug HUD is off by default.

## Wallpaper Engine

Keep the complete `wallpaper/` directory or generated distribution. The project entry is `project.json`, and its page is `index.html`. Open a local WE preview using its official CLI with `-control openWallpaper -file "<absolute path>/project.json" -playInWindow "Outer Wilds Preview"`.

**Desktop interaction is drag to orbit plus the lower-right + / − / home buttons.** The host does not forward wheel events to web wallpapers; on 2026-09-19 the user accepted the button scheme as the acceptance standard. Desktop drag and button clicks were both confirmed on the real desktop. Browser wheel zoom remains available. Follow `spike/README.md` in the source project before changing desktop settings.

The property panel exposes frame limits, time scale, orbit visibility, visual scale, star brightness, Quantum Moon dwell time, resume mode and the HUD. Default resume behavior freezes the cycle; optional wall-clock mode catches up once when resumed.

## Build and package

Node.js 22+. No third-party dependencies are needed for the core build or unit tests.

- `npm run serve`: localhost preview.
- `npm run verify`: regenerate data/bundle and run unit tests.
- `npm run package`: create an allowlisted distribution with SHA-256 hashes and explicit pending acceptance items. Never uploads anything.
- `npm run test:browser`: optional Playwright checks; install Playwright/Chromium separately or supply `PLAYWRIGHT_MODULE` and `BROWSER_EXECUTABLE`.
- `npm run preview:cover`: also generate the 1920×1080 cover from the actual scene.

Probe code and local beacon traffic are development-only, excluded from the wallpaper package. The package has no HTTP dependencies. Source files are now allowed by the project ignore rules but are not automatically committed.

## Remaining release gates

Landscape desktop drag, brief dual-screen rendering and real-host paused-loop pause/resume were verified. Wheel delivery, complete uninterrupted 10-minute runs at the specified resolution, extended multi-monitor operation and wall-clock/sleep recovery remain open. The idle run restarted; the active CPU sample covered 599.17 seconds with one missing GPU sample. See STATUS.md for evidence and limitations. Without WebGL2, a text fallback is displayed rather than a full static scene.

<details><summary>Spoilers: simulation scope</summary>

The cycle is 1360 seconds including the tail after the main loop. The implementation selects 19 of 87 OWClock entries, with explicit reasons for the 68 omitted entries; it does not simulate every in-game event. Decorative effects are deterministic. Source data, fitted values and tolerances are documented in the source project.

</details>

## License and credits

Code: MIT (LICENSE). Game IP is excluded from that license. NOTICE.md contains full data credits, attribution and the fan-content notice.

This work is unofficial Fan Content created under permission from the Mobius Digital Fan Content Policy. It includes materials which are the property of Mobius Digital and it is neither approved nor endorsed by Mobius Digital.
