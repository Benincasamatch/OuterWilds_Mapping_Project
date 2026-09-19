// Wallpaper Engine user-property bridge — PLAN.md §4.4 / §3.7.
//
// Two facts drive this module:
//   1. WE lower-cases every property name before it reaches `applyUserProperties`
//      (`project.json` says `fpslimit`, the scene's field is `fpsLimit`), so a naive
//      `if (key in props)` check silently drops almost every setting.
//   2. WE sliders/combo/colour values arrive as strings often enough that numbers
//      must be coerced, otherwise `dt * props.timeScale` turns into NaN.
//
// Pure: no DOM, no globals, so the mapping is unit-tested (test/props.test.mjs).

export function createProps(defaults, rules = {}) {
  const props = { ...defaults };
  const byLowerName = new Map(Object.keys(props).map((k) => [k.toLowerCase(), k]));

  return {
    props,

    /** Name of the field a WE property key maps to, or null when unknown. */
    fieldOf(rawKey) {
      return byLowerName.get(String(rawKey).toLowerCase()) ?? null;
    },

    /**
     * Apply one WE `applyUserProperties` batch. Returns the list of the scene fields
     * that actually changed, so the caller can rebuild only what it must.
     */
    apply(updates) {
      const changed = [];
      if (!updates) return changed;
      for (const rawKey of Object.keys(updates)) {
        const field = byLowerName.get(String(rawKey).toLowerCase());
        if (!field) continue;
        const value = updates[rawKey]?.value;
        if (value === undefined) continue;
        const current = props[field];
        let next;
        if (typeof current === 'boolean') {
          if (value === true || value === 1 || value === 'true' || value === '1') next = true;
          else if (value === false || value === 0 || value === 'false' || value === '0') next = false;
          else continue;
        }
        else if (typeof current === 'number') {
          if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') continue;
          next = Number(value);
          if (!Number.isFinite(next)) continue;
        } else {
          if (typeof value !== 'string') continue;
          next = value;
        }
        const rule = rules[field];
        if (rule?.values && !rule.values.includes(next)) continue;
        if (typeof next === 'number' && rule) next = Math.min(rule.max ?? Infinity, Math.max(rule.min ?? -Infinity, next));
        if (next === current) continue;
        props[field] = next;
        changed.push(field);
      }
      return changed;
    },
  };
}
