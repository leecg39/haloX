export function domProfile(html) {
  const counts = {};
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b/gi)) {
    const tag = match[1].toLowerCase();
    counts[tag] = (counts[tag] || 0) + 1;
  }
  return counts;
}

export function weightedJaccard(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  let intersection = 0;
  let union = 0;
  for (const key of keys) {
    intersection += Math.min(left[key] || 0, right[key] || 0);
    union += Math.max(left[key] || 0, right[key] || 0);
  }
  return union === 0 ? 1 : intersection / union;
}
