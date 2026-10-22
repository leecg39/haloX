import type { PublicInteractions } from '@/types/clone';
const normalize=(text:string)=>text.replace(/\s+/g,'').trim();
export function handlePublicClick(event:MouseEvent,root:HTMLElement,data?:PublicInteractions):boolean{
 if(!data||!(event.target instanceof Element))return false;
 const button=event.target.closest<HTMLButtonElement>('button');if(!button||button.closest('header'))return false;
 const label=normalize(button.querySelector('h3')?.textContent||button.textContent||'');
 const faq=data.accordions.find(x=>normalize(x.label)===label);
 if(faq){event.preventDefault();const open=button.getAttribute('aria-expanded')!=='true';let panel=button.nextElementSibling as HTMLElement|null;if(!panel||panel.tagName==='BUTTON'){panel=document.createElement('div');button.insertAdjacentElement('afterend',panel)}if(open)panel.innerHTML=faq.panelHtml;panel.hidden=!open;panel.style.display=open?'block':'none';button.setAttribute('aria-expanded',String(open));button.dataset.state=open?'open':'closed';return true}
 const choices=data.tabs.filter(x=>normalize(x.label)===label||label.startsWith(normalize(x.label))&&x.label.length>2);
 const tab=choices.find(x=>x.group?.includes(innerWidth<768?'mobile':'desktop'))||choices[0];
 if(tab){event.preventDefault();let panel:HTMLElement|null=null;
 if(tab.panelTag==='SECTION')panel=button.closest('section');else{const id=button.getAttribute('aria-controls');if(id)panel=root.querySelector('#'+CSS.escape(id));if(!panel)panel=button.closest('[role=tablist]')?.parentElement?.querySelector('[role=tabpanel]')||null;}
 if(panel){panel.innerHTML=tab.panelHtml;panel.hidden=false;panel.removeAttribute('inert');panel.style.removeProperty('display');button.setAttribute('aria-selected','true');button.setAttribute('aria-pressed','true');return true}
 }
 return false;
}
