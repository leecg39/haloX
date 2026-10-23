'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { DemoDialog } from './DemoDialog';
import type { DialogRequest, DialogResult } from '@/types/clone';
import { deleteTableRows, fetchTable, syncDialogActionToBackend } from '@/lib/api/client';
import {
  DEFAULT_WORKSPACE_INFO,
  readActiveWorkspace,
  writeActiveWorkspace,
} from './CloneNavigation';

interface WorkspaceItem {
  id: string;
  name: string;
  slug?: string;
  domain?: string;
  description?: string;
  plan: string;
  isDefault?: boolean;
}

const STORAGE_KEY = 'halox-clone:records:/app/workspaces';

export function Workspaces() {
  const router = useRouter();
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const [activeWsName, setActiveWsName] = useState<string>(DEFAULT_WORKSPACE_INFO.name);
  const [items, setItems] = useState<WorkspaceItem[]>([
    {
      id: '11111111-1111-4000-8000-111111111111',
      name: '브리찌',
      slug: 'brizzi',
      domain: 'brizzi.kr',
      description: '기본 브랜드 워크스페이스',
      plan: 'Trial',
      isDefault: true,
    },
  ]);
  const [showInlineForm, setShowInlineForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    let active = true;
    setActiveWsName(readActiveWorkspace().name);
    const onWsChanged = () => {
      if (active) setActiveWsName(readActiveWorkspace().name);
    };
    window.addEventListener('halox:workspace-changed', onWsChanged);
    const load = async () => {
      const localRaw: Array<{ id?: string; name: string; domain?: string; description?: string }> = (() => {
        try {
          return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        } catch {
          return [];
        }
      })();

      let serverRows: Array<{ id: string; name: string; slug?: string; default_brand_filter?: string }> = [];
      try {
        serverRows = await fetchTable('workspaces');
      } catch {
        serverRows = [];
      }

      if (!active) return;

      const merged = new Map<string, WorkspaceItem>();
      merged.set('브리찌', {
        id: '11111111-1111-4000-8000-111111111111',
        name: '브리찌',
        slug: 'brizzi',
        domain: 'brizzi.kr',
        description: '기본 브랜드 워크스페이스',
        plan: 'Trial',
        isDefault: true,
      });

      for (const row of serverRows) {
        if (!row.name || row.name === '외부격리워크스페이스') continue;
        merged.set(row.name, {
          id: row.id,
          name: row.name,
          slug: row.slug,
          domain: row.default_brand_filter || 'brizzi.kr',
          plan: 'Trial',
          isDefault: row.name === '브리찌',
        });
      }

      for (const local of localRaw) {
        if (!local.name) continue;
        merged.set(local.name, {
          id: local.id || crypto.randomUUID(),
          name: local.name,
          domain: local.domain || '',
          description: local.description || '',
          plan: 'Trial',
          isDefault: local.name === '브리찌',
        });
      }

      setItems([...merged.values()]);
    };
    void load();
    return () => {
      active = false;
      window.removeEventListener('halox:workspace-changed', onWsChanged);
    };
  }, []);

  const handleSelectWorkspace = (item: WorkspaceItem) => {
    writeActiveWorkspace({
      id: item.id,
      name: item.name,
      plan: item.plan || 'Trial',
      domain: item.domain || '',
    });
    setActiveWsName(item.name);
    router.push('/app');
  };

  const persistWorkspace = async (name: string, domain = '', description = '') => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = crypto.randomUUID();
    const record = {
      id,
      name: trimmed,
      domain: domain.trim(),
      description: description.trim(),
      createdAt: new Date().toISOString(),
      kind: '새 워크스페이스 만들기',
    };

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      const next = Array.isArray(saved) ? [...saved, record] : [record];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }

    setItems(prev => {
      if (prev.some(item => item.name === trimmed)) return prev;
      return [
        ...prev,
        {
          id,
          name: trimmed,
          domain: domain.trim(),
          description: description.trim(),
          plan: 'Trial',
          isDefault: false,
        },
      ];
    });

    try {
      await fetch('/api/v1/rest/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: trimmed,
          default_brand_filter: domain.trim() || trimmed,
        }),
      });
    } catch {
      // Offline fallback remains stored in localStorage
    }

    setStatusMessage(`"${trimmed}" 워크스페이스가 생성되었습니다.`);
  };

  const handleInlineSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newName.trim()) return;
    await persistWorkspace(newName, newDomain, newDesc);
    setNewName('');
    setNewDomain('');
    setNewDesc('');
    setShowInlineForm(false);
  };

  const handleDialogComplete = (result: DialogResult) => {
    if (result.record?.name) {
      const domain = result.values?.domain || '';
      const description = result.values?.description || '';
      setItems(prev => {
        if (prev.some(item => item.name === result.record!.name)) return prev;
        return [
          ...prev,
          {
            id: result.record!.id,
            name: result.record!.name,
            domain,
            description,
            plan: 'Trial',
            isDefault: false,
          },
        ];
      });
      setStatusMessage(`"${result.record.name}" 워크스페이스가 생성되었습니다.`);
    }
    void syncDialogActionToBackend(result);
  };

  const handleDelete = async (target: WorkspaceItem) => {
    if (target.isDefault) return;
    setItems(prev => prev.filter(item => item.id !== target.id && item.name !== target.name));
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(saved.filter((x: { id?: string; name?: string }) => x.id !== target.id && x.name !== target.name))
        );
      }
    } catch {
      // Ignore storage error
    }
    try {
      await deleteTableRows('workspaces', { id: `eq.${target.id}` });
    } catch {
      // Ignore offline error
    }
    setStatusMessage(`"${target.name}" 워크스페이스를 삭제했습니다.`);
  };

  return (
    <main
      className="clone-surface"
      data-route="/app/workspaces"
      style={{ maxWidth: 960, margin: '0 auto', padding: '64px 24px' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold mb-2">내 워크스페이스</h1>
          <p className="text-muted-foreground">작업할 워크스페이스를 선택하거나 새 워크스페이스를 생성하세요</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="border rounded-md px-4 py-2 text-sm font-medium"
            style={{ background: '#ffffff', color: '#1f1f1f', borderColor: '#d4d4d4' }}
            onClick={() => setShowInlineForm(prev => !prev)}
          >
            {showInlineForm ? '인라인 폼 닫기' : '빠른 생성 폼 열기'}
          </button>
          <button
            type="button"
            className="bg-foreground text-background rounded-md px-4 py-2 text-sm font-medium"
            style={{ background: '#1f1f1f', color: '#ffffff' }}
            onClick={() =>
              setRequest({
                title: '새 워크스페이스 만들기',
                route: '/app/workspaces',
                description: '새로 관리할 브랜드 또는 프로젝트의 워크스페이스 정보를 입력하세요.',
              })
            }
          >
            + 새 워크스페이스 만들기
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          role="status"
          className="mb-6 rounded-lg border px-4 py-3 text-sm flex items-center justify-between"
          style={{ background: '#f8fafc', borderColor: '#cbd5e1', color: '#0f172a' }}
        >
          <span>{statusMessage}</span>
          <button
            type="button"
            onClick={() => setStatusMessage('')}
            style={{ border: 0, background: 'none', cursor: 'pointer', fontWeight: 600 }}
            aria-label="알림 닫기"
          >
            ×
          </button>
        </div>
      )}

      {showInlineForm && (
        <section
          className="border rounded-xl p-6 mb-6"
          style={{ background: '#fafafa', borderColor: '#e5e5e5' }}
        >
          <h2 className="text-base font-semibold mb-4">새 워크스페이스 만들기</h2>
          <form onSubmit={handleInlineSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span>워크스페이스 이름 *</span>
                <input
                  type="text"
                  name="workspaceName"
                  required
                  placeholder="예: 브리찌 글로벌"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="border rounded-md px-3 py-2 text-sm"
                  style={{ background: '#ffffff', borderColor: '#d4d4d4' }}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span>대표 도메인 (선택)</span>
                <input
                  type="text"
                  name="workspaceDomain"
                  placeholder="예: brizzi.kr"
                  value={newDomain}
                  onChange={e => setNewDomain(e.target.value)}
                  className="border rounded-md px-3 py-2 text-sm"
                  style={{ background: '#ffffff', borderColor: '#d4d4d4' }}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              <span>설명 (선택)</span>
              <input
                type="text"
                name="workspaceDescription"
                placeholder="워크스페이스 용도나 브랜드 설명을 입력하세요"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                className="border rounded-md px-3 py-2 text-sm"
                style={{ background: '#ffffff', borderColor: '#d4d4d4' }}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowInlineForm(false)}
                className="border rounded-md px-4 py-2 text-sm font-medium"
                style={{ background: '#ffffff', color: '#1f1f1f', borderColor: '#d4d4d4' }}
              >
                취소
              </button>
              <button
                type="submit"
                className="rounded-md px-4 py-2 text-sm font-medium"
                style={{ background: '#1f1f1f', color: '#ffffff', border: '1px solid #1f1f1f' }}
              >
                워크스페이스 생성
              </button>
            </div>
          </form>
        </section>
      )}

      {items.map((item, index) => {
        const isCurrent = item.name === activeWsName;
        return (
          <section
            key={item.id + index}
            className="border rounded-xl p-6 mb-4"
            style={isCurrent ? { borderColor: '#1f1f1f', borderWidth: 2 } : undefined}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <a
                href="/app"
                onClick={e => {
                  e.preventDefault();
                  handleSelectWorkspace(item);
                }}
                className="flex items-center gap-3"
              >
                <h2 className="text-lg font-semibold">{item.name}</h2>
                <span className="text-xs text-muted-foreground rounded-full bg-muted px-2 py-1">
                  {item.plan}
                </span>
                {isCurrent && (
                  <span
                    className="text-xs font-medium rounded-full px-2.5 py-0.5"
                    style={{ background: '#1f1f1f', color: '#ffffff' }}
                  >
                    현재 선택됨
                  </span>
                )}
                {item.domain && (
                  <span className="text-xs text-muted-foreground">{item.domain}</span>
                )}
              </a>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSelectWorkspace(item)}
                  className="text-sm border rounded-md px-3 py-1.5"
                  style={{ background: '#1f1f1f', color: '#ffffff', borderColor: '#1f1f1f' }}
                >
                  {isCurrent ? '대시보드로 이동' : '이 워크스페이스 선택'}
                </button>
                <a
                  className="text-sm border rounded-md px-3 py-1.5 inline-block"
                  href="/app/settings?tab=workspace"
                >
                  상세 설정
                </a>
                {!item.isDefault && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(item)}
                    className="text-sm border rounded-md px-3 py-1.5"
                    style={{ color: '#b42318', borderColor: '#f4b4ad', background: '#fff' }}
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>
            {item.description && (
              <p className="text-sm text-muted-foreground mt-2">{item.description}</p>
            )}
            <div className="grid grid-cols-3 gap-4 my-6">
              {[
                [index === 0 ? '10/20' : '0/20', '키워드'],
                [index === 0 ? '10/20' : '0/20', 'AI Questions'],
                [index === 0 ? '0/1' : '0/5', '콘텐츠'],
              ].map(([value, label]) => (
                <div key={label}>
                  <strong className="text-xl">{value}</strong>
                  <p className="text-sm text-muted-foreground mt-1">{label}</p>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <DemoDialog
        request={request}
        onClose={() => setRequest(null)}
        onComplete={handleDialogComplete}
      />
    </main>
  );
}
