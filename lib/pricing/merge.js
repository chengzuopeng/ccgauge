// Pure pricing merge + validation helpers.
//
// Extracted from store.ts (which owns disk IO / fetch / TTL orchestration) so the
// risky logic — overlay-wins merge, family-fallback rebuild, and the validation
// gate that stops an upstream bad table from corrupting cost math — is unit-testable
// under raw `node --experimental-strip-types` runs. Plain `.js` (+ `.d.ts`), same
// pattern as litellm-transform.js: no extensionless/aliased value imports.

const PRICING_KEYS = ['input', 'output', 'cacheCreation5m', 'cacheCreation1h', 'cacheRead'];

export function isValidPricing(p) {
  if (!p || typeof p !== 'object') return false;
  for (const k of PRICING_KEYS) {
    const v = p[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return false;
  }
  return true;
}

/**
 * Sanity-gate a candidate pricing table pair. Returns null if valid, else a
 * human-readable reason. Floors default to just under the committed snapshot so an
 * upstream table that suddenly shrinks (or carries NaN/negative costs) is rejected.
 */
export function validatePricingTables(claude, openai, opts = {}) {
  const minClaude = opts.minClaude ?? 15;
  const minOpenai = opts.minOpenai ?? 80;
  if (!claude || typeof claude !== 'object') return 'claude table missing';
  if (!openai || typeof openai !== 'object') return 'openai table missing';
  const cKeys = Object.keys(claude);
  const oKeys = Object.keys(openai);
  if (cKeys.length < minClaude) return `claude count ${cKeys.length} < ${minClaude}`;
  if (oKeys.length < minOpenai) return `openai count ${oKeys.length} < ${minOpenai}`;
  if (!cKeys.some((k) => k.startsWith('claude-'))) return 'no claude-* key';
  if (!oKeys.some((k) => k.startsWith('gpt-'))) return 'no gpt-* key';
  for (const [k, v] of Object.entries(claude)) if (!isValidPricing(v)) return `bad claude entry ${k}`;
  for (const [k, v] of Object.entries(openai)) if (!isValidPricing(v)) return `bad openai entry ${k}`;
  return null;
}

/** Merge an overlay onto a base table: base first, overlay wins for shared keys. */
export function mergeOverlay(base, overlay) {
  return overlay ? { ...base, ...overlay } : { ...base };
}

/**
 * Rebuild a family→Pricing fallback map from a (merged) table using anchor model
 * keys. Sourcing from the merged map means a refreshed price for the anchor model
 * flows into the fallback too. Anchors absent from the map are omitted.
 */
export function buildFallback(map, anchors) {
  const out = {};
  for (const [family, key] of Object.entries(anchors)) {
    if (map[key]) out[family] = map[key];
  }
  return out;
}
