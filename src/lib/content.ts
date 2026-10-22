import fs from 'node:fs/promises';
import path from 'node:path';
import type { Capture, RouteEntry } from '@/types/clone';
const contentDir=path.join(process.cwd(),'public/clone');
export async function getManifest():Promise<RouteEntry[]>{return JSON.parse(await fs.readFile(path.join(contentDir,'manifest.json'),'utf8'))}
export async function getCapture(route:string):Promise<Capture|null>{
 const manifest=await getManifest();
 let entry=manifest.find(e=>e.route===route)||manifest.find(e=>e.route===route.split('?')[0]);
 if(!entry&&/^\/app\/keywords\/[^/]+/.test(route)) entry=manifest.find(e=>e.route==='/app/keywords/186cdef7-5a00-4a05-8de5-a04eb22778d6');
 if(!entry)return null;
 return JSON.parse(await fs.readFile(path.join(contentDir,'pages',entry.file),'utf8'));
}
