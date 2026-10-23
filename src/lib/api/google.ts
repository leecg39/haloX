import type { LibraryRow as Row } from './library';
export type GoogleView = { configured: boolean; editable: boolean; connection: Row | null; jobs: Row[] };
export const GOOGLE_STATUS: Record<string, string> = { connected: '연결됨', disconnected: '연결 안 됨', authorizing: 'Google 동의 대기', reauthorize: '재연결 필요', queued: '대기', running: '수집 중', completed: '완료', failed: '실패', cancelled: '취소' };
