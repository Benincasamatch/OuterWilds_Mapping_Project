// Shared defaults and validation rules for the host property bridge.
export const DEFAULTS = {
  fpsLimit: 30, idleFps: 15, orbitLines: true, showHud: false, showControls: true, realScale: false,
  compression: 0.45, bodyScale: 1.4, localScale: 2, timeScale: 1, pauseMode: 'paused-loop',
  qmDwell: 30, starBrightness: 1,
};
export const PROPERTY_RULES = {
  fpsLimit: { min: 15, max: 60 }, idleFps: { min: 5, max: 30 },
  compression: { min: 0.2, max: 1 }, bodyScale: { min: 1, max: 1.5 },
  localScale: { min: 1, max: 4 }, timeScale: { min: 0.25, max: 10 },
  qmDwell: { min: 10, max: 120 }, starBrightness: { min: 0, max: 2 },
  pauseMode: { values: ['paused-loop', 'wall-clock'] },
};
