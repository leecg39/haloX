import faqCategories from '@/data/public-faq-categories.json';

type Locale = 'ko' | 'en';
type Selection = { route: string; category: string; pending: boolean; page: number };
type Choice = { button: HTMLButtonElement; value: string; activeClass: string; inactiveClass: string };
const selections = new WeakMap<HTMLElement, Selection>();
const text = (element: Element | null | undefined) => (element?.textContent || '').replace(/\s+/g, ' ').trim();
const normalized = (value: string) => value.trim().toLocaleLowerCase();
const noCleanup = () => {};

function selection(root: HTMLElement, route: string, all: string) {
  const previous = selections.get(root);
  if (previous?.route === route) return previous;
  const current = { route, category: all, pending: false, page: 1 };
  selections.set(root, current);
  return current;
}

function choices(container: Element, values: string[]): Choice[] {
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')];
  const label = (button: HTMLButtonElement) => text(button.firstElementChild) || text(button);
  const entries = buttons.map(button => ({ button, value: values.find(value => value === text(button) || value === label(button)) }));
  const active = entries.find(entry => entry.value === values[0])?.button;
  const inactive = entries.find(entry => entry.value && entry.value !== values[0])?.button;
  if (!active || !inactive) return [];
  const activeClass = active.dataset.cloneListClass || active.className;
  const inactiveClass = inactive.dataset.cloneListClass || inactive.className;
  return entries.flatMap(({ button, value }) => {
    if (!value) return [];
    button.dataset.cloneListClass ||= button.className;
    return [{ button, value, activeClass, inactiveClass }];
  });
}

function updateChoices(items: Choice[], selected: string) {
  items.forEach(({ button, value, activeClass, inactiveClass }) => {
    const active = value === selected;
    button.setAttribute('aria-pressed', String(active));
    button.className = active ? activeClass : inactiveClass;
  });
}

function emptyMessage(container: HTMLElement, message: string) {
  const element = document.createElement('p');
  element.dataset.cloneListEmpty = 'true';
  element.className = 'py-12 text-center text-sm text-muted-foreground';
  element.setAttribute('role', 'status');
  element.textContent = message;
  element.hidden = true;
  container.append(element);
  return element;
}

function closeFaq(button: HTMLButtonElement, panel: HTMLElement) {
  button.setAttribute('aria-expanded', 'false');
  button.dataset.state = 'closed';
  button.classList.remove('text-foreground');
  button.classList.add('text-foreground/70');
  const icon = button.lastElementChild as HTMLElement | null;
  icon?.classList.remove('rotate-45');
  icon?.classList.add('rotate-0');
  const number = button.firstElementChild as HTMLElement | null;
  if (number) number.style.color = 'hsl(var(--muted-foreground-subtle))';
  const svg = button.querySelector('svg');
  if (svg) {
    svg.classList.remove('lucide-minus');
    svg.classList.add('lucide-plus');
    const vertical = svg.querySelector<SVGElement>('path[d="M12 5v14"]');
    if (vertical) vertical.style.removeProperty('display');
  }
  panel.classList.remove('grid-rows-[1fr]', 'opacity-100');
  panel.classList.add('grid-rows-[0fr]', 'opacity-0');
  panel.hidden = true;
  panel.style.display = 'none';
  panel.style.gridTemplateRows = '0fr';
  panel.style.opacity = '0';
  panel.dataset.state = 'closed';
}

