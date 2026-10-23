import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCapture } from '@/lib/content';
import ClonePage from '@/components/ClonePage';
import { Workspaces } from '@/components/Workspaces';
import { KeywordsPage } from '@/components/live/KeywordsPage';
import { PromptsPage } from '@/components/live/PromptsPage';
export const dynamic='force-dynamic';
type Props={params:Promise<{slug?:string[]}>,searchParams:Promise<Record<string,string|string[]|undefined>>};
async function resolveRoute(props:Props){const {slug=[]}=await props.params;const query=await props.searchParams;const q=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value)q.set(key,Array.isArray(value)?value[0]:value);return '/'+slug.join('/')+(q.size?'?'+q:'')}
export async function generateMetadata(props:Props):Promise<Metadata>{const data=await getCapture(await resolveRoute(props));return {title:data?.title||'HaloX',robots:{index:false,follow:false}}}
export default async function Page(props:Props){const route=await resolveRoute(props);const pathname=route.split('?')[0];if(pathname==='/app/workspaces')return <Workspaces/>;if(/^\/app\/keywords(?:\/[^/]+)?$/.test(pathname)){const shell=await getCapture('/app/keywords');if(!shell)notFound();return <ClonePage key={route} data={shell} requestedRoute={route}><KeywordsPage keywordId={pathname.split('/')[3]}/></ClonePage>;}if(pathname==='/app/geo'||/^\/app\/geo\/prompts(?:\/[^/]+)?$/.test(pathname)){const shell=await getCapture('/app/geo/prompts');if(!shell)notFound();return <ClonePage key={route} data={shell} requestedRoute={route}><PromptsPage overview={pathname==='/app/geo'} promptId={pathname.split('/')[4]}/></ClonePage>;}const data=await getCapture(route);if(!data)notFound();return <ClonePage key={route} data={data} requestedRoute={route}/>}
