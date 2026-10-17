const MODEL_LIKE = /^(?:gpt|claude|codex)-|^o\d/i;
const VENDOR_NAMESPACES = new Set(['openai', 'anthropic', 'bedrock', 'vertex_ai']);
const DECORATION = /\s*(?:\[[^\]]*\]|\([^)]*\))+\s*$/;

export function stripModelDecoration(raw) {
  return raw.replace(DECORATION, '') || raw;
}

function splitOnSlash(raw) {
  const i = raw.lastIndexOf('/');
  if (i <= 0 || i + 1 >= raw.length) return null;
  const route = raw.slice(0, i);
  const model = stripModelDecoration(raw.slice(i + 1));
  if (VENDOR_NAMESPACES.has(route.toLowerCase())) return { model, route: '' };
  return { model, route };
}

function splitOnDoubleDash(raw) {
  const i = raw.lastIndexOf('--');
  if (i <= 0 || i + 2 >= raw.length) return null;
  const route = raw.slice(0, i);
  const model = stripModelDecoration(raw.slice(i + 2));
  if (MODEL_LIKE.test(route) && !MODEL_LIKE.test(model)) return null;
  return { model, route };
}

export function splitModelRoute(raw) {
  return (
    splitOnSlash(raw) ??
    splitOnDoubleDash(raw) ?? { model: stripModelDecoration(raw), route: '' }
  );
}

export function joinModelRoute(model, route) {
  return route ? `${route}--${model}` : model;
}

export function fullModelId(model, route) {
  return route ? `${route}/${model}` : model;
}

export function routedModelTitle(ids) {
  return ids.some((id) => splitModelRoute(id).route) ? ids.join('\n') : undefined;
}

export function routedModelNames(model, route) {
  return route ? [`${route}--${model}`, `${route}/${model}`] : [model];
}

export function modelRouteIncludes(model, route, needle) {
  return routedModelNames(model, route).some((name) => name.toLowerCase().includes(needle));
}

export function matchesModel(models, model, route) {
  return models.has(model) || (!!route && routedModelNames(model, route).some((name) => models.has(name)));
}
