'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { deleteTableRows, insertTableRows, updateTableRows } from '@/lib/api/client';
import { readActiveWorkspace, writeActiveWorkspace } from './CloneNavigation';

interface Workspace { id: string; name: string; description?: string; default_brand_filter?: string; owner_id: string }
interface Membership { workspace_id: string; user_id: string; role: string }
interface Plan { workspace_id: string; plan: string }
interface ScopedRow { workspace_id: string }

const buttonClass = 'rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50';
const inputClass = 'rounded-md border bg-background px-3 py-2 text-sm';

export function Workspaces() {
  const router = useRouter();
  const [items, setItems] = useState<Workspace[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [counts, setCounts] = useState<ScopedRow[][]>([[], [], []]);
  const [userId, setUserId] = useState('');
  const [activeId, setActiveId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [editor, setEditor] = useState<Workspace | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Workspace | null>(null);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    const auth = await fetch('/api/v1/workspaces');
    if (auth.status === 401) { router.replace('/app/login'); return; }
    if (!auth.ok) throw new Error('워크스페이스를 불러오지 못했습니다. 다시 시도해 주세요.');
    const { user_id, workspaces, members: membershipRows, plans: planRows, counts: totals } = await auth.json() as { user_id: string; workspaces: Workspace[]; members: Membership[]; plans: Plan[]; counts: ScopedRow[][] };
    setUserId(user_id);
    setItems(workspaces); setMembers(membershipRows); setPlans(planRows); setCounts(totals);
    const current = readActiveWorkspace();
    const selected = workspaces.find(row => row.id === current.id) || workspaces[0];
    setActiveId(selected?.id || '');
    writeActiveWorkspace(selected ? { id: selected.id, name: selected.name, plan: planRows.find(plan => plan.workspace_id === selected.id)?.plan || 'Trial', domain: selected.default_brand_filter || '' } : { id: '', name: '워크스페이스 선택', plan: '' });
  }, [router]);

  useEffect(() => {
    void load().catch(err => setError(err.message)).finally(() => setLoading(false));
    if (new URLSearchParams(window.location.search).get('create') === '1') setEditor('new');
  }, [load]);

  function edit(item: Workspace | 'new') {
    setError(''); setStatus(''); setEditor(item);
    setName(item === 'new' ? '' : item.name);
    setDomain(item === 'new' ? '' : item.default_brand_filter || '');
    setDescription(item === 'new' ? '' : item.description || '');
  }

  function select(item: Workspace, settings = false) {
    writeActiveWorkspace({ id: item.id, name: item.name, plan: plans.find(plan => plan.workspace_id === item.id)?.plan || 'Trial', domain: item.default_brand_filter || '' });
    setActiveId(item.id);
    router.push(settings ? '/app/settings?tab=workspace' : '/app');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !editor || !name.trim()) return;
    setBusy(true); setError('');
    try {
      const payload = { name: name.trim(), default_brand_filter: domain.trim(), description: description.trim() };
      const rows = editor === 'new' ? await insertTableRows<Workspace>('workspaces', payload) : await updateTableRows<Workspace>('workspaces', payload, { id: `eq.${editor.id}` });
      if (rows.length !== 1) throw new Error('항목이 변경되었거나 삭제되었습니다. 목록을 다시 확인해 주세요.');
      setEditor(null);
      await load();
      setStatus(`“${rows[0].name}” 워크스페이스를 저장했습니다.`);
    } catch (err) { setError(err instanceof Error ? err.message : '저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!deleting || busy) return;
    setBusy(true); setError('');
    try {
      const rows = await deleteTableRows<Workspace>('workspaces', { id: `eq.${deleting.id}` });
      if (rows.length !== 1) throw new Error('항목이 변경되었거나 삭제되었습니다.');
      setDeleting(null);
      await load();
      setStatus(`“${rows[0].name}” 워크스페이스를 삭제했습니다.`);
    } catch (err) { setError(err instanceof Error ? err.message : '삭제하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  return <main className="clone-surface mx-auto max-w-5xl px-6 py-16" data-route="/app/workspaces">
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="mb-2 text-2xl font-semibold">내 워크스페이스</h1><p className="text-muted-foreground">관리할 브랜드 또는 프로젝트를 선택하세요.</p></div>
      <button type="button" className={`${buttonClass} bg-foreground text-background`} onClick={() => edit('new')} disabled={loading}>+ 새 워크스페이스 만들기</button>
    </div>
    {status && <p role="status" className="mb-6 rounded-lg border p-4 text-sm">{status}</p>}
    {error && !editor && !deleting && <div role="alert" className="mb-6 text-sm text-red-600">{error} <button className={buttonClass} onClick={() => { setError(''); void load().catch(err => setError(err.message)); }}>다시 불러오기</button></div>}
    {loading && <p role="status">워크스페이스를 불러오는 중입니다…</p>}
    {!loading && !error && !items.length && <p className="rounded-xl border p-8 text-muted-foreground">워크스페이스가 없습니다. 새 워크스페이스를 만들어 시작하세요.</p>}
    {items.map(item => {
      const role = members.find(member => member.workspace_id === item.id && member.user_id === userId)?.role;
      return <section key={item.id} className={`mb-4 rounded-xl border p-6 ${activeId === item.id ? 'border-foreground' : ''}`} aria-label={item.name}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><h2 className="text-lg font-semibold">{item.name}</h2><p className="mt-1 text-sm text-muted-foreground">{item.default_brand_filter} · {plans.find(plan => plan.workspace_id === item.id)?.plan || 'Trial'}{activeId === item.id ? ' · 현재 선택됨' : ''}</p></div>
          <div className="flex flex-wrap gap-2">
            <button className={`${buttonClass} bg-foreground text-background`} onClick={() => select(item)}>{activeId === item.id ? '대시보드로 이동' : '이 워크스페이스 선택'}</button>
            {(role === 'owner' || role === 'admin') && <button className={buttonClass} onClick={() => edit(item)}>수정</button>}
            <button className={buttonClass} onClick={() => select(item, true)}>상세 설정</button>
            {role === 'owner' && <button className={`${buttonClass} text-red-600`} onClick={() => { setError(''); setDeleting(item); }}>삭제</button>}
          </div>
        </div>
        {item.description && <p className="mt-3 text-sm text-muted-foreground">{item.description}</p>}
        <dl className="mt-6 grid grid-cols-3 gap-4">{['키워드', 'AI Questions', '콘텐츠'].map((label, i) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold">{counts[i].filter(row => row.workspace_id === item.id).length}</dd></div>)}</dl>
      </section>;
    })}
    <Dialog.Root open={!!editor || !!deleting} onOpenChange={open => { if (!open && !busy) { setEditor(null); setDeleting(null); setError(''); } }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-6 shadow-xl">
        <Dialog.Title className="mb-2 text-lg font-semibold">{deleting ? '워크스페이스 삭제' : editor === 'new' ? '새 워크스페이스 만들기' : '워크스페이스 수정'}</Dialog.Title>
        <Dialog.Description className="mb-5 text-sm text-muted-foreground">{deleting ? `“${deleting.name}”와 연결된 데이터가 모두 삭제됩니다. 삭제 후 복구할 수 없습니다.` : '워크스페이스 이름과 브랜드 정보를 입력하세요.'}</Dialog.Description>
        {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
        {deleting ? <div className="flex justify-end gap-2"><Dialog.Close className={buttonClass} disabled={busy}>취소</Dialog.Close><button className={`${buttonClass} bg-red-600 text-white`} disabled={busy} onClick={() => void remove()}>{busy ? '삭제 중…' : '삭제 확인'}</button></div> : <form onSubmit={save} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm">워크스페이스 이름<input autoFocus required maxLength={100} className={inputClass} value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="flex flex-col gap-2 text-sm">대표 도메인 (선택)<input maxLength={253} className={inputClass} placeholder="example.com" value={domain} onChange={e => setDomain(e.target.value)} /></label>
          <label className="flex flex-col gap-2 text-sm">설명 (선택)<textarea maxLength={2000} className={inputClass} value={description} onChange={e => setDescription(e.target.value)} /></label>
          <div className="flex justify-end gap-2"><Dialog.Close type="button" className={buttonClass} disabled={busy}>취소</Dialog.Close><button type="submit" className={`${buttonClass} bg-foreground text-background`} disabled={busy}>{busy ? '저장 중…' : '저장'}</button></div>
        </form>}
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </main>;
}
