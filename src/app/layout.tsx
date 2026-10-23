import type { Metadata } from 'next';
import { Agentation } from 'agentation';
import { WorkspaceProvider } from '@/components/WorkspaceProvider';
import './globals.css';
export const metadata: Metadata = { title:'HaloX | 로컬 클론', description:'HaloX 공개 페이지와 앱의 로컬 데모', robots:{index:false,follow:false},icons:{icon:'/clone/assets/favicon.png'} };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="ko" suppressHydrationWarning><head><link rel="stylesheet" href="/clone/original.css" /><link rel="stylesheet" href="/clone/runtime.css" /></head><body><WorkspaceProvider>{children}</WorkspaceProvider>{process.env.NODE_ENV === 'development' && <Agentation />}</body></html> }
