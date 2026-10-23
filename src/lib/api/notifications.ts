import type { LibraryRow } from './library.ts';
export const NOTIFICATION_EVENTS = { 'monitor.triggered': '감시 조건 충족', 'monitor.resolved': '정상 범위 복구', 'monitor.insufficient': '측정 자료 부족', 'report.ready': '보고서 생성' } as const;
export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;
export const DELIVERY_STATUS: Record<string, string> = { queued: '발송 대기', blocked: '서비스 설정 대기', sending: '발송 요청 중', accepted: '제공사 접수', delivered: '전달 확인', failed: '발송 실패', unknown: '결과 확인 필요', cancelled: '발송 취소' };
export type NotificationPreferences = { revision: number; saved: boolean; inbox: boolean; email: boolean; sms: boolean; events: NotificationEvent[]; rule_ids: string[] };
export type NotificationsView = { preferences: NotificationPreferences; inbox: LibraryRow[]; deliveries: LibraryRow[]; rules: LibraryRow[]; unread: number; configured: { email: boolean; sms: boolean }; contact: { email: string; email_verified: boolean; phone: string; phone_verified: boolean }; can_monitor: boolean };
