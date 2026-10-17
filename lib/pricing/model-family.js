import { splitModelRoute } from '../providers/codex/model-route.js';

const OPENAI_PRIORITY = /^(?:gpt-|o\d|codex-(?!auto-review))/;
const VERSION_HEAD = /^v?\d/;
const NUMERIC = /^\d{1,2}(?:\.\d{1,2})*$/;
const DATE_LIKE = /^\d{4,}$/;

export function isOpenAIPriorityModel(model) {
  if (!model) return false;
  return OPENAI_PRIORITY.test(splitModelRoute(model).model.toLowerCase());
}

function parseVersioned(name) {
  const tokens = name.toLowerCase().split('-');
  let i = 0;
  while (i < tokens.length && !VERSION_HEAD.test(tokens[i])) i += 1;
  if (i === 0 || i === tokens.length) return null;
  const stem = tokens.slice(0, i).join('-');
  const version = [];
  let head = true;
  while (i < tokens.length) {
    const token = head ? tokens[i].replace(/^v/, '') : tokens[i];
    if (!NUMERIC.test(token)) break;
    for (const part of token.split('.')) version.push(Number(part));
    head = false;
    i += 1;
  }
  if (version.length === 0) return null;
  const flavor = tokens
    .slice(i)
    .filter((token) => !DATE_LIKE.test(token))
    .join('-');
  return { stem, version, flavor };
}

function compareVersions(a, b) {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const indexes = new WeakMap();

function indexOf(table) {
  let index = indexes.get(table);
  if (index) return index;
  index = new Map();
  for (const key of Object.keys(table)) {
    const parsed = parseVersioned(key);
    if (!parsed) continue;
    const bucket = `${parsed.stem}|${parsed.flavor}`;
    let list = index.get(bucket);
    if (!list) {
      list = [];
      index.set(bucket, list);
    }
    list.push({ key, version: parsed.version });
  }
  indexes.set(table, index);
  return index;
}

function isBetter(candidate, best) {
  if (!best) return true;
  const diff = compareVersions(candidate.version, best.version);
  if (diff !== 0) return diff > 0;
  if (candidate.key.length !== best.key.length) return candidate.key.length < best.key.length;
  return candidate.key < best.key;
}

export function nearestKnownVersionKey(model, table) {
  const parsed = parseVersioned(model);
  if (!parsed) return null;
  const list = indexOf(table).get(`${parsed.stem}|${parsed.flavor}`);
  if (!list) return null;
  let best = null;
  for (const candidate of list) {
    if (compareVersions(candidate.version, parsed.version) > 0) continue;
    if (isBetter(candidate, best)) best = candidate;
  }
  return best ? best.key : null;
}