function initializeFaq(root: HTMLElement, route: string, locale: Locale): () => void {
  const data = faqCategories[locale];
  const main = root.querySelector('main');
  const input = main?.querySelector<HTMLInputElement>('input[type="search"]');
  if (!main || !input) return noCleanup;
  const groups = data.groups;
  const all = groups[0].label;
  const questionCategories = new Map<string, string>();
  groups.slice(1).forEach(group => group.questions.forEach(question => questionCategories.set(question, group.label)));
  const rows = [...main.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].flatMap(button => {
    const number = button.firstElementChild as HTMLElement | null;
    const question = number?.nextElementSibling;
    const category = questionCategories.get(text(question));
    const panel = button.nextElementSibling as HTMLElement | null;
    const item = button.parentElement;
    if (!category || !number || !panel || !item) return [];
    return [{ button, number, panel, item, category, search: normalized(`${text(question)} ${text(panel)}`) }];
  });
  const list = rows[0]?.item.parentElement;
  if (!list || !rows.length) return noCleanup;
  const categoryButtons = choices(main, groups.map(group => group.label)).filter(choice => !choice.button.closest('header'));
  const current = selection(root, route, all);
  if (!groups.some(group => group.label === current.category)) current.category = all;
  const empty = emptyMessage(list, data.empty);
  const update = () => {
    const query = normalized(input.value);
    let count = 0;
    rows.forEach(row => {
      const visible = (current.category === all || row.category === current.category) && row.search.includes(query);
      row.item.hidden = !visible;
      row.item.style.display = visible ? '' : 'none';
      closeFaq(row.button, row.panel);
      if (visible) row.number.textContent = String(++count).padStart(2, '0');
    });
    empty.hidden = count > 0;
    updateChoices(categoryButtons, current.category);
  };
  const onInput = (event: Event) => {
    if (event.target !== input) return;
    event.stopPropagation();
    update();
  };
  const onClick = (event: MouseEvent) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    const choice = categoryButtons.find(item => item.button === button);
    if (!choice) return;
    event.preventDefault(); event.stopPropagation();
    current.category = choice.value;
    update();
  };
  root.addEventListener('input', onInput, true);
  root.addEventListener('click', onClick, true);
  update();
  return () => {
    root.removeEventListener('input', onInput, true);
    root.removeEventListener('click', onClick, true);
    empty.remove();
  };
}

