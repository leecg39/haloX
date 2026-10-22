import Link from 'next/link';
export default function NotFound(){return <main style={{minHeight:'100vh',display:'grid',placeContent:'center',textAlign:'center',gap:16}}><h1 style={{fontSize:36,fontWeight:700}}>404</h1><p>Oops! Page not found</p><Link href="/ko" style={{textDecoration:'underline'}}>Return to Home</Link></main>}
