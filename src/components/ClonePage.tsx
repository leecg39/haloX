'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { useRouter } from 'next/navigation';
import parse, { Element, attributesToProps, domToReact, type DOMNode, type HTMLReactParserOptions } from 'html-react-parser';
import { createElement } from 'react';
import { canAccess, routeSection } from '@/lib/permissions/workspace';
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
import { PhoneVerificationButton } from './PhoneVerificationButton';
import { submitSignup } from './signup-form';
import { ReferralSignupField } from './ReferralSignupField';
import { useWorkspace } from './WorkspaceProvider';
import { WorkspaceQuotaButton } from './WorkspaceQuotaButton';

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

const hasNamedInput=(node:Element,name:string):boolean=>node.children.some(child=>child instanceof Element&&((child.name==='input'&&child.attribs.name===name)||hasNamedInput(child,name)));
const nodeTextContent=(node:Element):string=>node.children.map(child=>'data'in child?child.data:child instanceof Element?nodeTextContent(child):'').join('');
const selectedOptionValues=(node:Element):string[]=>node.children.flatMap(child=>{
 if(!(child instanceof Element))return [];
 if(child.name==='option'&&Object.hasOwn(child.attribs,'selected'))return [child.attribs.value??nodeTextContent(child)];
 return child.name==='optgroup'?selectedOptionValues(child):[];
});

function applySessionIdentity(root:HTMLElement,user:{email?:unknown;full_name?:unknown}){
 const email=typeof user.email==='string'?user.email:'';const fullName=typeof user.full_name==='string'?user.full_name:'';
 if(!email&&!fullName)return;
 const replacements:[string,string][]=email?[['demo@halox.local',email]]:[];
 if(fullName)replacements.push(['HaloX 데모 관리자',fullName]);
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node:Node|null;
 while((node=walker.nextNode())){if(node.parentElement?.closest('[data-live-root]'))continue;let value=node.nodeValue||'';for(const [from,to] of replacements)value=value.replaceAll(from,to);node.nodeValue=value}
 root.querySelectorAll<HTMLInputElement>('input:not([data-live-root] input)').forEach(input=>{for(const [from,to] of replacements)if(input.value.includes(from))input.value=input.value.replaceAll(from,to)});
}

