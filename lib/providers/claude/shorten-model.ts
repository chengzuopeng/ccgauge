function capitalize(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function shortenClaudeModel(model: string): string {
  if (!model) return '(unknown)';
  let m = model
    .replace(/-(\d{8})$/, '')
    .replace(/^(vertex_ai|bedrock|anthropic)\//, '');
  m = m.replace(/^claude-/, '');
  const parts = m.split('-');
  if (parts.length >= 2) {
    const family = parts[0];
    const version = parts.slice(1).join('.');
    return capitalize(family) + ' ' + version;
  }
  return capitalize(m.replace(/-/g, ' '));
}
