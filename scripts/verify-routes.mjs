import fs from 'node:fs/promises';
import * as cheerio from 'cheerio';
const base=process.argv[2]||'http://localhost:3001';
const manifest=JSON.parse(await fs.readFile('public/clone/manifest.json','utf8'));const expected=JSON.parse(await fs.readFile('docs/research/routes.json','utf8'));
const missing=expected.filter(route=>!manifest.some(e=>e.route===route));const results=[];const queue=[...manifest];
async function worker(){while(queue.length){const entry=queue.shift();try{const res=await fetch(base+entry.route,{signal:AbortSignal.timeout(30000)});const html=await res.text();const $=cheerio.load(html);results.push({route:entry.route,status:res.status,rendered:$('.clone-surface').length>0,sourceStatus:entry.status,title:$('title').text()});}catch(e){results.push({route:entry.route,error:String(e)})}}}
await Promise.all(Array.from({length:4},worker));const failed=results.filter(x=>x.status!==200||!x.rendered);
const assets=new Set(),remote=[];for(const entry of manifest){const d=JSON.parse(await fs.readFile('public/clone/pages/'+entry.file,'utf8'));const $=cheerio.load(d.html);$('img[src],video[src],source[src]').each((i,e)=>{const src=$(e).attr('src');if(src?.startsWith('/clone/'))assets.add(src);else if(src?.startsWith('http'))remote.push({route:entry.route,src})});}
const assetMissing=[];for(const p of assets)try{await fs.access('public'+p)}catch{assetMissing.push(p)}
const report={base,total:results.length,expected:expected.length,missing,failed,assetMissing,remoteImages:[...new Set(remote.map(x=>x.src))],source404:manifest.filter(x=>x.status==='source-404').length,results};
await fs.mkdir('docs/clone',{recursive:true});await fs.writeFile('docs/clone/route-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,results:undefined}));if(missing.length||failed.length||assetMissing.length)process.exitCode=1;
