import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const base=(process.argv[2]||'http://localhost:3001').replace(/\/$/,'');
const manifest=JSON.parse(await fs.readFile('public/clone/manifest.json','utf8'));
const expected=JSON.parse(await fs.readFile('docs/research/routes.json','utf8'));
const allowedStatuses=new Set(['captured','source-404','redirect']);
const duplicateValues=values=>[...new Set(values.filter((value,index)=>values.indexOf(value)!==index))];
const duplicateRoutes=duplicateValues(manifest.map(entry=>entry.route));
const duplicateFiles=duplicateValues(manifest.map(entry=>entry.file));
const invalidEntries=manifest.filter(entry=>typeof entry.route!=='string'||!entry.route.startsWith('/')||typeof entry.file!=='string'||path.basename(entry.file)!==entry.file||!entry.file.endsWith('.json')||!allowedStatuses.has(entry.status));
const missing=expected.filter(route=>!manifest.some(entry=>entry.route===route));
const results=[];
const queue=[...manifest];

async function worker(){
  while(queue.length){
    const entry=queue.shift();
    try{
      const response=await fetch(new URL(entry.route,base),{signal:AbortSignal.timeout(30000)});
      const html=await response.text();
      const $=cheerio.load(html);
      results.push({route:entry.route,status:response.status,rendered:$('.clone-surface').length>0,sourceStatus:entry.status,title:$('title').text()});
    }catch(error){results.push({route:entry.route,error:String(error)})}
  }
}

await Promise.all(Array.from({length:4},worker));
results.sort((a,b)=>a.route.localeCompare(b.route));
const failed=results.filter(result=>result.status!==200||!result.rendered);
const assets=new Set(),remoteResources=[],dangerousUrls=[];
const resourceAttributes=['src','poster','href','xlink:href','action','formaction'];
const unsafeAttributes=['src','poster','href','xlink:href','action','formaction'];

function scanHtml(html,route,scope){
  const $=cheerio.load(html||'',{},false);
  $('*').each((_,element)=>{
    for(const attribute of resourceAttributes){
      const value=$(element).attr(attribute);
      if(!value)continue;
      if(value.startsWith('/clone/'))assets.add(value.split(/[?#]/)[0]);
      const externalResource=attribute!=='href'||!['a','area'].includes(element.tagName);
      if(externalResource&&/^https?:/i.test(value))remoteResources.push({route,scope,attribute,value});
    }
    const srcset=$(element).attr('srcset');
    if(srcset)for(const candidate of srcset.split(',').map(value=>value.trim().split(/\s+/)[0]).filter(Boolean)){
      if(candidate.startsWith('/clone/'))assets.add(candidate.split(/[?#]/)[0]);
      else if(/^https?:/i.test(candidate))remoteResources.push({route,scope,attribute:'srcset',value:candidate});
      else if(/^(?:javascript|vbscript|data:text\/html):/i.test(candidate))dangerousUrls.push({route,scope,attribute:'srcset',value:candidate.slice(0,160)});
    }
    const style=$(element).attr('style')||'';
    for(const match of style.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)){
      const value=match[1].trim();
      if(value.startsWith('/clone/'))assets.add(value.split(/[?#]/)[0]);
      else if(/^https?:/i.test(value))remoteResources.push({route,scope,attribute:'style',value});
      else if(/^(?:javascript|vbscript|data:text\/html):/i.test(value))dangerousUrls.push({route,scope,attribute:'style',value:value.slice(0,160)});
    }
    for(const attribute of unsafeAttributes){
      const value=$(element).attr(attribute);
      if(value&&/^(?:javascript|vbscript|data:text\/html):/i.test(value.trim()))dangerousUrls.push({route,scope,attribute,value:value.slice(0,160)});
    }
    for(const name of Object.keys(element.attribs||{}))if(/^on/i.test(name))dangerousUrls.push({route,scope,attribute:name,value:'inline event handler'});
  });
}

for(const entry of manifest){
  const data=JSON.parse(await fs.readFile(path.join('public/clone/pages',entry.file),'utf8'));
  scanHtml(data.html,entry.route,'page');
  for(const type of ['accordions','tabs','menus'])for(const panel of data.publicInteractions?.[type]||[])scanHtml(panel.panelHtml,entry.route,type);
}

const keywordDialog=JSON.parse(await fs.readFile('public/clone/keyword-dialog.json','utf8'));
scanHtml(keywordDialog.html,'/app/keywords','keyword-dialog');
const dialogs=JSON.parse(await fs.readFile('public/clone/dialog-templates.json','utf8'));
for(const dialog of dialogs)scanHtml(dialog.html,dialog.route||'dialog',`dialog:${dialog.trigger||'unknown'}`);

const remoteStyles=[];
for(const file of ['original.css','runtime.css']){
  const css=await fs.readFile(path.join('public/clone',file),'utf8');
  for(const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)){
    const value=match[1].trim();
    if(value.startsWith('/clone/'))assets.add(value.split(/[?#]/)[0]);
    else if(/^https?:/i.test(value))remoteStyles.push({file,value});
    else if(/^(?:javascript|vbscript|data:text\/html):/i.test(value))dangerousUrls.push({route:file,scope:'css',attribute:'url',value:value.slice(0,160)});
  }
  for(const match of css.matchAll(/@import\s+(?:url\()?\s*["']?(https?:[^'";)\s]+)/gi))remoteStyles.push({file,value:match[1]});
}

const assetMissing=[];
for(const asset of assets)try{await fs.access(`public${asset}`)}catch{assetMissing.push(asset)}
const uniqueObjects=items=>[...new Map(items.map(item=>[JSON.stringify(item),item])).values()];
const uniqueRemoteResources=uniqueObjects(remoteResources);
const uniqueRemoteStyles=uniqueObjects(remoteStyles);
const uniqueDangerousUrls=uniqueObjects(dangerousUrls);
const report={
  base,total:results.length,expected:expected.length,missing,failed,duplicateRoutes,duplicateFiles,invalidEntries,
  assetMissing,remoteImages:[...new Set(uniqueRemoteResources.map(item=>item.value))],remoteResources:uniqueRemoteResources,remoteStyles:uniqueRemoteStyles,dangerousUrls:uniqueDangerousUrls,
  source404:manifest.filter(entry=>entry.status==='source-404').length,results,
};
await fs.mkdir('docs/clone',{recursive:true});
await fs.writeFile('docs/clone/route-verification.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,results:undefined}));
if(missing.length||failed.length||duplicateRoutes.length||duplicateFiles.length||invalidEntries.length||assetMissing.length||uniqueRemoteResources.length||uniqueRemoteStyles.length||uniqueDangerousUrls.length)process.exitCode=1;