function initializeGlossary(root: HTMLElement, route: string, locale: Locale): () => void {
  const main = root.querySelector('main');
  const input = main?.querySelector<HTMLInputElement>('input[aria-controls="glossary-search-listbox"]');
  if (!main || !input) return noCleanup;
  const all = locale === 'en' ? 'All' : '전체';
  const pendingLabel = locale === 'en' ? 'Pending only' : '번역 준비 중만';
  const rows: {
    id: string;
    title: string;
    descriptionText: string;
    card: HTMLElement;
    anchor: HTMLAnchorElement;
    group: HTMLElement;
    category: string;
    search: string;
    pending: boolean;
  }[] = [];
  const seen = new Set<string>();
  for (const anchor of main.querySelectorAll<HTMLAnchorElement>('a[id]')) {
    if (seen.has(anchor.id)) continue;
    const description = anchor.querySelector('p');
    const heading = anchor.querySelector('div');
    const group = anchor.closest<HTMLElement>('section[id^="letter-"]');
    if (!description || !heading || !group) continue;
    // Captured nested links are split into several anchors by HTML parsing. Select the actual card once.
    const card = anchor.closest<HTMLElement>('div.p-5.border.rounded-xl') || anchor;
    const badge = [...heading.querySelectorAll('span')].find(span => span.classList.contains('rounded-full') && span.classList.contains('border'));
    const category = text(badge);
    const title = [...heading.children].filter(child => child !== badge).map(text).join(' ');
    if (!category || !title) continue;
    const descriptionText = text(description);
    const pending = !!card.querySelector('[data-translation-status="pending"],[data-pending="true"]') || [...heading.querySelectorAll('span')].some(span => /^(번역 준비 중|Translation pending|Pending translation)$/i.test(text(span)));
    rows.push({
      id: anchor.id,
      title,
      descriptionText,
      card,
      anchor,
      group,
      category,
      search: normalized(`${title} ${descriptionText}`),
      pending,
    });
    seen.add(anchor.id);
  }
  const list = rows[0]?.group.parentElement;
  if (!list || !rows.length) return noCleanup;
  const categories = [all, ...new Set(rows.map(row => row.category))];
  const categoryButtons: Choice[] = [];
  const translationButtons: Choice[] = [];
  const containers = new Set<Element>();
  for (const button of main.querySelectorAll<HTMLButtonElement>('button')) {
    const container = button.closest('ul') || button.parentElement;
    if (!container || containers.has(container)) continue;
    containers.add(container);
    const labels = [...container.querySelectorAll('button')].map(button => text(button));
    if (labels.includes(pendingLabel)) translationButtons.push(...choices(container, [all, pendingLabel]));
    else categoryButtons.push(...choices(container, categories));
  }
  const current = selection(root, route, all);
  if (!categories.includes(current.category)) current.category = all;
  const counts = [...main.querySelectorAll<HTMLElement>('p')].filter(p => /^(\d+)\s*(개 용어|terms)$/.test(text(p))).map(p => p.querySelector('span')).filter((span): span is HTMLSpanElement => !!span);
  const groups = [...new Set(rows.map(row => row.group))];
  const indexes = [...main.querySelectorAll<HTMLAnchorElement>('a[href*="#letter-"]')];
  const empty = emptyMessage(list, locale === 'en' ? 'No results found.' : '검색 결과가 없습니다.');

  // Autocomplete listbox (`#glossary-search-listbox`)
  const inputWrapper = input.parentElement || main;
  let listbox = main.querySelector<HTMLUListElement>('#glossary-search-listbox');
  if (!listbox) {
    listbox = document.createElement('ul');
    listbox.id = 'glossary-search-listbox';
    listbox.setAttribute('role', 'listbox');
    listbox.className =
      'absolute left-0 right-0 top-full mt-1 z-50 max-h-64 overflow-y-auto rounded-md border border-border bg-background shadow-lg text-left divide-y divide-border/50';
    listbox.hidden = true;
    inputWrapper.append(listbox);
  }

  let activeOptionIndex = -1;
  let currentMatches: typeof rows = [];

  const renderListbox = (matches: typeof rows, forceOpen?: boolean) => {
    if (!listbox) return;
    currentMatches = matches.slice(0, 8);
    const query = normalized(input.value);
    const shouldShow = (forceOpen ?? query.length > 0) && currentMatches.length > 0 && query.length > 0;

    listbox.replaceChildren();
    if (!shouldShow) {
      listbox.hidden = true;
      activeOptionIndex = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      return;
    }

    if (activeOptionIndex >= currentMatches.length) {
      activeOptionIndex = currentMatches.length - 1;
    }

    currentMatches.forEach((row, idx) => {
      const li = document.createElement('li');
      const optionId = `glossary-option-${idx}`;
      li.id = optionId;
      li.setAttribute('role', 'option');
      const isSelected = idx === activeOptionIndex;
      li.setAttribute('aria-selected', String(isSelected));
      li.dataset.glossaryOptionIndex = String(idx);
      li.className = `px-3.5 py-2.5 cursor-pointer text-xs transition-colors flex items-center justify-between gap-2 ${
        isSelected ? 'bg-signal/10 text-foreground font-semibold' : 'hover:bg-muted/60 text-foreground'
      }`;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'truncate font-medium';
      titleSpan.textContent = row.title;

      const badgeSpan = document.createElement('span');
      badgeSpan.className = 'shrink-0 px-2 py-0.5 rounded-full border border-border text-[10px] text-muted-foreground';
      badgeSpan.textContent = row.category;

      li.append(titleSpan, badgeSpan);
      listbox!.append(li);
    });

    listbox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (activeOptionIndex >= 0) {
      input.setAttribute('aria-activedescendant', `glossary-option-${activeOptionIndex}`);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const update = (openListbox = false) => {
    const query = normalized(input.value);
    const visibleRows = rows.filter(row => row.search.includes(query) && (current.category === all || row.category === current.category) && (!current.pending || row.pending));
    const visibleCards = new Set(visibleRows.map(row => row.card));
    rows.forEach(row => { const visible = visibleCards.has(row.card); row.card.hidden = !visible; row.card.style.display = visible ? '' : 'none'; });
    const visibleGroups = new Set(visibleRows.map(row => row.group));
    groups.forEach(group => { const visible = visibleGroups.has(group); group.hidden = !visible; group.style.display = visible ? '' : 'none'; });
    indexes.forEach(index => {
      const hash = index.getAttribute('href')?.split('#')[1] || '';
      let id = hash;
      try { id = decodeURIComponent(hash); } catch { /* Retain malformed source fragments as unmatched. */ }
      index.hidden = !groups.some(group => group.id === id && visibleGroups.has(group));
      index.style.display = index.hidden ? 'none' : '';
    });
    counts.forEach(count => { count.textContent = String(visibleRows.length); });
    const translatedRows = rows.filter(row => !current.pending || row.pending);
    categoryButtons.forEach(({ button, value }) => {
      const count = button.querySelector('.tabular-nums');
      if (count) count.textContent = String(translatedRows.filter(row => value === all || row.category === value).length);
    });
    empty.textContent = current.pending && !translatedRows.length
      ? locale === 'en' ? 'All terms are currently translated.' : '현재 모든 용어가 번역되어 있어요.'
      : locale === 'en' ? 'No results found.' : '검색 결과가 없습니다.';
    empty.hidden = visibleRows.length > 0;
    updateChoices(categoryButtons, current.category);
    updateChoices(translationButtons, current.pending ? pendingLabel : all);
    translationButtons.forEach(({ button, value }) => {
      const circle = button.querySelector<HTMLElement>('span.border-2');
      if (!circle) return;
      const active = value === (current.pending ? pendingLabel : all);
      circle.classList.toggle('border-signal', active);
      circle.classList.toggle('border-muted-foreground/30', !active);
      let dot = circle.querySelector<HTMLElement>('span');
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'h-[6px] w-[6px] rounded-full bg-signal';
        circle.append(dot);
      }
      dot.hidden = !active;
      const caption = circle.nextElementSibling;
      caption?.classList.toggle('text-signal', active);
      caption?.classList.toggle('font-semibold', active);
      caption?.classList.toggle('text-muted-foreground', !active);
    });
    renderListbox(visibleRows, openListbox);
  };

  const onInput = (event: Event) => {
    if (event.target !== input) return;
    event.stopPropagation();
    activeOptionIndex = -1;
    update(true);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target !== input) return;
    if (event.key === 'ArrowDown') {
      if (!currentMatches.length) return;
      event.preventDefault();
      event.stopPropagation();
      activeOptionIndex = activeOptionIndex < 0 ? 0 : (activeOptionIndex + 1) % currentMatches.length;
      renderListbox(currentMatches, true);
    } else if (event.key === 'ArrowUp') {
      if (!currentMatches.length) return;
      event.preventDefault();
      event.stopPropagation();
      activeOptionIndex = activeOptionIndex <= 0 ? currentMatches.length - 1 : activeOptionIndex - 1;
      renderListbox(currentMatches, true);
    } else if (event.key === 'Enter') {
      if (activeOptionIndex >= 0 && currentMatches[activeOptionIndex]) {
        event.preventDefault();
        event.stopPropagation();
        const chosen = currentMatches[activeOptionIndex];
        input.value = chosen.title;
        activeOptionIndex = -1;
        update(false);
        chosen.card.scrollIntoView?.({ block: 'nearest' });
      }
    } else if (event.key === 'Escape') {
      if (listbox && !listbox.hidden) {
        event.preventDefault();
        event.stopPropagation();
        activeOptionIndex = -1;
        renderListbox(currentMatches, false);
      }
    }
  };

  const onClick = (event: MouseEvent) => {
    const targetEl = event.target instanceof Element ? event.target : null;
    const optionLi = targetEl?.closest<HTMLLIElement>('li[data-glossary-option-index]');
    if (optionLi && listbox?.contains(optionLi)) {
      event.preventDefault();
      event.stopPropagation();
      const idx = Number(optionLi.dataset.glossaryOptionIndex);
      const chosen = currentMatches[idx];
      if (chosen) {
        input.value = chosen.title;
        activeOptionIndex = -1;
        update(false);
        chosen.card.scrollIntoView?.({ block: 'nearest' });
      }
      return;
    }

    const button = targetEl?.closest('button') ?? null;
    const category = categoryButtons.find(choice => choice.button === button);
    const translation = translationButtons.find(choice => choice.button === button);
    if (!category && !translation) {
      if (listbox && !listbox.hidden && targetEl !== input) {
        renderListbox(currentMatches, false);
      }
      return;
    }
    event.preventDefault(); event.stopPropagation();
    if (category) current.category = category.value;
    if (translation) current.pending = translation.value === pendingLabel;
    activeOptionIndex = -1;
    update(false);
  };

  root.addEventListener('input', onInput, true);
  root.addEventListener('keydown', onKeyDown, true);
  root.addEventListener('click', onClick, true);
  update(false);
  return () => {
    root.removeEventListener('input', onInput, true);
    root.removeEventListener('keydown', onKeyDown, true);
    root.removeEventListener('click', onClick, true);
    empty.remove();
    listbox?.remove();
  };
}

