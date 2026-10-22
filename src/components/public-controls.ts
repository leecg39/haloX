import type { PublicInteractions } from '@/types/clone';

const normalize = (text: string) => text.replace(/\s+/g, '').trim();
const buttonLabel = (button: HTMLButtonElement) => normalize(button.querySelector('h3')?.textContent || button.textContent || '');

function accordionPanel(button: HTMLButtonElement): HTMLElement | null {
  const panel = button.nextElementSibling;
  return panel instanceof HTMLElement && panel.tagName === 'DIV' &&
    (panel.className.includes('grid-rows-') || panel.dataset.cloneAccordion !== undefined) ? panel : null;
}

function setAccordion(button: HTMLButtonElement, panel: HTMLElement, open: boolean) {
  button.setAttribute('aria-expanded', String(open));
  button.dataset.state = open ? 'open' : 'closed';
  button.classList.toggle('text-foreground', open);
  button.classList.toggle('text-foreground/70', !open);
  panel.dataset.cloneAccordion = '';
  panel.hidden = !open;
  panel.style.display = open ? 'grid' : 'none';
  panel.style.gridTemplateRows = open ? '1fr' : '0fr';
  panel.style.opacity = open ? '1' : '0';
  const number = button.firstElementChild as HTMLElement | null;
  if (number) number.style.color = open ? 'hsl(var(--signal))' : 'hsl(var(--muted-foreground-subtle))';
  const icon = button.querySelector('svg');
  if (icon) {
    icon.classList.toggle('lucide-minus', open);
    icon.classList.toggle('lucide-plus', !open);
    const vertical = icon.querySelector<SVGElement>('path[d="M12 5v14"]');
    if (vertical) vertical.style.display = open ? 'none' : '';
  }
}

export function initializePublicControls(root: HTMLElement): () => void {
  if (!root.classList.contains('clone-public')) return () => {};
  root.querySelectorAll<HTMLButtonElement>('main button[aria-expanded], section button[aria-expanded]').forEach((button, index) => {
    const panel = accordionPanel(button);
    if (!panel) return;
    if (!panel.id) panel.id = `clone-faq-panel-${index}`;
    button.setAttribute('aria-controls', panel.id);
    setAccordion(button, panel, button.getAttribute('aria-expanded') === 'true');
  });
  return () => {};
}

export function handlePublicClick(event: MouseEvent, root: HTMLElement, data?: PublicInteractions): boolean {
  if (!root.classList.contains('clone-public') || !(event.target instanceof Element)) return false;
  const button = event.target.closest<HTMLButtonElement>('button');
  if (!button || button.closest('header')) return false;
  const label = buttonLabel(button);
  const faq = data?.accordions.find(item => normalize(item.label) === label);
  let panel = accordionPanel(button);
  if (faq || (button.hasAttribute('aria-expanded') && panel)) {
    event.preventDefault();
    const open = button.getAttribute('aria-expanded') !== 'true';
    if (!panel) {
      panel = document.createElement('div');
      panel.dataset.cloneAccordion = '';
      button.insertAdjacentElement('afterend', panel);
    }
    if (faq && !panel.textContent?.trim()) panel.innerHTML = faq.panelHtml;
    const section = button.closest('section') || root;
    section.querySelectorAll<HTMLButtonElement>('button[aria-expanded="true"]').forEach(other => {
      const otherPanel = accordionPanel(other);
      if (other !== button && otherPanel) setAccordion(other, otherPanel, false);
    });
    setAccordion(button, panel, open);
    return true;
  }

  const choices = data?.tabs.filter(item => normalize(item.label) === label ||
    (label.startsWith(normalize(item.label)) && item.label.length > 2)) || [];
  const tab = choices.find(item => item.group?.includes(innerWidth < 768 ? 'mobile' : 'desktop')) || choices[0];
  if (!tab) return false;
  let tabPanel: HTMLElement | null = null;
  if (tab.panelTag === 'SECTION') tabPanel = button.closest('section');
  else {
    const id = button.getAttribute('aria-controls');
    if (id) tabPanel = root.querySelector('#' + CSS.escape(id));
    if (!tabPanel) tabPanel = button.closest('[role=tablist]')?.parentElement?.querySelector('[role=tabpanel]') || null;
  }
  if (!tabPanel) return false;
  event.preventDefault();
  const restoreFocus = document.activeElement === button;
  tabPanel.innerHTML = tab.panelHtml;
  tabPanel.hidden = false;
  tabPanel.removeAttribute('inert');
  tabPanel.style.removeProperty('display');
  const replacement = [...tabPanel.querySelectorAll<HTMLButtonElement>('button')].find(item => buttonLabel(item) === label && item.getClientRects().length);
  const active = replacement || button;
  active.setAttribute('aria-pressed', 'true');
  if (active.getAttribute('role') === 'tab') {
    active.closest('[role=tablist]')?.querySelectorAll('[role=tab]').forEach(item => {
      item.setAttribute('aria-selected', String(item === active));
      item.setAttribute('data-state', item === active ? 'active' : 'inactive');
    });
  }
  if (restoreFocus && replacement) replacement.focus({ preventScroll: true });
  return true;
}
