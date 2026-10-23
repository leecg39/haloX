'use client';

import type { ContentData, ContentRow as Row } from '@/lib/api/content';
import { text } from './LibraryShared';

export function ContentReferences({ data, job }: { data: ContentData; job?: Row }) {
  return <>
    <label>연결 키워드<select aria-label="연결 키워드" name="keyword_id" defaultValue={text(job?.keyword_id)}><option value="">연결 없음</option>{data.keywords.map(row => <option key={row.id} value={row.id}>{text(row.keyword)}</option>)}</select></label>
    <label>연결 프롬프트<select aria-label="연결 프롬프트" name="geo_prompt_id" defaultValue={text(job?.geo_prompt_id)}><option value="">연결 없음</option>{data.geo_prompts.map(row => <option key={row.id} value={row.id}>{text(row.prompt_text)}</option>)}</select></label>
  </>;
}

export function GenerationFields({ data, job }: { data: ContentData; job?: Row }) {
  return <><label>페르소나<select aria-label="페르소나" name="writing_style_profile_id" defaultValue={text(job?.writing_style_profile_id ?? data.writing_style_profiles.find(row => row.is_default)?.id)}><option value="">사용 안 함</option>{data.writing_style_profiles.map(row => <option key={row.id} value={row.id}>{text(row.name)}</option>)}</select></label><div><p>참조 자료</p><div className="live-checks">{data.knowledge_entities.map(row => <label key={row.id} className="check"><input type="checkbox" name="knowledge_entity_ids" value={row.id} defaultChecked={Array.isArray(job?.knowledge_entity_ids) && job.knowledge_entity_ids.includes(row.id)} />{text(row.name)}</label>)}</div>{!data.knowledge_entities.length && <small>지식허브에서 자료를 추가할 수 있습니다.</small>}</div></>;
}

