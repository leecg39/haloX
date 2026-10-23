'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import parse, { Element, attributesToProps, domToReact, type DOMNode, type HTMLReactParserOptions } from 'html-react-parser';
import { createElement } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { Capture, DialogRequest, DialogResult } from '@/types/clone';
import { useCloneNavigation, writeActiveWorkspace } from './CloneNavigation';
import { handleDataClick, handleDataInput, initializeDataControls } from './data-controls';
import { DemoDialog } from './DemoDialog';
import './clone-runtime.css';
import { handlePublicClick, initializePublicControls } from './public-controls';
import { initializePublicPricing } from './public-pricing';
import { initializePublicLists } from './public-lists';
import { initializeLiveUsage } from './usage-live';
import { syncDialogActionToBackend } from '@/lib/api/client';

function PasswordVisibilityButton({className}:{className?:string}){
 const [visible,setVisible]=useState(false);
 const label=visible?'비밀번호 숨기기':'비밀번호 보기';
 const toggle=(event:React.MouseEvent<HTMLButtonElement>)=>{
  const input=event.currentTarget.parentElement?.querySelector<HTMLInputElement>('input');
  if(!input)return;
  const nextVisible=input.type==='password';
  input.type=nextVisible?'text':'password';
  setVisible(nextVisible);
 };
 return <button type="button" className={className} data-clone-password-toggle="true" aria-label={label} aria-pressed={visible} title={label} onClick={toggle}>{visible?<EyeOff className="h-4 w-4" aria-hidden="true"/>:<Eye className="h-4 w-4" aria-hidden="true"/>}</button>;
}

type PhoneChallenge={code:string;phone:string;expiresAt:number};
const normalizePhone=(value:string)=>value.replace(/\D/g,'').replace(/^82/,'0');
const validPhone=(value:string)=>/^01[016789]\d{7,8}$/.test(normalizePhone(value));
const hasNamedInput=(node:Element,name:string):boolean=>node.children.some(child=>child instanceof Element&&((child.name==='input'&&child.attribs.name===name)||hasNamedInput(child,name)));

function applySessionIdentity(root:HTMLElement,user:{email?:unknown;full_name?:unknown}){
 const email=typeof user.email==='string'?user.email:'';const fullName=typeof user.full_name==='string'?user.full_name:'';
 if(!email&&!fullName)return;
 const replacements:[string,string][]=email?[['demo@halox.local',email]]:[];
 if(fullName)replacements.push(['HaloX 데모 관리자',fullName]);
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node:Node|null;
 while((node=walker.nextNode())){let value=node.nodeValue||'';for(const [from,to] of replacements)value=value.replaceAll(from,to);node.nodeValue=value}
 root.querySelectorAll<HTMLInputElement>('input').forEach(input=>{for(const [from,to] of replacements)if(input.value.includes(from))input.value=input.value.replaceAll(from,to)});
}

