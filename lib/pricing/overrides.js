import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { splitModelRoute } from '../providers/codex/model-route.js';

const FILE_NAME = 'model-overrides.json';
const TTL_MS = 1000;

function emptyOverrides() {
  return { aliases: new Map(), prices: new Map(), warnings: [] };
}

const EMPTY = emptyOverrides();

export function overridesPath() {
  const dir = process.env.CCGAUGE_STATE_DIR || path.join(os.homedir(), '.ccgauge');
  return path.join(dir, FILE_NAME);
}

function normalizeKey(name) {
  return splitModelRoute(String(name).trim()).model.toLowerCase();
}

function amount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function toPricing(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const input = amount(raw.input);
  const output = amount(raw.output);
  if (input === null || output === null) return null;
  const cacheRead = raw.cacheRead === undefined ? input * 0.1 : amount(raw.cacheRead);
  const cacheCreation5m = raw.cacheCreation5m === undefined ? 0 : amount(raw.cacheCreation5m);
  const cacheCreation1h = raw.cacheCreation1h === undefined ? 0 : amount(raw.cacheCreation1h);
  if (cacheRead === null || cacheCreation5m === null || cacheCreation1h === null) return null;
  return { input, output, cacheCreation5m, cacheCreation1h, cacheRead };
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseModelOverrides(text) {
  const out = emptyOverrides();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    out.warnings.push(`invalid JSON (${error.message})`);
    return out;
  }
  if (!isPlainObject(data)) {
    out.warnings.push('expected a JSON object');
    return out;
  }
  if (data.aliases !== undefined) {
    if (!isPlainObject(data.aliases)) {
      out.warnings.push('"aliases" must be an object');
    } else {
      for (const [from, to] of Object.entries(data.aliases)) {
        if (!from.trim() || typeof to !== 'string' || !to.trim()) {
          out.warnings.push(`alias "${from}" must map to a model name`);
        } else {
          out.aliases.set(normalizeKey(from), to.trim());
        }
      }
    }
  }
  if (data.prices !== undefined) {
    if (!isPlainObject(data.prices)) {
      out.warnings.push('"prices" must be an object');
    } else {
      for (const [model, raw] of Object.entries(data.prices)) {
        const pricing = model.trim() ? toPricing(raw) : null;
        if (!pricing) {
          out.warnings.push(`price "${model}" needs numeric input and output (USD per 1M tokens)`);
        } else {
          out.prices.set(normalizeKey(model), pricing);
        }
      }
    }
  }
  return out;
}

let cache = null;
let warnedFor = null;

export function invalidateModelOverridesCache() {
  cache = null;
  warnedFor = null;
}

export function loadModelOverrides() {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;
  const file = overridesPath();
  let value = EMPTY;
  let version = null;
  try {
    version = `${file}:${statSync(file).mtimeMs}`;
    if (cache && cache.version === version) {
      cache = { ...cache, at: now };
      return cache.value;
    }
    value = parseModelOverrides(readFileSync(file, 'utf8'));
  } catch {
    value = EMPTY;
  }
  cache = { at: now, version, value };
  if (value.warnings.length > 0 && warnedFor !== version) {
    warnedFor = version;
    console.error(`[ccgauge:pricing] ${file}: ${value.warnings.join('; ')}`);
  }
  return value;
}
