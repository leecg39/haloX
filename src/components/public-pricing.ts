const BLOCK_SIZE = 100;
const BLOCK_PRICE = 150_000;
const ENGINE_NAMES = new Set(['ChatGPT', 'Gemini', 'Perplexity', 'Claude']);
const SELECTED_CLASSES = ['border-foreground/45', 'text-foreground', 'bg-background'];
const UNSELECTED_CLASSES = ['border-border', 'text-muted-foreground', 'hover:text-foreground', 'hover:border-border'];

const quantity = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

/** The public calculator bills each quantity in started blocks of 100, per engine. */
export function calculatePricingEstimate(keywords: number, prompts: number, engines: number) {
  const keywordBlocks = Math.ceil(quantity(keywords) / BLOCK_SIZE);
  const promptBlocks = Math.ceil(quantity(prompts) / BLOCK_SIZE);
  const keywordCost = keywordBlocks * BLOCK_PRICE;
  const promptCost = promptBlocks * BLOCK_PRICE;
  const subtotal = keywordCost + promptCost;
  return { keywordBlocks, promptBlocks, keywordCost, promptCost, subtotal, total: subtotal * quantity(engines) };
}

/** Restore the captured calculator without replacing its localized markup. */
export function initializePublicPricing(root: HTMLElement): () => void {
  const estimate = root.querySelector<HTMLElement>('#estimate');
  const inputs = [
    estimate?.querySelector<HTMLInputElement>('#est-keywords'),
    estimate?.querySelector<HTMLInputElement>('#est-prompts'),
  ];
  if (!estimate || !inputs[0] || !inputs[1]) return () => {};
  const fields = inputs as [HTMLInputElement, HTMLInputElement];
  const engines = Array.from(estimate.querySelectorAll<HTMLButtonElement>('button')).filter(button =>
    ENGINE_NAMES.has(button.textContent?.trim() || ''),
  );
  const amounts = Array.from(estimate.querySelectorAll<HTMLElement>('.tabular-nums'));
  if (engines.length !== 4 || amounts.length !== 5) return () => {};

  const selected = new Set(engines.filter(button => button.getAttribute('aria-pressed') !== 'false'));
  const format = (value: number) => `₩${value.toLocaleString('en-US')}`;
  const summary = amounts[0].parentElement?.parentElement?.parentElement;
  const emptyMessage = document.createElement('p');
  emptyMessage.className = 'text-sm text-muted-foreground leading-relaxed';
  emptyMessage.setAttribute('role', 'status');
  emptyMessage.textContent = estimate.querySelector('label[for="est-keywords"]')?.textContent?.includes('키워드')
    ? '견적을 확인하려면 엔진을 하나 이상 선택해 주세요.'
    : 'Select at least one engine to see your estimate.';
  emptyMessage.hidden = true;
  summary?.insertAdjacentElement('afterend', emptyMessage);
  const sliders = fields.map(field => {
    const track = field.nextElementSibling as HTMLElement | null;
    const thumb = track?.querySelector<HTMLElement>('[role="slider"]');
    const fill = track?.firstElementChild?.firstElementChild as HTMLElement | null;
    const min = Number(thumb?.getAttribute('aria-valuemin') || 0);
    const max = Number(thumb?.getAttribute('aria-valuemax') || 1000);
    const label = estimate.querySelector<HTMLLabelElement>(`label[for="${field.id}"]`);
    if (thumb) thumb.setAttribute('aria-label', label?.textContent?.trim() || field.id);
    return { field, track, thumb, fill, min, max };
  });

  function render() {
    const result = calculatePricingEstimate(Number(fields[0].value), Number(fields[1].value), selected.size);
    if (summary) summary.hidden = selected.size === 0;
    emptyMessage.hidden = selected.size !== 0;
    const costs = [result.keywordCost, result.promptCost, result.subtotal];
    costs.forEach((cost, index) => { amounts[index].textContent = format(cost); });
    [result.keywordBlocks, result.promptBlocks].forEach((blocks, index) => {
      const breakdown = amounts[index].previousElementSibling?.querySelector<HTMLElement>('.whitespace-nowrap');
      if (breakdown) breakdown.textContent = `(${blocks} × ${format(BLOCK_PRICE)})`;
    });
    amounts[3].textContent = `× ${selected.size}`;
    // Keep the original /월 or /month suffix and its styling.
    const totalText = Array.from(amounts[4].childNodes).find(node => node.nodeType === Node.TEXT_NODE);
    if (totalText) totalText.textContent = format(result.total);
    else amounts[4].prepend(document.createTextNode(format(result.total)));
    for (const button of engines) {
      const pressed = selected.has(button);
      button.setAttribute('aria-pressed', String(pressed));
      SELECTED_CLASSES.forEach(token => button.classList.toggle(token, pressed));
      UNSELECTED_CLASSES.forEach(token => button.classList.toggle(token, !pressed));
    }
    for (const slider of sliders) {
      const value = Math.min(slider.max, Math.max(slider.min, quantity(Number(slider.field.value))));
      const percent = (value - slider.min) / (slider.max - slider.min) * 100;
      slider.thumb?.setAttribute('aria-valuenow', String(value));
      if (slider.thumb?.parentElement) slider.thumb.parentElement.style.left = `calc(${percent}% + ${10 - percent / 5}px)`;
      if (slider.fill) slider.fill.style.right = `${100 - percent}%`;
    }
  }

  function input(event: Event) {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || !fields.includes(field)) return;
    const value = Number(field.value);
    const max = Number(field.max);
    field.value = String(Math.min(max || Infinity, quantity(value)));
    render();
  }

  function click(event: MouseEvent) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('button');
    if (button && engines.includes(button)) {
      event.preventDefault();
      event.stopPropagation();
      if (selected.has(button)) selected.delete(button);
      else selected.add(button);
      render();
    } else if (sliders.some(slider => slider.track?.contains(event.target as Node))) {
      event.stopPropagation();
    }
  }

  function setSliderValue(slider: typeof sliders[number], value: number) {
    slider.field.value = String(Math.min(slider.max, Math.max(slider.min, value)));
    render();
  }

  function keydown(event: KeyboardEvent) {
    const slider = sliders.find(item => item.thumb === event.target);
    if (!slider) return;
    const step = event.shiftKey ? 100 : 10;
    const value = Math.min(slider.max, quantity(Number(slider.field.value)));
    const next = ({
      ArrowRight: value + step,
      ArrowUp: value + step,
      ArrowLeft: value - step,
      ArrowDown: value - step,
      PageUp: value + 100,
      PageDown: value - 100,
      Home: slider.min,
      End: slider.max,
    } as Record<string, number>)[event.key];
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    setSliderValue(slider, next);
  }

  let active: { slider: typeof sliders[number]; pointerId: number } | null = null;
  function movePointer(event: PointerEvent) {
    if (!active || event.pointerId !== active.pointerId || !active.slider.track) return;
    const bounds = active.slider.track.getBoundingClientRect();
    if (!bounds.width) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    setSliderValue(active.slider, Math.round((active.slider.min + ratio * (active.slider.max - active.slider.min)) / 10) * 10);
  }
  function pointerdown(event: PointerEvent) {
    if (event.button !== 0 || !(event.target instanceof Node)) return;
    const slider = sliders.find(item => item.track?.contains(event.target as Node));
    if (!slider?.track) return;
    event.preventDefault();
    active = { slider, pointerId: event.pointerId };
    slider.track.setPointerCapture?.(event.pointerId);
    slider.thumb?.focus();
    movePointer(event);
  }
  function pointerup(event: PointerEvent) {
    if (active?.pointerId !== event.pointerId) return;
    if (active.slider.track?.hasPointerCapture?.(event.pointerId)) active.slider.track.releasePointerCapture(event.pointerId);
    active = null;
  }

  render();
  estimate.addEventListener('input', input);
  estimate.addEventListener('change', input);
  estimate.addEventListener('click', click);
  estimate.addEventListener('keydown', keydown);
  estimate.addEventListener('pointerdown', pointerdown);
  estimate.addEventListener('pointermove', movePointer);
  estimate.addEventListener('pointerup', pointerup);
  estimate.addEventListener('pointercancel', pointerup);
  return () => {
    if (active?.slider.track?.hasPointerCapture?.(active.pointerId)) active.slider.track.releasePointerCapture(active.pointerId);
    active = null;
    emptyMessage.remove();
    if (summary) summary.hidden = false;
    estimate.removeEventListener('input', input);
    estimate.removeEventListener('change', input);
    estimate.removeEventListener('click', click);
    estimate.removeEventListener('keydown', keydown);
    estimate.removeEventListener('pointerdown', pointerdown);
    estimate.removeEventListener('pointermove', movePointer);
    estimate.removeEventListener('pointerup', pointerup);
    estimate.removeEventListener('pointercancel', pointerup);
  };
}