function PhoneVerificationButton({className}:{className?:string}){
 const buttonRef=useRef<HTMLButtonElement>(null);
 const [phone,setPhone]=useState('');
 const [challenge,setChallenge]=useState<PhoneChallenge|null>(null);
 const [code,setCode]=useState('');
 const [status,setStatus]=useState<'idle'|'sent'|'error'|'verified'>('idle');
 useEffect(()=>{
  const row=buttonRef.current?.parentElement;
  const input=row?.querySelector<HTMLInputElement>('input[type="tel"]');
  if(!row||!input)return;
  const previousWrap=row.style.flexWrap;
  row.style.flexWrap='wrap';
  const sync=()=>setPhone(input.value);
  sync();input.addEventListener('input',sync);
  return()=>{input.removeEventListener('input',sync);row.style.flexWrap=previousWrap};
 },[]);
 useEffect(()=>{
  if(challenge&&challenge.phone!==normalizePhone(phone)){setChallenge(null);setCode('');setStatus('idle')}
 },[phone,challenge]);
 const send=()=>{
  const normalized=normalizePhone(phone);
  if(!validPhone(normalized))return;
  const random=new Uint32Array(1);crypto.getRandomValues(random);
  setChallenge({code:String(random[0]%1_000_000).padStart(6,'0'),phone:normalized,expiresAt:Date.now()+5*60*1000});
  setCode('');setStatus('sent');
 };
 const verify=()=>{
  if(!challenge||challenge.phone!==normalizePhone(phone)){setStatus('error');return}
  if(Date.now()>challenge.expiresAt){setStatus('error');return}
  setStatus(code===challenge.code?'verified':'error');
 };
 useEffect(()=>{
  const input=buttonRef.current?.parentElement?.querySelector<HTMLInputElement>('input[type="tel"]');
  if(input)input.dataset.phoneVerified=String(status==='verified');
 },[status]);
 const message=status==='verified'?'휴대폰 인증이 완료되었습니다.':status==='error'?(challenge&&Date.now()>challenge.expiresAt?'인증번호가 만료되었습니다. 다시 발송해 주세요.':'인증번호가 일치하지 않습니다.'):(challenge?`로컬 데모 인증번호 ${challenge.code} · 5분간 유효`:'');
 return <>
  <button ref={buttonRef} type="button" className={className} data-clone-phone-verification="true" disabled={!validPhone(phone)} onClick={send}>{challenge?'재발송':'인증번호 발송'}</button>
  {challenge&&<div data-clone-phone-verification="true" style={{flexBasis:'100%'}} className="flex w-full flex-col gap-2 pt-1">
   <div className="flex gap-2"><input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm" aria-label="휴대폰 인증번호" placeholder="인증번호 6자리" value={code} disabled={status==='verified'} onChange={event=>{setCode(event.target.value.replace(/\D/g,'').slice(0,6));if(status==='error')setStatus('sent')}}/><button type="button" data-clone-phone-verification="true" className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50" disabled={code.length!==6||status==='verified'} onClick={verify}>{status==='verified'?'인증 완료':'인증 확인'}</button></div>
   <p role={status==='error'?'alert':'status'} aria-live="polite" className={`text-xs ${status==='error'?'text-red-600':status==='verified'?'text-green-700':'text-muted-foreground'}`}>{message}</p>
  </div>}
 </>;
}

