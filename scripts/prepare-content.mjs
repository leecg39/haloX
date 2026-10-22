import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
const key=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,16);
const out='public/clone/pages';await fs.mkdir(out,{recursive:true});
const assets=JSON.parse(await fs.readFile('docs/research/assets.json','utf8'));
const tabs=JSON.parse(await fs.readFile('docs/research/app-tab-map.json','utf8'));
const settings=['','workspace','members','plan','billing','integrations','brand-tracking','tags','earned','export','notifications','api'];
const settingsLabels=['일반','워크스페이스','멤버','사용량','구독/결제','연동','브랜드 트래킹','태그','등록 URL','내보내기','알림','API & MCP'];
const publicInteractions=JSON.parse(await fs.readFile('docs/research/public-interactions.json','utf8'));
const all=[];const css=new Set();const chartWrites=[];
for(const f of await fs.readdir('docs/research/captures')){if(!f.endsWith('.json'))continue;try{all.push(JSON.parse(await fs.readFile('docs/research/captures/'+f,'utf8')))}catch{}}
for(const name of ['login','signup','forgot-password']){
 const data=JSON.parse(await fs.readFile('docs/research/auth-'+name+'.json','utf8')); const $=cheerio.load(data.html); const route='/app/'+name;
 const d={route,url:'https://haloxlabs.ai'+route,title:$('h1').first().text()+' | HaloX',html:$('body').html(),bodyClass:$('body').attr('class')||'',htmlClass:'',styles:[],controls:[],text:$('body').text()};
 const old=all.findIndex(c=>c.route===route); if(old>=0)all[old]=d;else all.push(d);
}
const manifest=[];
const norm=s=>s.replace(/\s+/g,'').replace(/\(\d+\)/g,'');
function urlLocal(value){try{const u=new URL(value,'https://haloxlabs.ai');if(u.hostname==='haloxlabs.ai'||u.hostname==='www.haloxlabs.ai')return u.pathname+u.search+u.hash;return value}catch{return value}}
function assetLocal(value){if(!value)return value;try{const u=new URL(value,'https://haloxlabs.ai');return assets[u.href]||(u.hostname==='www.google.com'&&u.pathname==='/s2/favicons'?'/clone/assets/domain-placeholder.svg':value)}catch{return value}}
function cleanFragment(html){const $=cheerio.load(html||'',{},false);$('script,iframe,noscript').remove();$('[src]').each((_,el)=>$(el).attr('src',assetLocal($(el).attr('src'))));$('a[href]').each((_,el)=>$(el).attr('href',urlLocal($(el).attr('href'))));$('[class]').each((_,el)=>{const e=$(el),c=e.attr('class');if(c.includes('opacity-0')&&/translate-y-|duration-1000/.test(c))e.attr('class',c.replace(/opacity-0/g,'opacity-100').replace(/translate-y-\d+/g,'translate-y-0'));});return $.html()}
for(const d of all){
 const $=cheerio.load(d.html||'',{},false);
 $('script,noscript,iframe,object,embed,img[src="data:,"]').remove();
 $('*').each((_,el)=>{for(const n of Object.keys(el.attribs||{}))if(/^on/i.test(n)||['nonce','integrity'].includes(n))$(el).removeAttr(n);});
 $('a[href]').each((_,el)=>{const e=$(el),href=e.attr('href');e.attr('href',urlLocal(href));if(e.attr('href').startsWith('/'))e.removeAttr('target');else e.attr('rel','noopener noreferrer');});
 $('[src],[poster]').each((_,el)=>{const e=$(el);for(const attr of ['src','poster'])if(e.attr(attr))e.attr(attr,assetLocal(e.attr(attr)));e.removeAttr('srcset');});
 $('[fetchpriority]').removeAttr('fetchpriority');
 $('form').removeAttr('action').attr('data-clone-form','true');
 $('input,textarea,select').each((i,el)=>{const e=$(el);if(!e.attr('name'))e.attr('name',e.attr('id')||'field-'+i);});
 $('img[src^="data:image/png"]').each((_,el)=>{const e=$(el);const src=e.attr('src');const id=key(src);const filename='/clone/assets/chart-'+id+'.png';chartWrites.push(fs.writeFile('public'+filename,Buffer.from(src.split(',')[1],'base64')));e.attr('src',filename)});
 const routeBase=d.route.split('?')[0];
 const group=tabs[routeBase]||[];
 $('[role=tab]').each((_,el)=>{const e=$(el);const match=group.find(t=>norm(t.label)===norm(e.text()));if(match)e.attr('data-clone-route',match.route);});
 if(routeBase==='/app/settings')$('button').each((_,el)=>{const e=$(el);const idx=settingsLabels.findIndex(l=>norm(l)===norm(e.text()));if(idx>=0)e.attr('data-clone-route','/app/settings'+(settings[idx]?'?tab='+settings[idx]:''));});
 // Keep semantic DOM and native responsive CSS. Framer Motion visibility is restored locally by IntersectionObserver.
 if(!d.route.startsWith('/app'))$('[style]').each((_,el)=>{const e=$(el);const style=e.attr('style')||'';if(/opacity:\s*0(?:;|$)/.test(style)&&/transform:/.test(style)){e.attr('data-clone-reveal','');e.attr('style',style.replace(/opacity:\s*0(?:;|$)/,'opacity: 1;').replace(/transform:[^;]*;?/,'transform: none;'));}});
 for(const s of d.styles||[])if(!s.href&&s.css)css.add(s.css);
 const exactPublic=publicInteractions.find(p=>p.route===routeBase)||publicInteractions.find(p=>p.route===new URL(d.url).pathname);
 const menuSource=publicInteractions.find(p=>p.route==='/'+(new URL(d.url).pathname.split('/')[1]||'ko'));
 const publicData=exactPublic||(!d.route.startsWith('/app')&&$('header').length&&menuSource?{route:routeBase,accordions:[],tabs:[],menus:menuSource.menus}:undefined);
 const mergedMenus=publicData?[...publicData.menus,...(menuSource?.menus||[]).filter(x=>x.label.startsWith('모바일')&&!publicData.menus.some(y=>y.label===x.label))]:[];
 const publicState=publicData?{...publicData,accordions:publicData.accordions.map(x=>({...x,panelHtml:cleanFragment(x.panelHtml)})),tabs:publicData.tabs.map(x=>({...x,panelHtml:cleanFragment(x.panelHtml)})),menus:mergedMenus.map(x=>({...x,panelHtml:cleanFragment(x.panelHtml)}))}:undefined;
 if(!d.route.startsWith('/app'))$('[class]').each((_,el)=>{const e=$(el),c=e.attr('class');if(c.includes('opacity-0')&&/translate-y-|duration-1000/.test(c))e.attr('class',c.replace(/opacity-0/g,'opacity-100').replace(/translate-y-\d+/g,'translate-y-0')).attr('data-clone-reveal','');});
 const content={publicInteractions:publicState,route:d.route,url:d.url,title:d.title,html:$.html(),bodyClass:d.bodyClass||'',htmlClass:d.htmlClass||'',text:d.text,controls:d.controls||[],tabs:group};
 await fs.writeFile(out+'/'+key(d.route)+'.json',JSON.stringify(content));
 const actual=new URL(d.url,'https://haloxlabs.ai');const redirected=actual.pathname+actual.search!==d.route&&!d.route.includes('cloneTab=');
 manifest.push({route:d.route,file:key(d.route)+'.json',title:d.title,sourceUrl:d.url,status:/Oops! Page not found|404\s+.*not found/i.test(d.text)?'source-404':redirected?'redirect':'captured',textLength:d.text.length});
}
await Promise.all(chartWrites);
manifest.sort((a,b)=>a.route.localeCompare(b.route));
await fs.writeFile('public/clone/manifest.json',JSON.stringify(manifest,null,2));
const runtimeCss=[...css].join('\n').replace(/url\(["']?([^"')]+)["']?\)/g,(m,url)=>`url("${assetLocal(url)}")`);
await fs.writeFile('public/clone/runtime.css',runtimeCss);
const dialog=JSON.parse(await fs.readFile('docs/research/keyword-dialog.json','utf8'));
await fs.writeFile('public/clone/keyword-dialog.json',JSON.stringify({html:dialog.html}));
const dialogs=JSON.parse(await fs.readFile('docs/research/dialog-templates.json','utf8'));await fs.writeFile('public/clone/dialog-templates.json',JSON.stringify(dialogs.map(x=>({...x,html:cleanFragment(x.html)}))));
console.log(JSON.stringify({routes:manifest.length,source404:manifest.filter(x=>x.status==='source-404').length,redirects:manifest.filter(x=>x.status==='redirect').length,styles:css.size}));
