const MODEL_LIKE = /^(?:gpt|claude|codex)-|^o\d/i;

export function splitModelRoute(raw) {
  const i = raw.lastIndexOf('--');
  if (i <= 0 || i + 2 >= raw.length) return { model: raw, route: '' };
  const route = raw.slice(0, i);
  const model = raw.slice(i + 2);
  if (MODEL_LIKE.test(route) && !MODEL_LIKE.test(model)) return { model: raw, route: '' };
  return { model, route };
}

export function joinModelRoute(model, route) {
  return route ? `${route}--${model}` : model;
}

export function matchesModel(models, model, route) {
  return models.has(model) || (!!route && models.has(joinModelRoute(model, route)));
}
