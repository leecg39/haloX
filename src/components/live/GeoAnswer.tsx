import type { ReactNode } from 'react';

/** Keep provider text intact while rendering the supplied citation ranges as links. */
export function GeoAnswer({ text, annotations }: { text: string; annotations: unknown }) {
  const links = (Array.isArray(annotations) ? annotations : []).filter((value): value is { start: number; end: number; url: string; title: string } => {
    if (!value || typeof value !== 'object') return false;
    return Number.isInteger(value.start) && Number.isInteger(value.end) && value.start >= 0 && value.end > value.start && value.end <= text.length && typeof value.url === 'string' && /^https?:\/\//i.test(value.url);
  }).sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = []; let cursor = 0;
  for (const link of links) {
    if (link.start < cursor) continue;
    parts.push(text.slice(cursor, link.start));
    parts.push(<a key={`${link.start}:${link.url}`} href={link.url} title={link.title} target="_blank" rel="noopener noreferrer">{text.slice(link.start, link.end)}</a>);
    cursor = link.end;
  }
  parts.push(text.slice(cursor));
  return <pre className="live-answer">{parts}</pre>;
}
