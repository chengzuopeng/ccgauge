export function splitModelRoute(raw) {
  const i = raw.lastIndexOf('--');
  if (i <= 0 || i + 2 >= raw.length) return { model: raw, route: '' };
  return { model: raw.slice(i + 2), route: raw.slice(0, i) };
}

export function joinModelRoute(model, route) {
  return route ? `${route}--${model}` : model;
}

export function matchesModel(models, model, route) {
  return models.has(model) || (!!route && models.has(joinModelRoute(model, route)));
}
