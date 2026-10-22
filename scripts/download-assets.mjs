import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root=process.cwd();const out=path.join(root,'public/clone/assets');await fs.mkdir(out,{recursive:true});
const initial=JSON.parse(await fs.readFile('docs/research/haloxlabs.ai/initial.json','utf8'));
const mainCss=await (await fetch(initial.styles.find(s=>s.href?.includes('haloxlabs.ai')).href)).text();
const googleCss=await (await fetch('https://fonts.googleapis.com/css2?family=Geist+Mono:wght@300..600&display=swap',{headers:{'User-Agent':'Mozilla/5.0'}})).text();
let css=mainCss+'\n'+googleCss;const urls=new Set(['https://haloxlabs.ai/favicon.png?v=2','https://haloxlabs.ai/apple-touch-icon.png']);
for(const s of css.matchAll(/url\(["']?([^"')]+)["']?\)/g))if(!s[1].startsWith('data:'))urls.add(new URL(s[1],'https://haloxlabs.ai/assets/index-BjzOpcfp.css').href);
try{for(const f of await fs.readdir('docs/research/captures')){const d=JSON.parse(await fs.readFile('docs/research/captures/'+f,'utf8'));for(const a of d.assets)urls.add(a)}}catch{}
let manifest={};try{manifest=JSON.parse(await fs.readFile('docs/research/assets.json','utf8'))}catch{}
const errors=[];const queue=[...urls].filter(u=>!manifest[u]);
async function worker(){while(queue.length){const url=queue.shift();try{const u=new URL(url);const name=path.basename(u.pathname)||'asset';const hash=crypto.createHash('sha256').update(url).digest('hex').slice(0,12);const dest=hash+'-'+name;const res=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!res.ok)throw Error(String(res.status));await fs.writeFile(path.join(out,dest),Buffer.from(await res.arrayBuffer()));manifest[url]='/clone/assets/'+dest;console.log('asset',dest)}catch(e){errors.push({url,error:String(e)})}}}
await Promise.all(Array.from({length:4},worker));
css=css.replace(/url\(["']?([^"')]+)["']?\)/g,(match,url)=>{if(url.startsWith('data:'))return match;const absolute=new URL(url,'https://haloxlabs.ai/assets/index-BjzOpcfp.css').href;return manifest[absolute]?`url("${manifest[absolute]}")`:match});
await fs.writeFile('public/clone/original.css',css);await fs.writeFile('docs/research/assets.json',JSON.stringify(manifest,null,2));await fs.writeFile('docs/research/asset-errors.json',JSON.stringify(errors,null,2));
const icon=manifest['https://haloxlabs.ai/favicon.png?v=2'];if(icon)await fs.copyFile('public'+icon,'public/clone/assets/favicon.png');
console.log(JSON.stringify({total:Object.keys(manifest).length,errors:errors.length,css:css.length}));
