import type { LibraryRow } from './library.ts';
export type BillingView = {
  configured: boolean;
  mode: 'sandbox' | 'production';
  can_manage: boolean;
  workspace_plan: LibraryRow | null;
  plans: LibraryRow[];
  subscription: LibraryRow | null;
  usage: LibraryRow[];
  methods: LibraryRow[];
  orders: LibraryRow[];
};
export const BILLING_STATUS: Record<string, string> = {
  processing: '결제 처리 중', unknown: '결과 확인 필요', paid: '결제 완료', failed: '결제 실패', cancelling: '취소 처리 중', cancelled: '취소 완료', partialCancelled: '부분 취소',
  registering: '등록 처리 중', active: '사용 가능', expiring: '삭제 처리 중', deleted: '삭제됨',
};