// App routes reachable without a session (sign-in and recovery flows).
const PUBLIC_APP_ROUTE=/^\/app\/(login|signup|forgot-password|reset-password|find-email|auth\/callback|verify-phone|invite)(\/|\?|$)/;
const parserOptions:HTMLReactParserOptions={replace(node){if(!(node instanceof Element))return;if(['script','iframe','noscript'].includes(node.name))return <></>;const nodeText=node.children.map(child=>'data'in child?child.data:'').join('').trim();if(node.name==='form'&&hasNamedInput(node,'email')&&hasNamedInput(node,'password')){const p=attributesToProps(node.attribs);return createElement('form',{...p,method:'post'},domToReact(node.children as DOMNode[],parserOptions))}if(node.name==='button'&&node.attribs.type==='button'&&nodeText==='인증번호 발송')return <PhoneVerificationButton className={node.attribs.class}/>;if(node.name==='button'&&node.attribs.type==='button'&&node.children.some(child=>child instanceof Element&&child.name==='svg'&&child.attribs.class?.includes('lucide-eye')))return <PasswordVisibilityButton className={node.attribs.class}/>;if(['input','textarea','select'].includes(node.name)){const p=attributesToProps(node.attribs);if('value'in p){p.defaultValue=p.value;delete p.value}if('checked'in p){p.defaultChecked=p.checked;delete p.checked}if(node.name==='textarea')return createElement('textarea',{...p,defaultValue:node.children.map(c=>'data'in c?c.data:'').join('')});if(node.name==='input')return createElement('input',p);return createElement('select',p,domToReact(node.children as DOMNode[],parserOptions))}}};
export default function ClonePage({data,requestedRoute}:{data:Capture;requestedRoute:string}){
 const router=useRouter();const rootRef=useRef<HTMLDivElement>(null);const [dialog,setDialog]=useState<DialogRequest|null>(null);const [toast,setToast]=useState('');const toastTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const navigate=useCallback((url:string)=>{
  try {
   const parsed=new URL(url,window.location.origin);
   if(parsed.origin===window.location.origin||parsed.hostname==='haloxlabs.ai'||parsed.hostname==='www.haloxlabs.ai')router.push(`${parsed.pathname}${parsed.search}${parsed.hash}`);
  } catch { /* Ignore malformed captured links instead of passing them to the router. */ }
 },[router]);
 const notify=useCallback((message:string)=>{setToast(message);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),3500)},[]);
 const openDialog=useCallback(async(request:DialogRequest)=>{if(request.route.split('?')[0]==='/app/geo/prompts'&&request.title==='추가')request={...request,title:'프롬프트 추가'};try{if(/키워드 추가/.test(request.title)){const r=await fetch('/clone/keyword-dialog.json');request={...request,template:(await r.json()).html}}else{const r=await fetch('/clone/dialog-templates.json');if(r.ok){const templates=await r.json();const found=templates.find((t:{route:string;trigger:string;html:string;kind?:string})=>(t.route===request.route||t.route===request.route.split('?')[0])&&t.trigger===request.title&&t.kind!=='page');if(found)request={...request,template:found.html}}}}catch{}setDialog(request)},[]);
 useEffect(()=>{if(!requestedRoute.startsWith('/app')||PUBLIC_APP_ROUTE.test(requestedRoute))return;let active=true;void (async()=>{try{const res=await fetch('/api/v1/auth');if(!active)return;if(res.status===401){navigate('/app/login');return}if(res.ok){const session=await res.json() as {user?:{email?:unknown;full_name?:unknown}};if(active&&session.user&&rootRef.current)applySessionIdentity(rootRef.current,session.user)}}catch{}})();return()=>{active=false}},[requestedRoute,navigate]);
 const navigation=useCloneNavigation({rootRef,route:requestedRoute,navigate,openDialog,notify,menus:data.publicInteractions?.menus});
 const content=useMemo(()=>parse(data.html,parserOptions),[data.html]);
 useEffect(()=>{document.body.className=data.bodyClass;document.documentElement.className=data.htmlClass;document.body.style.removeProperty('pointer-events');document.body.style.removeProperty('overflow');return()=>{if(toastTimer.current)clearTimeout(toastTimer.current)}},[data]);
 useEffect(()=>{const root=rootRef.current;if(!root)return;const cleanup=initializeDataControls(root,requestedRoute);
  const originalFields=root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input,textarea,select');
  if(requestedRoute.startsWith('/app/login')){
   const loginForm=root.querySelector<HTMLFormElement>('form[data-clone-form="true"]');
   loginForm?.querySelector<HTMLInputElement>('input[name="email"]')?.setAttribute('required','');
   loginForm?.querySelector<HTMLInputElement>('input[name="password"]')?.setAttribute('required','');
  }
  try {
   const saved:unknown=JSON.parse(localStorage.getItem('halox-clone:settings:'+requestedRoute)||'{}');
   if(saved&&typeof saved==='object')originalFields.forEach((el,i)=>{const value=(saved as Record<string,unknown>)[String(i)];if(typeof value==='string'&&el.type!=='password')el.value=value});
  } catch { /* Corrupt or unavailable local storage must not disable page interactions. */ }
  const cleanupPublic=initializePublicControls(root);
  const cleanupPricing=initializePublicPricing(root);
  const cleanupLists=initializePublicLists(root,requestedRoute);
  const cleanupUsage=initializeLiveUsage(root,requestedRoute);
  const reveal=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('clone-revealed');reveal.unobserve(entry.target)}},{threshold:.05});root.querySelectorAll('[data-clone-reveal]').forEach(el=>reveal.observe(el));
  const click=(event:MouseEvent)=>{
   const target=event.target as HTMLElement;if(!target?.closest)return;
   const routed=target.closest<HTMLElement>('[data-clone-route]');if(routed){event.preventDefault();navigate(routed.dataset.cloneRoute!);return}
   const link=target.closest<HTMLAnchorElement>('a[href]');if(link){const href=link.getAttribute('href')||'';if(href.startsWith('/')&&!event.metaKey&&!event.ctrlKey){event.preventDefault();navigate(href);return}if(href.startsWith('#'))return;}
   if(navigation.handleClick(event))return;
   if(handlePublicClick(event,root,data.publicInteractions))return;
   if(handleDataClick(event,root,notify))return;
   const button=target.closest<HTMLButtonElement>('button,[role=button]');if(!button||button.disabled||button.dataset.clonePasswordToggle==='true'||button.dataset.clonePhoneVerification==='true')return;
   const label=(button.getAttribute('aria-label')||button.textContent||'').trim();const text=(button.textContent||'').trim();
   if(!requestedRoute.startsWith('/app')&&/^(우리 브랜드 확인하기|Check (?:your|my) brand|무료로 시작하기|무료 체험 시작|Start for free|Start free trial)$/i.test(text)){navigate('/app/login');return}
   if(!requestedRoute.startsWith('/app')&&/^(요금 계산기|Pricing calculator|Cost calculator)$/i.test(text)){root.querySelector('#estimate')?.scrollIntoView({behavior:'smooth'});return}
   if(/Back to top|맨 위|TOP/.test(label)){window.scrollTo({top:0,behavior:'smooth'});root.querySelector('main')?.scrollTo({top:0,behavior:'smooth'});return}
   if((label==='Close'||label==='닫기'||text==='닫기')&&button.closest('[role=dialog]')){navigate('/app');return}
   if((label==='Close'||label==='닫기')&&!button.closest('[role=dialog]')){button.parentElement?.remove();return}
   if(text==='키워드 전체 보기'){navigate('/app/keywords');return}if(text==='프롬프트 전체 보기'){navigate('/app/geo/prompts');return}
   if(/Raw 데이터|^Raw$/.test(text)){navigate('/app/raw-data');return}
   if(/빈틈 찾아보기/.test(text)){navigate('/app/gap');return}
   if(/설정|연동하기|연동 설정/.test(text)&&!button.closest('[role=dialog]')){navigate('/app/settings?tab=integrations');return}
   if(/More info/.test(label)){const card=button.parentElement?.parentElement;notify((card?.innerText||'지표')+' · 수집 시점의 분석 결과입니다.');return}
   if(button.hasAttribute('aria-expanded')&&button.hasAttribute('aria-controls')){const id=button.getAttribute('aria-controls')!;const panel=root.querySelector('#'+CSS.escape(id));if(panel){const open=button.getAttribute('aria-expanded')!=='true';button.setAttribute('aria-expanded',String(open));button.dataset.state=open?'open':'closed';(panel as HTMLElement).hidden=!open;(panel as HTMLElement).style.display=open?'block':'none';(panel as HTMLElement).dataset.state=open?'open':'closed';return}}
   if(/저장|변경 사항/.test(text)&&requestedRoute.startsWith('/app/settings')){const values:Record<string,string>={};root.querySelectorAll<HTMLInputElement>('input,textarea,select').forEach((el,i)=>{if(el.type!=='password')values[String(i)]=el.value});try{localStorage.setItem('halox-clone:settings:'+requestedRoute,JSON.stringify(values));notify('설정을 이 브라우저에 저장했습니다.')}catch{notify('로컬 저장 공간을 사용할 수 없습니다. 브라우저 설정을 확인해 주세요.')}return}
   if(/복사/.test(text)){const value=button.closest('div')?.querySelector('input')?.value||location.href;navigator.clipboard?.writeText(value).then(()=>notify('복사했습니다.')).catch(()=>notify(value));return}
   if(/출력|인쇄/.test(text)){window.print();return}
   if(/단일|일괄|추천/.test(text)&&button.getAttribute('role')==='tab')return;
   if(button.type==='submit'&&button.closest('form'))return;
   if(/추가|새 |새로|만들|생성|등록|초대|수정|편집|진단|분석|최적화|제작|업로드|문의|신청|시작|시도|확인하기|받기|구독|업그레이드/.test(text)){event.preventDefault();openDialog({title:text,route:requestedRoute});return}
   if(text==='취소'){navigate('/app');return}
   // Captured Radix comboboxes have hidden native options. Restore a native local selector.
   if(button.getAttribute('role')==='combobox'){const select=button.parentElement?.querySelector('select');if(select){(select as HTMLElement).style.cssText='display:block;position:absolute;z-index:80;opacity:1;width:200px;height:36px;clip:auto;';select.focus();return}}
   if(button.getAttribute('role')==='tab'){notify('이 보기의 수집된 상태를 표시하고 있습니다.');return}
   if(text||label){openDialog({title:text||label,route:requestedRoute,description:'로컬 데모에서 내용을 확인하거나 입력할 수 있습니다.'})}
  };
  const input=(event:Event)=>{handleDataInput(event,root)};
  const submit=(event:Event)=>{event.preventDefault();const form=event.target as HTMLFormElement;if(!form.reportValidity())return;if(requestedRoute.startsWith('/app/login')){const email=(form.querySelector('input[name="email"]') as HTMLInputElement|null)?.value.trim()||'';const password=(form.querySelector('input[name="password"]') as HTMLInputElement|null)?.value||'';const submitButton=form.querySelector<HTMLButtonElement>('button[type="submit"]');const originalLabel=submitButton?.textContent||'Sign In';void (async()=>{if(submitButton){submitButton.disabled=true;submitButton.textContent='로그인 중...'}try{const res=await fetch('/api/v1/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});if(res.ok){navigate('/app');return}const message=res.status===401?'이메일 또는 비밀번호가 올바르지 않습니다.':res.status===429?'로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.':res.status===400?'이메일과 비밀번호를 확인해 주세요.':res.status===500?'서버 로그인 설정을 확인해 주세요.':'로그인할 수 없습니다. 잠시 후 다시 시도해 주세요.';notify(message)}catch{notify('로그인할 수 없습니다. 네트워크 상태를 확인해 주세요.')}finally{if(submitButton?.isConnected){submitButton.disabled=false;submitButton.textContent=originalLabel}}})();return}if(requestedRoute.startsWith('/app/signup')){notify('회원가입 정보를 확인했습니다.');return}if(requestedRoute.startsWith('/app/forgot-password')){notify('데모 화면입니다. 실제 재설정 이메일은 발송하지 않습니다.');return}notify('입력 내용을 확인했습니다. 로컬 데모에는 외부로 전송하지 않습니다.')};
  const keydown=(event:KeyboardEvent)=>{if(event.key==='Escape'&&requestedRoute.startsWith('/app/settings'))navigate('/app')};
  root.addEventListener('click',click);root.addEventListener('input',input);root.addEventListener('submit',submit);document.addEventListener('keydown',keydown);
  return()=>{cleanup();cleanupPublic();cleanupPricing();cleanupLists();cleanupUsage();reveal.disconnect();root.removeEventListener('click',click);root.removeEventListener('input',input);root.removeEventListener('submit',submit);document.removeEventListener('keydown',keydown)};
 },[data,requestedRoute,navigate,notify,openDialog,navigation]);
 const onComplete=(result:DialogResult)=>{if(result.route.split('?')[0]==='/app/workspaces'&&result.record?.name){writeActiveWorkspace({id:result.record.id,name:result.record.name,plan:'Trial',domain:result.values?.domain||''});notify(`'${result.record.name}' 워크스페이스를 생성하고 전환했습니다.`)}else{notify('로컬 데모에 저장했습니다.')}window.dispatchEvent(new CustomEvent('halox:record-created',{detail:result}));void syncDialogActionToBackend(result);};
 return <><div ref={rootRef} className={'clone-surface '+(requestedRoute.startsWith('/app')?'clone-app':'clone-public')} data-route={requestedRoute}>{content}</div>{navigation.overlay}<DemoDialog request={dialog} onClose={()=>setDialog(null)} onComplete={onComplete}/>{toast&&<div className="clone-toast" role="status">{toast}<button aria-label="알림 닫기" onClick={()=>setToast('')}>×</button></div>}</>;
}
