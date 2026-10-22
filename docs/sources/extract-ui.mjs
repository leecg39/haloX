export async function extract(page) {
  return await page.evaluate(() => {
    const redact = s => (s || '').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[계정 이메일]');
    const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const scope = document.querySelector('[role="dialog"]') || document.querySelector('main') || document.body;
    const all = selector => [...scope.querySelectorAll(selector)].filter(visible);
    return {
      url: location.href, title: document.title,
      headings: all('h1,h2,h3,h4,h5').map(e => redact(e.innerText)),
      tabs: all('[role="tab"]').map(e => ({label:e.innerText,selected:e.getAttribute('aria-selected')})),
      buttons: all('button,[role="menuitem"]').map(e => ({label:redact(e.innerText || e.getAttribute('aria-label')),disabled:e.disabled || e.getAttribute('aria-disabled') === 'true'})).filter(e=>e.label),
      labels: all('label').map(e=>e.innerText),
      columns: all('thead th,[role="columnheader"]').map(e=>e.innerText),
      inputs: all('input,textarea,select,[role="combobox"]').map(e=>({tag:e.tagName,type:e.type,placeholder:e.placeholder,label:e.getAttribute('aria-label')})),
      links: [...document.querySelectorAll('a[href]')].filter(visible).map(e=>({label:redact(e.innerText),href:e.href})),
      text: redact(scope.innerText)
    };
  });
}
