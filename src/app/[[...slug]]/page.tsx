import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCapture } from '@/lib/content';
import ClonePage from '@/components/ClonePage';
import { Workspaces } from '@/components/Workspaces';
export const dynamic='force-dynamic';
type Props={params:Promise<{slug?:string[]}>,searchParams:Promise<Record<string,string|string[]|undefined>>};
async function resolveRoute(props:Props){const {slug=[]}=await props.params;const query=await props.searchParams;const q=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value)q.set(key,Array.isArray(value)?value[0]:value);return '/'+slug.join('/')+(q.size?'?'+q:'')}
export async function generateMetadata(props:Props):Promise<Metadata>{const data=await getCapture(await resolveRoute(props));return {title:data?.title||'HaloX',robots:{index:false,follow:false}}}
export default async function Page(props:Props){const route=await resolveRoute(props);const data=await getCapture(route);if(route.split('?')[0]==='/app/workspaces')return <Workspaces/>;if(!data)notFound();return <ClonePage key={route} data={data} requestedRoute={route}/>}