const parserOptions:HTMLReactParserOptions={replace(node){if(!(node instanceof Element))return;if(['script','iframe','noscript'].includes(node.name))return <></>;const nodeText=node.children.map(child=>'data'in child?child.data:'').join('').trim();if(node.name==='form'&&hasNamedInput(node,'email')&&hasNamedInput(node,'password')){const p=attributesToProps(node.attribs);return createElement('form',{...p,method:'post'},domToReact(node.children as DOMNode[],parserOptions))}if(node.name==='button'&&node.attribs.type==='button'&&nodeText==='인증번호 발송')return <PhoneVerificationButton className={node.attribs.class}/>;if(node.name==='button'&&node.attribs.type==='button'&&node.children.some(child=>child instanceof Element&&child.name==='svg'&&child.attribs.class?.includes('lucide-eye')))return <PasswordVisibilityButton className={node.attribs.class}/>;if(node.name==='option'){const p=attributesToProps(node.attribs);delete p.selected;return createElement('option',p,domToReact(node.children as DOMNode[],parserOptions))}if(['input','textarea','select'].includes(node.name)){const p=attributesToProps(node.attribs);if('value'in p){p.defaultValue=p.value;delete p.value}if('checked'in p){p.defaultChecked=p.checked;delete p.checked}if(node.name==='textarea')return createElement('textarea',{...p,defaultValue:node.children.map(c=>'data'in c?c.data:'').join('')});if(node.name==='input')return createElement('input',p);const selected=selectedOptionValues(node);const selectProps=(selected.length&&!('defaultValue'in p)?{...p,defaultValue:p.multiple?selected:selected[0]}:p) as unknown as SelectHTMLAttributes<HTMLSelectElement>;return createElement('select',selectProps,domToReact(node.children as DOMNode[],parserOptions))}}};
function DisplayModeToggle({mode}:{mode:'original'|'live'}){
 const router=useRouter();const [busy,setBusy]=useState(false);
 const next=mode==='original'?'live':'original';
 const toggle=()=>{setBusy(true);document.cookie=`halox_display=${next}; path=/; max-age=31536000; samesite=lax`;router.refresh()};
 return <button type="button" className="clone-mode-toggle" onClick={toggle} disabled={busy} title="표시 모드 전환" aria-label={`표시 모드를 ${next==='live'?'라이브 편집':'원본 1:1'} 모드로 전환`}>{mode==='original'?'라이브 편집 모드로':'원본 화면으로'}</button>;
}
export default function ClonePage({data,requestedRoute,children,displayMode='live'}:{data:Capture;requestedRoute:string;children?:ReactNode;displayMode?:'original'|'live'}){
 const {user,permission,activeWorkspace,loading:workspaceLoading,error:workspaceError,reload:reloadWorkspace}=useWorkspace();
 const section=routeSection(requestedRoute);
 const blocked=!!section&&(workspaceLoading||!!workspaceError||!canAccess(permission,section));
 const router=useRouter();const rootRef=useRef<HTMLDivElement>(null);const [dialog,setDialog]=useState<DialogRequest|null>(null);const [toast,setToast]=useState('');const toastTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const navigate=useCallback((url:string)=>{
  try {
   const parsed=new URL(url,window.location.origin);
   if(parsed.origin===window.location.origin||parsed.hostname==='haloxlabs.ai'||parsed.hostname==='www.haloxlabs.ai')router.push(`${parsed.pathname}${parsed.search}${parsed.hash}`);
  } catch { /* Ignore malformed captured links instead of passing them to the router. */ }
 },[router]);
 const notify=useCallback((message:string)=>{setToast(message);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),3500)},[]);
 const openDialog=useCallback(async(request:DialogRequest)=>{if(request.route.split('?')[0]==='/app/geo/prompts'&&request.title==='추가')request={...request,title:'프롬프트 추가'};try{if(/키워드 추가/.test(request.title)){const r=await fetch('/clone/keyword-dialog.json');request={...request,template:(await r.json()).html}}else{const r=await fetch('/clone/dialog-templates.json');if(r.ok){const templates=await r.json();const found=templates.find((t:{route:string;trigger:string;html:string;kind?:string})=>(t.route===request.route||t.route===request.route.split('?')[0])&&t.trigger===request.title&&t.kind!=='page');if(found)request={...request,template:found.html}}}}catch{}setDialog(request)},[]);
 useEffect(()=>{if(user&&rootRef.current&&displayMode==='live')applySessionIdentity(rootRef.current,user)},[user,requestedRoute,data.html,displayMode]);
 const navigation=useCloneNavigation({rootRef,route:requestedRoute,navigate,openDialog,notify,menus:data.publicInteractions?.menus});
 const content=useMemo(()=>parse(data.html,{replace(node,index){
  if(requestedRoute.startsWith('/app')&&node instanceof Element&&node.name==='button'&&node.attribs['aria-label']?.startsWith('AI 프롬프트 '))return <WorkspaceQuotaButton className={node.attribs.class}/>;
  if(children&&!requestedRoute.startsWith('/app')&&node instanceof Element&&node.name==='main'){const props=attributesToProps(node.attribs);return <main {...props} className={`${String(props.className||'')} clone-managed-public`.trim()}>{children}</main>}
  if((children||section)&&node instanceof Element&&node.attribs.id==='main-scroll-container')return <main {...attributesToProps(node.attribs)} data-live-root={children||blocked ? "true" : undefined}>{blocked ? <section className="live live-card" aria-label="메뉴 접근 안내"><h1>{workspaceLoading ? '권한 확인 중…' : workspaceError ? '계정 정보를 확인할 수 없습니다' : '접근 권한이 없습니다'}</h1><p>{workspaceError || (workspaceLoading ? '현재 워크스페이스의 권한을 확인하고 있습니다.' : '이 메뉴는 현재 멤버에게 허용되지 않았습니다. 관리자에게 메뉴 권한을 요청해 주세요.')}</p><button onClick={() => void reloadWorkspace()}>권한 다시 확인</button> <a href="/app/workspaces">워크스페이스 선택</a> · <a href="/app/settings?tab=profile">내 프로필</a></section> : <>{section && permission.role === 'viewer' && <p className="live-status" role="status">읽기 전용 · 조회와 검색을 할 수 있습니다. 수정·실행·다운로드는 제한됩니다.</p>}{section && !permission.allowed_sections.includes('all') && permission.role !== 'owner' && <p className="live-status">허용된 메뉴의 자료만 표시합니다. 다른 메뉴의 자료가 필요한 집계와 연결 목록은 일부가 생략될 수 있습니다.</p>}{children || (permission.role === 'viewer' ? <fieldset disabled>{domToReact(node.children as DOMNode[],parserOptions)}</fieldset> : domToReact(node.children as DOMNode[],parserOptions))}</>}</main>;
  const pageLabel=requestedRoute.split('?')[0]==='/app/referral'?'추천 프로그램':requestedRoute.split('?')[0]==='/app/settings'&&new URLSearchParams(requestedRoute.split('?')[1]).get('tab')==='profile'?'내 프로필과 보안':requestedRoute.split('?')[0]==='/app/settings'?'설정':undefined;
  if(pageLabel&&node instanceof Element&&node.name==='span'&&node.attribs.role==='link'&&node.attribs['aria-current']==='page')return <span {...attributesToProps(node.attribs)}>{pageLabel}</span>;
  if(requestedRoute.startsWith('/app/signup') && node instanceof Element && node.name==='form'){
   const signupOptions:HTMLReactParserOptions={replace(child,childIndex){if(child instanceof Element&&child.name==='button'&&child.attribs.type==='submit')return <><ReferralSignupField code={new URLSearchParams(requestedRoute.split('?')[1]).get('ref') || ''}/><button {...attributesToProps(child.attribs)}>{domToReact(child.children as DOMNode[],parserOptions)}</button></>;return parserOptions.replace?.(child,childIndex)}};
   return <form {...attributesToProps(node.attribs)} data-clone-form="true">{domToReact(node.children as DOMNode[],signupOptions)}</form>;
  }
  return parserOptions.replace?.(node,index);
 }}),[data.html,children,requestedRoute,section,blocked,permission,workspaceLoading,workspaceError,reloadWorkspace]);
 useEffect(()=>{document.body.className=data.bodyClass;document.documentElement.className=data.htmlClass;document.body.style.removeProperty('pointer-events');document.body.style.removeProperty('overflow');return()=>{if(toastTimer.current)clearTimeout(toastTimer.current)}},[data]);
 useEffect(()=>{const root=rootRef.current;if(!root)return;const cleanup=children?()=>{}:initializeDataControls(root,requestedRoute);
  const originalFields=root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input:not([data-live-root] input),textarea:not([data-live-root] textarea),select:not([data-live-root] select)');
  if(requestedRoute.startsWith('/app/login')){
   const loginForm=root.querySelector<HTMLFormElement>('form[data-clone-form="true"]');
   loginForm?.querySelector<HTMLInputElement>('input[name="email"]')?.setAttribute('required','');
   loginForm?.querySelector<HTMLInputElement>('input[name="password"]')?.setAttribute('required','');
  }
  if(requestedRoute.startsWith('/app/signup')){
   const form=root.querySelector<HTMLFormElement>('form');
   form?.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])').forEach(input=>{if(input.name&&!input.hasAttribute('data-optional'))input.required=true});
   form?.querySelectorAll<HTMLInputElement>('input[name="password"],input[name="passwordConfirm"]').forEach(input=>{input.minLength=8;input.maxLength=128});
   const button=form?.querySelector<HTMLButtonElement>('button[type="submit"]');if(button)button.disabled=false;
  }
  try {
   const saved:unknown=JSON.parse(localStorage.getItem('halox-clone:settings:'+requestedRoute)||'{}');
   if(saved&&typeof saved==='object')originalFields.forEach((el,i)=>{const value=(saved as Record<string,unknown>)[String(i)];if(typeof value==='string'&&el.type!=='password')el.value=value});
  } catch { /* Corrupt or unavailable local storage must not disable page interactions. */ }
  const cleanupPublic=initializePublicControls(root);
  const cleanupPricing=initializePublicPricing(root);
  const cleanupLists=initializePublicLists(root,requestedRoute);
  const cleanupUsage=displayMode==='live'?initializeLiveUsage(root,requestedRoute,activeWorkspace.id):()=>{};
  const reveal=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('clone-revealed');reveal.unobserve(entry.target)}},{threshold:.05});root.querySelectorAll('[data-clone-reveal]').forEach(el=>reveal.observe(el));
  const click=(event:MouseEvent)=>{
   const target=event.target as HTMLElement;if(!target?.closest||target.closest('[data-live-root], [data-live-quota]'))return;
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
   if(button.getAttribute('role')==='tab'){const tabText=(button.textContent||'').trim();const base=(s:string)=>s.replace(/\s*\([^)]*\)\s*$/,'').trim();const tab=data.tabs?.find(t=>base(t.label)===base(tabText));if(tab){navigate(tab.route);return}notify('이 보기의 수집된 상태를 표시하고 있습니다.');return}
   if(text||label){openDialog({title:text||label,route:requestedRoute,description:'로컬 데모에서 내용을 확인하거나 입력할 수 있습니다.'})}
  };
  const input=(event:Event)=>{if(!(event.target as HTMLElement).closest('[data-live-root]'))handleDataInput(event,root)};
  const submit=(event:Event)=>{if((event.target as HTMLElement).closest('[data-live-root]'))return;event.preventDefault();const form=event.target as HTMLFormElement;if(!form.reportValidity())return;if(/^\/(ko|en)\/contact-sales(?:\?|$)/.test(requestedRoute)){const values=new FormData(form),submitButton=form.querySelector<HTMLButtonElement>('button[type="submit"]'),originalLabel=submitButton?.textContent||'',locale=requestedRoute.startsWith('/en/')?'en':'ko';void(async()=>{if(submitButton){submitButton.disabled=true;submitButton.textContent=locale==='en'?'Sending…':'접수 중…'}try{const response=await fetch('/api/v1/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({website_url_confirm:values.get('website_url_confirm'),inquiry_type:values.get('field-1'),name:values.get('name'),email:values.get('email'),company:values.get('company'),industry:values.get('field-5'),team_size:values.get('field-6'),phone:values.get('phone'),message:values.get('message'),consent:values.get('field-9')!==null,locale,source_route:`/${locale}/contact-sales`})});const body=await response.json();if(!response.ok)throw new Error(body.error||'문의 접수에 실패했습니다.');form.reset();notify(locale==='en'?'Your inquiry has been received.':'문의가 접수되었습니다. 담당자가 확인 후 연락드리겠습니다.')}catch(cause){notify(cause instanceof Error?cause.message:'문의 접수에 실패했습니다.')}finally{if(submitButton?.isConnected){submitButton.disabled=false;submitButton.textContent=originalLabel}}})();return}if(requestedRoute.startsWith('/app/login')){const email=(form.querySelector('input[name="email"]') as HTMLInputElement|null)?.value.trim()||'';const password=(form.querySelector('input[name="password"]') as HTMLInputElement|null)?.value||'';const submitButton=form.querySelector<HTMLButtonElement>('button[type="submit"]');const originalLabel=submitButton?.textContent||'Sign In';void (async()=>{if(submitButton){submitButton.disabled=true;submitButton.textContent='로그인 중...'}try{const res=await fetch('/api/v1/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});if(res.ok){navigate('/app');return}if(res.status===403){const body=await res.json();if(body.code==='ACCOUNT_DELETION_PENDING'){navigate('/app/restore-account');return}}const message=res.status===401?'이메일 또는 비밀번호가 올바르지 않습니다.':res.status===429?'로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.':res.status===400?'이메일과 비밀번호를 확인해 주세요.':res.status===500?'서버 로그인 설정을 확인해 주세요.':'로그인할 수 없습니다. 잠시 후 다시 시도해 주세요.';notify(message)}catch{notify('로그인할 수 없습니다. 네트워크 상태를 확인해 주세요.')}finally{if(submitButton?.isConnected){submitButton.disabled=false;submitButton.textContent=originalLabel}}})();return}if(requestedRoute.startsWith('/app/signup')){void submitSignup(form,navigate,notify);return}notify('입력 내용을 확인했습니다. 로컬 데모에는 외부로 전송하지 않습니다.')};
  const keydown=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!children&&requestedRoute.startsWith('/app/settings'))navigate('/app')};
  root.addEventListener('click',click);root.addEventListener('input',input);root.addEventListener('submit',submit);document.addEventListener('keydown',keydown);
  return()=>{cleanup();cleanupPublic();cleanupPricing();cleanupLists();cleanupUsage();reveal.disconnect();root.removeEventListener('click',click);root.removeEventListener('input',input);root.removeEventListener('submit',submit);document.removeEventListener('keydown',keydown)};
 },[data,requestedRoute,navigate,notify,openDialog,navigation,children,activeWorkspace.id,blocked,displayMode]);
 const onComplete=(result:DialogResult)=>{if(result.route.split('?')[0]==='/app/workspaces'&&result.record?.name){writeActiveWorkspace({id:result.record.id,name:result.record.name,plan:'Trial',domain:result.values?.domain||''});notify(`'${result.record.name}' 워크스페이스를 생성하고 전환했습니다.`)}else{notify('로컬 데모에 저장했습니다.')}window.dispatchEvent(new CustomEvent('halox:record-created',{detail:result}));void syncDialogActionToBackend(result,activeWorkspace.id);};
 return <><div ref={rootRef} className={'clone-surface '+(requestedRoute.startsWith('/app')?'clone-app':'clone-public')} data-route={requestedRoute}>{content}</div>{requestedRoute.startsWith('/app/login')&&<a className="account-restore-link" href="/app/restore-account">탈퇴한 계정 복원</a>}{/^\/app(\/|$)/.test(requestedRoute)&&!/\/app\/(login|signup|forgot-password|reset-password|restore-account|invite|workspaces|site-content)(\/|$|\?)/.test(requestedRoute)&&<DisplayModeToggle mode={displayMode}/>}{navigation.overlay}<DemoDialog request={dialog} onClose={()=>setDialog(null)} onComplete={onComplete}/>{toast&&<div className="clone-toast" role="status">{toast}<button aria-label="알림 닫기" onClick={()=>setToast('')}>×</button></div>}</>;
}