function initializeBlog(root: HTMLElement, route: string, locale: Locale): () => void {
  const main = root.querySelector('main');
  if (!main) return noCleanup;

  const all = locale === 'en' ? 'All' : '전체';
  const buttonBar = [...main.querySelectorAll<HTMLElement>('div.flex.items-center.gap-2')].find(
    div => div.querySelectorAll('button').length >= 3
  );
  if (!buttonBar) return noCleanup;

  const labels = [...buttonBar.querySelectorAll<HTMLButtonElement>('button')]
    .map(b => text(b))
    .filter(Boolean);
  if (!labels.length) return noCleanup;

  const categoryButtons = choices(buttonBar, labels);
  if (!categoryButtons.length) return noCleanup;

  const current = selection(root, route, all);
  if (!labels.includes(current.category)) current.category = all;

  const countContainer = main.querySelector<HTMLElement>('div.mb-5 > span.text-sm.font-bold');
  const emptyBlock = main.querySelector<HTMLElement>('div.text-center.py-20');
  const pageSize = 6;

  const update = () => {
    const cards = [...main.querySelectorAll<HTMLElement>('article, [data-blog-card]')];
    const matchingCards = cards.filter(card => {
      if (current.category === all) return true;
      const cardCat =
        card.dataset.blogCategory ||
        text(card.querySelector('[data-blog-badge], span.rounded-full'));
      return normalized(cardCat) === normalized(current.category);
    });

    const totalPages = Math.max(1, Math.ceil(matchingCards.length / pageSize));
    if (current.page > totalPages) current.page = 1;
    if (current.page < 1) current.page = 1;

    const startIdx = (current.page - 1) * pageSize;
    const pagedCards = new Set(matchingCards.slice(startIdx, startIdx + pageSize));

    cards.forEach(card => {
      const visible = pagedCards.has(card);
      card.hidden = !visible;
      card.style.display = visible ? '' : 'none';
    });

    const pageButtons = [...main.querySelectorAll<HTMLButtonElement>('button[data-blog-page]')];
    pageButtons.forEach(btn => {
      const pageNum = Number(btn.dataset.blogPage || '1');
      const isCurrent = pageNum === current.page;
      btn.setAttribute('aria-current', isCurrent ? 'page' : 'false');
    });

    if (countContainer) {
      countContainer.replaceChildren();
      if (locale === 'en') {
        const prefix = current.category === all ? 'Total ' : `${current.category} `;
        countContainer.append(document.createTextNode(prefix));
        const numSpan = document.createElement('span');
        numSpan.className = 'font-bold text-brand-blue';
        numSpan.textContent = String(matchingCards.length);
        const suffixSpan = document.createElement('span');
        suffixSpan.className = 'font-normal text-muted-foreground';
        suffixSpan.textContent = ' articles';
        countContainer.append(numSpan, suffixSpan);
      } else {
        countContainer.append(document.createTextNode(`${current.category} 아티클 `));
        const numSpan = document.createElement('span');
        numSpan.className = 'font-bold text-brand-blue';
        numSpan.textContent = String(matchingCards.length);
        countContainer.append(numSpan);
      }
    }

    if (emptyBlock) {
      const hasVisible = matchingCards.length > 0;
      emptyBlock.hidden = hasVisible;
      emptyBlock.style.display = hasVisible ? 'none' : '';
    }

    updateChoices(categoryButtons, current.category);
  };

  const onClick = (event: MouseEvent) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button) return;

    const categoryChoice = categoryButtons.find(c => c.button === button);
    if (categoryChoice) {
      event.preventDefault();
      event.stopPropagation();
      current.category = categoryChoice.value;
      current.page = 1;
      update();
      return;
    }

    if (button.dataset.blogPage) {
      event.preventDefault();
      event.stopPropagation();
      const targetPage = Number(button.dataset.blogPage);
      if (Number.isInteger(targetPage) && targetPage >= 1) {
        current.page = targetPage;
        update();
      }
    }
  };

  root.addEventListener('click', onClick, true);
  update();
  return () => {
    root.removeEventListener('click', onClick, true);
  };
}

export function initializePublicLists(root: HTMLElement, route: string): () => void {
  const pathname = route.split(/[?#]/)[0];
  const locale: Locale = pathname.startsWith('/en/') ? 'en' : 'ko';
  if (/^\/(ko|en)\/faq\/?$/.test(pathname)) return initializeFaq(root, pathname, locale);
  if (/^\/(ko|en)\/glossary(?:\/|$)/.test(pathname)) return initializeGlossary(root, pathname, locale);
  if (/^\/(ko|en)\/blog(?:\/|$)/.test(pathname)) return initializeBlog(root, pathname, locale);
  return noCleanup;
}
