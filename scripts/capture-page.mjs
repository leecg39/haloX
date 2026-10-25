import fs from 'node:fs/promises';
import crypto from 'node:crypto';
export const root='/Users/user01/Desktop/haloX';
export function fileKey(route){return crypto.createHash('sha256').update(route).digest('hex').slice(0,16)}
export async function capture(page,route,options={}){
  const viewport = options.viewport || {width:1440,height:1000,deviceScaleFactor:1,mobile:false};
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:viewport.deviceScaleFactor??1,mobile:viewport.mobile??false});
  if(!options.current) await page.goto('https://haloxlabs.ai'+route);
  await page.waitForFunction(()=>document.querySelector('#root')?.textContent.length>60&&!document.querySelector('#root')?.textContent.includes('페이지를 불러오는 중'),undefined,{timeout:20000}).catch(()=>{});
  await page.evaluate(async()=>{await document.fonts.ready;for(let i=0;i<10;i++){const t=document.body.innerText;if(t.length>150&&!/^(로딩 중|Loading)/.test(t))break;await new Promise(r=>setTimeout(r,180))}});
  if(!route.startsWith('/app')) await page.waitForFunction(()=>!!document.querySelector('h1')||document.querySelector('main')?.innerText.length>150,undefined,{timeout:15000}).catch(()=>{});
  if(!route.startsWith('/app')) await page.evaluate(async()=>{const total=document.body.scrollHeight;for(let y=0;y<total;y+=Math.max(700,Math.ceil(total/8))){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,85))}window.scrollTo(0,0);await new Promise(r=>setTimeout(r,250))});
  const data=await page.evaluate(()=>{
    const source=document.body;
    const clone=source.cloneNode(true);
    const originals=[source,...source.querySelectorAll('*')];const copies=[clone,...clone.querySelectorAll('*')];
    const assets=new Set(),controls=[],computed=[];
    const props=['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','backgroundColor','padding','margin','width','height','display','gridTemplateColumns','gap','border','borderRadius','boxShadow','position','zIndex','transition','transform','opacity'];
    for(let i=0;i<originals.length;i++){
      const el=originals[i],copy=copies[i];if(!copy)continue;
      if(/^(SCRIPT|NOSCRIPT|IFRAME)$/.test(copy.tagName)){copy.remove();continue}
      for(const a of [...copy.attributes])if(a.name.startsWith('on'))copy.removeAttribute(a.name);
      if(el.matches('input,textarea,select')){copy.setAttribute('value',el.value||'');if(el.checked)copy.setAttribute('checked','');}
      if(el.tagName==='CANVAS'){try{const img=document.createElement('img');img.src=el.toDataURL();img.setAttribute('data-clone-chart','true');img.alt=el.closest('[role]')?.getAttribute('aria-label')||'분석 차트';img.style.cssText=el.style.cssText;img.width=el.width;img.height=el.height;copy.replaceWith(img)}catch{}}
      if(el.tagName==='IMG'){const src=el.currentSrc||el.src;if(src&&!src.startsWith('data:'))assets.add(src);copy.setAttribute('src',src);copy.removeAttribute('srcset');copy.setAttribute('loading','eager');}
      if(el.tagName==='VIDEO'){if(el.src)assets.add(el.src);if(el.poster)assets.add(el.poster);}
      const cs=getComputedStyle(el);for(const match of cs.backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g))if(!match[1].startsWith('data:'))assets.add(new URL(match[1],location.href).href);
      if(el.matches('button,a,input,textarea,select,[role="tab"],[role="checkbox"],[role="combobox"],[role="switch"]')){
        const id='c'+i;copy.setAttribute('data-clone-id',id);controls.push({id,tag:el.tagName,text:el.textContent.trim(),label:el.getAttribute('aria-label'),role:el.getAttribute('role'),href:el.getAttribute('href'),placeholder:el.getAttribute('placeholder'),state:el.getAttribute('data-state'),controls:el.getAttribute('aria-controls')});
      }
      if(el.matches('header,nav,main,aside,h1,h2,h3,button,[role="tab"],[data-sidebar="sidebar"],input'))computed.push({tag:el.tagName,classes:el.getAttribute('class'),text:el.textContent.trim().slice(0,80),styles:Object.fromEntries(props.map(p=>[p,cs[p]]))});
    }
    clone.querySelectorAll('[data-lovable],.lovable-badge').forEach(e=>e.remove());
    const styles=[...document.styleSheets].map(s=>({href:s.href,css:(()=>{try{return [...s.cssRules].map(r=>r.cssText).join('\n')}catch{return ''}})()}));
    return {url:location.href,title:document.title,html:clone.innerHTML,bodyClass:document.body.className,htmlClass:document.documentElement.className,styles,assets:[...assets],controls,computed,text:source.innerText,capturedAt:new Date().toISOString(),viewport:{width:innerWidth,height:innerHeight}};
  });
  data.route=route;data.html=data.html.replace(/leecg2908@gmail\.com/g,'demo@halox.local');data.text=data.text.replace(/leecg2908@gmail\.com/g,'demo@halox.local');
  data.controls=data.controls.map(c=>({...c,text:c.text?.replace(/leecg2908@gmail\.com/g,'demo@halox.local')}));
  await fs.mkdir(root+'/docs/research/captures',{recursive:true});
  await fs.writeFile(root+'/docs/research/captures/'+fileKey(route)+'.json',JSON.stringify(data));
  if(options.screenshot) await page.screenshot({path:root+'/docs/design-references/haloxlabs.ai/'+options.screenshot+'.png',fullPage:true});
  console.log(JSON.stringify({route,final:data.url,title:data.title,text:data.text.length,html:data.html.length}));return data;
}
