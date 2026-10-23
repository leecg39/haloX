import type { LibraryRow } from './library.ts';
export type CreditView = {
  balances: LibraryRow[];
  ledger: LibraryRow[];
  quota: LibraryRow[];
  rewards: LibraryRow[];
  reward_totals: Record<string, { earned: number; reversed: number; paid: number; balance: number }>;
  mutations: 'server_only';
};
export const CREDIT_KIND_LABELS: Record<string, string> = { grant: '적립', consume: '사용', revoke: '회수', restore: '복원' };
export const CREDIT_SOURCE_LABELS: Record<string, string> = { billing: '결제', referral: '추천 보상', support: '고객 지원', usage: '사용량', migration: '이관' };
