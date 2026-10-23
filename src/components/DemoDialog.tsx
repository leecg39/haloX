'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import parse, { attributesToProps, domToReact, Element, type DOMNode, type HTMLReactParserOptions } from 'html-react-parser';
import { Button } from '@/components/ui/button';
import type { DialogRequest, DialogResult, LocalRecord } from '@/types/clone';
import './demo-dialog.css';

type Props = { request: DialogRequest | null; onClose: () => void; onComplete: (result: DialogResult) => void };
type SessionProps = Omit<Props, 'request'> & { request: DialogRequest };
const suggestions = ['AI 마케팅', '브랜드 마케팅', '콘텐츠 전략'];
const textOf = (node: DOMNode): string => 'data' in node ? node.data : 'children' in node ? node.children.map(child => textOf(child as DOMNode)).join('') : '';
const storageKey = (route: string) => `halox-clone:records:${route.split('?')[0].replace(/\/$/, '') || '/'}`;
const readRecords = (route: string): LocalRecord[] => { try { const value = JSON.parse(localStorage.getItem(storageKey(route)) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };

export function DemoDialog({ request, ...props }: Props) {
  return request ? <DialogSession key={`${request.route}:${request.title}`} request={request} {...props} /> : null;
}

function DialogSession({ request, onClose, onComplete }: SessionProps) {
  const overlay = useRef<HTMLDivElement>(null), submitted = useRef(false);
  const [mode, setMode] = useState('single'), [values, setValues] = useState<Record<string, string>>({}), [error, setError] = useState('');
  const [templateActive,setTemplateActive]=useState(true);
  const [knowledge, setKnowledge] = useState(false), [records, setRecords] = useState<LocalRecord[]>([]);
  const deleting = /삭제|delete/i.test(request.title), keyword = /키워드/.test(request.title), prompt = /프롬프트/.test(request.title);
  const email = /초대|이메일/.test(request.title), url = /URL|자료|진단|최적화/i.test(request.title), feedback = /피드백/.test(request.title);
  const nameLabel = email ? '이메일' : url ? 'URL' : feedback ? '제목' : keyword ? '키워드' : prompt ? '프롬프트' : '이름';
  const update = (key: string, value: string) => { setValues(previous => ({ ...previous, [key]: value })); setError(''); };
  useEffect(() => {
    setRecords(readRecords(request.route));
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => overlay.current?.querySelector<HTMLElement>('input:not([type="hidden"]),textarea,select,button,[role="dialog"]')?.focus(), 30);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(overlay.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]') || []).filter(element => element.getClientRects().length && !element.closest('[hidden]'));
      const first = elements[0], last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !overlay.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { clearTimeout(timer); document.removeEventListener('keydown', keydown); document.body.style.overflow = overflow; previous?.focus(); };
  }, [request.route, onClose]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitted.current) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data: Record<string, string> = {};
    for (const field of Array.from(form.elements)) if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) && field.name && field.type !== 'password' && !field.closest('[hidden]')) data[field.name] = field.value.trim();
    Object.keys(data).forEach(key => { if (/password|token|secret/i.test(key)) delete data[key]; });
    const name = data.name || data.keyword || data['prompt-text'] || data.email || data.url || Object.values(data).find(value => value.trim()) || '';
    if (!name && !deleting) { setError(`${nameLabel}을(를) 입력해 주세요.`); return; }
    const saved = readRecords(request.route);
    try {
      if (deleting) {
        if (!data.recordId || !saved.some(record => record.id === data.recordId)) { setError('삭제할 로컬 항목을 선택해 주세요.'); return; }
        localStorage.setItem(storageKey(request.route), JSON.stringify(saved.filter(record => record.id !== data.recordId)));
        submitted.current = true; onComplete({ title: request.title, route: request.route, values: { deletedId: data.recordId } });
      } else {
        const names = mode === 'bulk' ? name.split(/\n/).map(value => value.trim()).filter(Boolean) : [name];
        const firstId = crypto.randomUUID();
        if (/API/.test(request.title)) data.demoKey = `demo-local-${firstId.slice(0, 8)}`;
        const created = names.map((item, index) => ({ ...data, id: index === 0 ? firstId : crypto.randomUUID(), name: item, createdAt: new Date().toISOString(), kind: request.kind || request.title }));
        localStorage.setItem(storageKey(request.route), JSON.stringify([...saved, ...created]));
        submitted.current = true; onComplete({ title: request.title, route: request.route, values: { ...data, count: String(created.length) }, record: created[0], records: created });
      }
      onClose();
    } catch { if (submitted.current) { onClose(); return; } setError('로컬 저장 공간을 사용할 수 없습니다. 브라우저 설정을 확인해 주세요.'); }
  }

  function entryField(label = nameLabel, key = 'name', multiline = mode === 'bulk' || prompt) {
    return <label className="hx-demo-field">{label}{multiline ? <textarea name={key} value={values[key] || ''} onChange={event => update(key, event.target.value)} placeholder={mode === 'bulk' ? '한 줄에 하나씩 입력하세요' : `${label} 입력`} required rows={mode === 'bulk' ? 5 : 3} /> : <input name={key} value={values[key] || ''} onChange={event => update(key, event.target.value)} type={email ? 'email' : url ? 'url' : 'text'} placeholder={url ? 'https://example.com' : `${label} 입력`} required />}</label>;
  }
  const recommendation = <div className="hx-demo-recommend"><p>로컬 데모 추천 키워드</p>{suggestions.map(value => <button type="button" key={value} onClick={() => update('name', value)} aria-pressed={values.name === value}>{value}</button>)}{entryField()}</div>;
  const options: HTMLReactParserOptions = { replace(node) {
    if (!(node instanceof Element)) return;
    const attrs = node.attribs, props = attributesToProps(attrs), text = textOf(node).trim(), children = () => domToReact(node.children as DOMNode[], options);
    if (attrs.role === 'dialog') return <div {...props} role="dialog" aria-modal="true" className={`${attrs.class || ''} hx-demo-dialog`} tabIndex={-1}>{children()}</div>;
    if (node.name === 'form') return <form {...props} onSubmit={submit}>{children()}</form>;
    if (attrs.role === 'tab') { const selected = /일괄/.test(text) ? 'bulk' : /추천/.test(text) ? 'recommend' : 'single'; return <button {...props} type="button" onClick={() => setMode(selected)} aria-selected={mode === selected} data-state={mode === selected ? 'active' : 'inactive'} tabIndex={0}>{children()}</button>; }
    if (attrs.role === 'tabpanel') {
      const panelMode = attrs.id?.includes('bulk') ? 'bulk' : attrs.id?.includes('recommend') ? 'recommend' : 'single';
      if(mode!==panelMode)return <div {...props} hidden />;
      return <div {...props} hidden={mode !== panelMode} data-state={mode === panelMode ? 'active' : 'inactive'}>{panelMode === 'bulk' ? entryField('키워드', 'name', true) : panelMode === 'recommend' ? recommendation : children()}</div>;
    }
    if (node.name === 'button' && attrs.role === 'combobox') {
      const sibling = node.nextSibling, select = sibling instanceof Element && sibling.name === 'select' ? sibling : null;
      const choices = select?.children.filter((child): child is Element => child instanceof Element && child.name === 'option') || [];
      const selected = choices.find(choice => 'selected' in choice.attribs) || choices[0], key = choices.some(choice => choice.attribs.value === 'ko') ? 'language' : 'country';
      return <select className={`${attrs.class || ''} hx-demo-select`} name={key} aria-label={key === 'language' ? '언어' : '국가'} value={values[key] || selected?.attribs.value || ''} onChange={event => update(key, event.target.value)}>{choices.length ? choices.map(choice => <option key={choice.attribs.value} value={choice.attribs.value}>{textOf(choice)}</option>) : <><option>{text || '선택'}</option><option>로컬 데모</option></>}</select>;
    }
    if (node.name === 'select' && attrs['aria-hidden'] === 'true') return <></>;
    if (node.name === 'input' || node.name === 'textarea') {
      const key = attrs.name || attrs.id || (attrs.placeholder?.includes('검색') ? 'search' : 'name'), isSearch = /검색|필터/.test(attrs.placeholder || ''), inputProps = { ...props, name: key, value: values[key] || '', onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(key, event.target.value), required: !isSearch && attrs.type !== 'checkbox' && (attrs.required!==undefined || key==='name' || key==='keyword' || node.name==='textarea'&&prompt) };
      if (attrs.type === 'password') return <input {...props} autoComplete="off" />;
      return node.name === 'textarea' ? <textarea {...inputProps} /> : <input {...inputProps} />;
    }
    if (node.name === 'button') {
      if (attrs.type === 'submit' || /^(저장|등록|추가|만들기|진단 시작|작성 완료|피드백 등록|피드백 제출|엔티티 추가|시작하기|프롬프트 추가|다음: 수집 범위)$/.test(text)) return <button {...props} type="submit" disabled={false}>{children()}</button>;
      if (/^(취소|닫기|Close)$/.test(text)) return <button {...props} type="button" onClick={onClose}>{children()}</button>;
      if (text === '수정') return <button {...props} type="button" aria-expanded={knowledge} onClick={() => setKnowledge(!knowledge)}>{children()}</button>;
      if (/콘텐츠/.test(request.title)&&!request.template?.includes('<input')) return <button {...props} type="button" onClick={()=>{update('source',text);setTemplateActive(false)}}>{children()}</button>;
      if (attrs.title === '새로 만들기') return <button {...props} type="button" onClick={() => setError('자료실에서 로컬 자료를 추가한 후 연결할 수 있습니다.')}>{children()}</button>;
    }
    if (attrs.class?.includes('max-h-0')) return <div {...props} className={attrs.class.replace('max-h-0', '').replace('opacity-0', '')} hidden={!knowledge}>{children()}</div>;
    if (attrs.class?.includes('animate-spin')) return <span className="hx-demo-empty">연결할 로컬 자료가 없습니다.</span>;
  } };

  return <div ref={overlay} className="hx-demo-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    {request.template && templateActive && !deleting ? (request.template.includes('<form')?parse(request.template, options):<form style={{display:'contents'}} onSubmit={submit}>{parse(request.template,options)}</form>) : <section className="hx-demo-dialog hx-demo-generic" role="dialog" aria-modal="true" aria-labelledby="hx-demo-title" tabIndex={-1}>
      <header><h2 id="hx-demo-title">{request.title}</h2><p>{request.description || (deleting ? '이 브라우저에 저장된 로컬 항목만 삭제됩니다.' : '입력한 정보는 이 브라우저의 로컬 데모에 저장됩니다.')}</p><button type="button" className="hx-demo-close" aria-label="닫기" onClick={onClose}>×</button></header>
      <form onSubmit={submit}><div className="hx-demo-body">
        {(keyword || prompt) && !deleting && <div className="hx-demo-tabs" role="tablist">{[['single', '단일'], ['bulk', '일괄'], ['recommend', '추천']].map(([id, label]) => <button role="tab" type="button" key={id} aria-selected={mode === id} onClick={() => setMode(id)}>{label}</button>)}</div>}
        {deleting ? <label className="hx-demo-field">삭제할 항목<select name="recordId" required defaultValue=""><option value="" disabled>항목 선택</option>{records.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}</select>{!records.length && <small>삭제할 로컬 항목이 없습니다.</small>}</label> : mode === 'recommend' ? recommendation : entryField()}
        {!deleting && !keyword && !prompt && !email && <label className="hx-demo-field">{feedback ? '내용' : '설명'}<textarea name="description" rows={4} placeholder={feedback ? '피드백을 작성해 주세요' : '설명을 입력하세요'} required={feedback} value={values.description || ''} onChange={event => update('description', event.target.value)} /></label>}
      </div><footer><p>로컬 데모 · 실제 결제, 전송, 크레딧 차감 없음</p><div><Button variant="outline" type="button" onClick={onClose}>취소</Button><Button type="submit" disabled={deleting && !records.length}>{deleting ? '로컬 항목 삭제' : '로컬 저장'}</Button></div></footer></form>
    </section>}
    <div className="hx-demo-status" role={error ? 'alert' : 'status'}>{error || '로컬 데모 · 입력은 이 브라우저에만 저장되며 실제 크레딧은 차감되지 않습니다.'}</div>
  </div>;
}
