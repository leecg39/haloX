import type { Row } from './database.ts';
export function googlePeriod(rows: Row[], args: Row, previous = false) {
  const start = String(args[previous ? 'p_prev_start_date' : 'p_start_date'] || args[previous ? 'prev_start_date' : 'start_date'] || ''), end = String(args[previous ? 'p_prev_end_date' : 'p_end_date'] || args[previous ? 'prev_end_date' : 'end_date'] || '');
  if (previous && (!start || !end)) return [];
  return rows.filter(row => (!start || String(row.date) >= start) && (!end || String(row.date) <= end));
}
export function aggregateGsc(rows: Row[]) {
  const clicks = rows.reduce((sum, row) => sum + Number(row.clicks || 0), 0), impressions = rows.reduce((sum, row) => sum + Number(row.impressions || 0), 0);
  return { clicks, impressions, ctr: impressions ? clicks / impressions * 100 : null, avg_position: impressions ? rows.reduce((sum, row) => sum + Number(row.avg_position || 0) * Number(row.impressions || 0), 0) / impressions : null, measured_rows: rows.length };
}
export function groupGa4(rows: Row[], field: string) {
  const grouped = new Map<string, Row>();
  for (const row of rows) {
    const key = String(row[field]), value = grouped.get(key) || { [field]: key, organic_sessions: 0, ai_sessions: 0, sessions: 0, conversions: 0 };
    for (const name of ['organic_sessions', 'ai_sessions', 'sessions', 'conversions']) value[name] = Number(value[name]) + Number(row[name] || 0);
    grouped.set(key, value);
  }
  return [...grouped.values()].sort((a, b) => String(a[field]).localeCompare(String(b[field])));
}
