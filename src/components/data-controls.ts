import type { DialogResult, LocalRecord } from '@/types/clone';

type State = { rows: HTMLTableRowElement[]; searches: Map<Element, string>; filters: Map<Element, { index: number; value: string }>; page: number; size: number; pager?: HTMLElement };
const states = new WeakMap<HTMLTableElement, State>();
const menus = new WeakMap<HTMLElement, () => void>();
const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
const base = (route: string) => route.split(/[?#]/)[0].replace(/\/$/, '') || '/';
const text = (node?: Element | null) => clean(node?.textContent);
function tableFor(element: Element, root: HTMLElement): HTMLTableElement | null {
  for (let parent: Element | null = element; parent && root.contains(parent); parent = parent.parentElement) {
    if (parent instanceof HTMLTableElement) return parent;
    const tables = parent.querySelectorAll<HTMLTableElement>('table');
    if (tables.length === 1) return tables[0];
    if (tables.length > 1) return [...tables].find(table => !table.closest('[hidden]')) || tables[0];
  }
  return null;
}
function state(table: HTMLTableElement): State {
  let current = states.get(table);
  if (!current) { const rows = [...table.tBodies].flatMap(body => [...body.rows]).filter(row => row.cells.length > 1 || row.cells[0]?.colSpan === 1); current = { rows, searches: new Map(), filters: new Map(), page: 0, size: rows.length || 10 }; states.set(table, current); }
  return current;
}
function matching(table: HTMLTableElement) {
  const current = state(table);
  return current.rows.filter(row => [...current.searches.values()].every(query => text(row).toLocaleLowerCase().includes(query)) && [...current.filters.values()].every(filter => text(filter.index < 0 ? row : row.cells[filter.index]).includes(filter.value)));
}
function render(table: HTMLTableElement) {
  const current = state(table), matches = matching(table), body = table.tBodies[0] || table.createTBody();
  current.page = Math.min(current.page, Math.max(0, Math.ceil(matches.length / current.size) - 1));
  [...body.rows].filter(row => !current.rows.includes(row)).forEach(row => row.remove());
  const shown = new Set(matches.slice(current.page * current.size, (current.page + 1) * current.size));
  current.rows.forEach(row => { row.hidden = !shown.has(row); body.append(row); });
  if (matches.length > current.size && !current.pager) {
    const pager = document.createElement('nav'); pager.setAttribute('aria-label', '수집된 데이터 페이지'); pager.className = 'flex items-center justify-end gap-3 py-3 text-xs'; pager.dataset.clonePagination = 'true';
    [-1, 1].forEach(direction => { const button = document.createElement('button'); button.type = 'button'; button.className = 'rounded-md border px-3 py-1 disabled:opacity-40'; button.textContent = direction < 0 ? '이전' : '다음'; button.addEventListener('click', event => { event.stopPropagation(); current.page += direction; render(table); }); pager.append(button); });
    const count = document.createElement('span'); count.setAttribute('aria-live', 'polite'); pager.insertBefore(count, pager.lastChild); table.parentElement?.insertAdjacentElement('afterend', pager); current.pager = pager;
  }
  if (current.pager) { const buttons = current.pager.querySelectorAll('button'); current.pager.hidden = matches.length <= current.size; buttons[0].disabled = current.page === 0; buttons[1].disabled = (current.page + 1) * current.size >= matches.length; current.pager.querySelector('span')!.textContent = `${current.page + 1} / ${Math.max(1, Math.ceil(matches.length / current.size))} · 총 ${matches.length}개`; }
  if (!matches.length) { const row = body.insertRow(); row.dataset.cloneEmpty = 'true'; const cell = row.insertCell(); cell.colSpan = Math.max(table.tHead?.rows[0]?.cells.length || 1, 1); cell.textContent = '검색 조건에 맞는 항목이 없습니다.'; cell.style.cssText = 'padding:32px;text-align:center;color:rgb(110,110,110)'; }
}
function check(control: HTMLElement, checked: boolean) {
  if (control instanceof HTMLInputElement) control.checked = checked;
  control.setAttribute('aria-checked', String(checked)); control.dataset.state = checked ? 'checked' : 'unchecked';
  control.querySelectorAll<HTMLElement>('[data-state]').forEach(child => child.dataset.state = control.dataset.state!);
  if (control.getAttribute('role') === 'checkbox' && !control.querySelector('svg, [data-clone-check]')) { const mark = document.createElement('span'); mark.dataset.cloneCheck = 'true'; mark.textContent = '✓'; mark.style.cssText = 'display:block;font-size:12px;line-height:14px'; control.append(mark); }
  const mark = control.querySelector<HTMLElement>('[data-clone-check]'); if (mark) mark.hidden = !checked;
  const row = control.closest('tbody tr'); if (row) row.setAttribute('data-state', checked ? 'selected' : '');
}
function exportCsv(table: HTMLTableElement) {
  const escape = (value: string) => { const safe = /^[\s]*[=+@\-\t\r]/.test(value) ? `'${value}` : value; return `"${safe.replace(/"/g, '""')}"`; };
  const rows = [...(table.tHead?.rows || []), ...state(table).rows.filter(row => !row.hidden)];
  const csv = rows.map(row => [...row.cells].map(cell => escape(text(cell))).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = 'halox-data.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function dropdown(button: HTMLElement, table: HTMLTableElement, root: HTMLElement): boolean {
  const label = button.dataset.cloneFilterLabel || text(button), headers = [...(table.tHead?.rows[0]?.cells || [])];
  const aliases: Record<string, string> = { 인텐트: '의도', 진행상태: '진행', 세트: '키워드', 정렬: '키워드' };
  const needle = label.replace(/전체|모든|필터|\s/g, '');
  const index = headers.findIndex(header => { const title = text(header).replace(/\s/g, ''); return !!title && (title.includes(aliases[needle] || needle) || needle.includes(title)); });
  const select = button.parentElement?.querySelector<HTMLSelectElement>('select');
  if (index < 0 && !select) return false;
  const candidates = select ? [...select.options].map(option => option.text) : state(table).rows.map(row => text(row.cells[index]));
  const values = [...new Set(candidates.filter(value => value && !/^(태그|[-—]|추가|전체)$/.test(value)))].slice(0, 50);
  if (!values.length) return false;
  menus.get(root)?.(); button.dataset.cloneFilterLabel = label;
  const menu = document.createElement('div'); menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', `${label} 필터`); menu.dataset.cloneFilterMenu = 'true';
  const rect = button.getBoundingClientRect(); menu.style.cssText = `position:fixed;z-index:1000;left:${Math.max(8, Math.min(rect.left, innerWidth - 288))}px;top:${Math.min(rect.bottom + 4, innerHeight - 180)}px;max-height:300px;max-width:280px;min-width:160px;overflow:auto;padding:4px;background:white;color:#171717;border:1px solid #e6e6e6;border-radius:6px;box-shadow:0 6px 24px #0002;font-size:12.125px`;
  const close = () => { menu.remove(); button.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside); menus.delete(root); };
  const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.contains(event.target) && !button.contains(event.target)) close(); };
  ['', ...values].forEach(value => { const option = document.createElement('button'); option.type = 'button'; option.textContent = value || '전체 보기'; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String((state(table).filters.get(button)?.value || '') === value)); option.style.cssText = 'display:block;width:100%;padding:8px;text-align:left;border-radius:4px';
    option.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); const current = state(table); if (value) current.filters.set(button, { index, value }); else current.filters.delete(button); current.page = 0; button.title = value ? `${label}: ${value}` : label; const caption = button.querySelector('span:not([aria-hidden])'); if (caption) caption.textContent = value || label; if (select) select.value = [...select.options].find(option => option.text === value)?.value || ''; render(table); close(); button.focus(); }); menu.append(option); });
  menu.addEventListener('keydown', event => { const options = [...menu.querySelectorAll('button')], at = options.indexOf(document.activeElement as HTMLButtonElement); if (event.key === 'Escape') { close(); button.focus(); } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus(); } });
  root.append(menu); button.setAttribute('aria-expanded', 'true'); menus.set(root, close); document.addEventListener('pointerdown', outside); menu.querySelector('button')?.focus(); return true;
}
export function handleDataInput(event: Event, root: HTMLElement): boolean {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !root.contains(input) || !/검색|search|찾기/i.test(`${input.placeholder} ${input.getAttribute('aria-label') || ''}`)) return false;
  const table = tableFor(input, root); if (!table) return false;
  const current = state(table); current.searches.set(input, input.value.trim().toLocaleLowerCase()); current.page = 0; render(table); return true;
}
export function handleDataClick(event: MouseEvent, root: HTMLElement, notify: (message: string) => void): boolean {
  if (!(event.target instanceof Element)) return false;
  const control = event.target.closest<HTMLElement>('button,input,th,[role="checkbox"],[role="switch"]');
  if (!control || !root.contains(control) || control.closest('[data-clone-filter-menu]')) return false;
  if (control.matches(':disabled,[aria-disabled="true"]')) return true;
  const role = control.getAttribute('role'), table = tableFor(control, root), label = `${text(control)} ${control.getAttribute('aria-label') || ''}`.trim();
  if (role === 'checkbox' || role === 'switch' || control.matches('input[type="checkbox"]')) {
    const native = control instanceof HTMLInputElement; if (!native) event.preventDefault();
    const checked = native ? control.checked : control.getAttribute('aria-checked') !== 'true'; check(control, checked);
    if (table && control.closest('thead')) table.querySelectorAll<HTMLElement>('tbody [role="checkbox"],tbody input[type="checkbox"]').forEach(item => { if (!item.closest('tr')?.hidden && !item.matches(':disabled,[aria-disabled="true"]')) check(item, checked); });
    return true;
  }
  const header = control.closest<HTMLTableCellElement>('th');
  if (table && header && !header.querySelector('[role="checkbox"]') && (header.classList.contains('cursor-pointer') || header.querySelector('button,.lucide-chevrons-up-down,.lucide-arrow-up-down'))) {
    event.preventDefault(); const direction = header.getAttribute('aria-sort') === 'ascending' ? -1 : 1, index = header.cellIndex;
    const value = (row: HTMLTableRowElement) => { const raw = text(row.cells[index]); const number = Number(raw.replace(/[,<>%\s]/g, '')); return raw && Number.isFinite(number) ? number : raw; };
    state(table).rows.sort((a, b) => { const av = value(a), bv = value(b); return direction * (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ko', { numeric: true })); });
    table.querySelectorAll('th[aria-sort]').forEach(th => th.removeAttribute('aria-sort')); header.setAttribute('aria-sort', direction === 1 ? 'ascending' : 'descending'); render(table); return true;
  }
  if (!table) return false;
  if (/csv|내보내기|export/i.test(label)) { event.preventDefault(); exportCsv(table); notify('현재 표시된 행을 CSV로 저장했습니다.'); return true; }
  if (role === 'combobox' || /필터/.test(label)) { if (dropdown(control, table, root)) { event.preventDefault(); return true; } }
  const next = /^(다음|next)(\s|$)/i.test(label) || !!control.querySelector('.lucide-chevron-right,.lucide-chevrons-right');
  const previous = /^(이전|previous)(\s|$)/i.test(label) || !!control.querySelector('.lucide-chevron-left,.lucide-chevrons-left');
  if ((next || previous) && !control.closest('td') && !control.closest('header')) {
    event.preventDefault(); const current = state(table), target = current.page + (next ? 1 : -1);
    if (target >= 0 && target * current.size < matching(table).length) { current.page = target; render(table); notify(`${target + 1}페이지를 표시했습니다.`); }
    else notify(next ? '현재 수집된 데이터의 마지막 페이지입니다. 추가한 로컬 항목은 다음 페이지에 표시됩니다.' : '현재 첫 페이지입니다.'); return true;
  }
  return false;
}
function insertRecord(root: HTMLElement, record: LocalRecord) {
  if ([...root.querySelectorAll<HTMLElement>('[data-clone-record]')].some(element => element.dataset.cloneRecord === record.id)) return;
  const table = root.querySelector<HTMLTableElement>('main table,[role="main"] table') || root.querySelector<HTMLTableElement>('table');
  if (table) {
    const current = state(table), template = current.rows.find(row => row.cells.length > 1), row = document.createElement('tr'); row.className = template?.className || 'border-b'; row.dataset.cloneRecord = record.id;
    const count = table.tHead?.rows[0]?.cells.length || template?.cells.length || 2;
    const nameIndex = template?.cells[0]?.querySelector('[role="checkbox"],input[type="checkbox"]') ? 1 : 0;
    for (let i = 0; i < count; i++) { const cell = row.insertCell(); cell.className = template?.cells[i]?.className || 'px-3 py-4 text-sm'; const header = text(table.tHead?.rows[0]?.cells[i]); const key = Object.keys(record).find(key => key !== 'id' && key !== 'kind' && key !== 'createdAt' && header && header.includes(key)); cell.textContent = i === nameIndex ? record.name : key ? record[key] : '—'; }
    row.cells[nameIndex].title = '이 브라우저에 저장된 로컬 항목'; current.rows.unshift(row); current.page = 0; render(table);
  } else {
    const main = root.querySelector('main,[role="main"]') || root; let list = main.querySelector<HTMLElement>('[data-clone-records]');
    if (!list) { list = document.createElement('section'); list.dataset.cloneRecords = 'true'; list.setAttribute('aria-label', '추가한 로컬 항목'); list.className = 'grid gap-3 p-4'; main.append(list); }
    const card = document.createElement('article'); card.dataset.cloneRecord = record.id; card.className = 'rounded-lg border bg-card p-4 text-sm'; const title = document.createElement('h3'); title.className = 'font-semibold'; title.textContent = record.name; const note = document.createElement('p'); note.className = 'mt-2 text-xs text-muted-foreground'; note.textContent = `${record.kind || '항목'} · 로컬 저장`; card.append(title, note); list.prepend(card);
  }
}
export function initializeDataControls(root: HTMLElement, route: string): () => void {
  root.querySelectorAll<HTMLTableElement>('table').forEach(table => { state(table); if (table.parentElement) { table.parentElement.style.overflowX = 'auto'; table.parentElement.style.maxWidth = '100%'; table.parentElement.style.minWidth = '0'; } });
  try { const records: unknown = JSON.parse(localStorage.getItem(`halox-clone:records:${base(route)}`) || '[]'); if (Array.isArray(records)) records.slice().reverse().forEach(record => { if (record && typeof record.id === 'string' && typeof record.name === 'string') insertRecord(root, record); }); } catch { /* A malformed or unavailable browser store does not affect the captured page. */ }
  const created = (event: Event) => {
    const result = (event as CustomEvent<DialogResult>).detail;
    if (!result || base(result.route) !== base(route)) return;
    const records = result.records?.length ? result.records : result.record ? [result.record] : [];
    records.slice().reverse().forEach(record => insertRecord(root, record));
  };
  window.addEventListener('halox:record-created', created);
  return () => { window.removeEventListener('halox:record-created', created); menus.get(root)?.(); };
}
