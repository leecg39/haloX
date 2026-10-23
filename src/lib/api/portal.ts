import type { ContentRow } from './content.ts';
export type PortalCollection = 'referral_partners' | 'referral_codes' | 'referral_invites' | 'referral_rewards' | 'portal_requests' | 'feedback_threads' | 'feedback_replies' | 'feedback_events';
export const FEEDBACK_CATEGORIES = { idea: '개선 아이디어', bug: '버그 제보', question: '사용 문의', other: '기타' };
export const FEEDBACK_STATUSES = { open: '접수됨', reviewing: '검토 중', planned: '진행 예정', completed: '완료', declined: '반영 보류' };
export type ReferralData = { partner: ContentRow | null; codes: ContentRow[]; invites: ContentRow[]; rewards: ContentRow[]; totals: Record<string, { earned: number; reversed: number; paid: number }>; settlement_available: false };
export type FeedbackData = { actor: string; can_support: boolean; view: 'mine' | 'support'; threads: ContentRow[]; thread?: ContentRow; replies: ContentRow[]; events: ContentRow[] };
