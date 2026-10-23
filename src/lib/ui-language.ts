import type { InterfaceLanguage } from './api/general-settings.ts';
import { CAPTURED_UI_ENGLISH } from './ui-language-catalog.ts';

export const normalizeInterfaceLanguage = (value: unknown): InterfaceLanguage => value === 'en' ? 'en' : 'ko';

const EXACT: Record<string, string> = {
  ...CAPTURED_UI_ENGLISH,
  '대시보드': 'Dashboard', '분석': 'Analysis', '전략': 'Strategy', '실행': 'Execution', '모니터링': 'Monitoring', '기타': 'Other',
  '키워드 현황': 'Keywords', '키워드 분석': 'Keyword Analysis', '프롬프트 현황': 'Prompts', '프롬프트 분석': 'Prompt Analysis', 'AI 대화 개요': 'AI Conversation Overview',
  '전략맵': 'Strategy Map', '사이트 진단': 'Site Audit', '콘텐츠 제작소': 'Content Studio', '콘텐츠 최적화': 'Content Optimization', '콘텐츠 내보내기': 'Content Export',
  '모니터링 대시보드': 'Monitoring Dashboard', '주간 리포트': 'Weekly Report', '페르소나': 'Personas', '자료실': 'Knowledge Hub', 'Raw 데이터': 'Raw Data',
  '도움이 필요하신가요?': 'Need help?', 'SEO/GEO 컨설팅': 'SEO/GEO Consulting', '전문가 분석 받기': 'Request Expert Analysis', '서비스 개선 피드백': 'Product Feedback', '의견 남기기': 'Send Feedback',
  '설정': 'Settings', '워크스페이스': 'Workspace', '멤버': 'Members', '일반': 'General', '사용량': 'Usage', '구독/결제': 'Subscription & Billing', '크레딧·보상': 'Credits & Rewards',
  '연동': 'Integrations', '브랜드 트래킹': 'Brand Tracking', '태그': 'Tags', '등록 URL': 'Registered URLs', '내보내기': 'Export', '알림': 'Notifications', '내 프로필': 'My Profile',
  '일반 환경 설정': 'General Settings', '데이터 수집 기본 타겟': 'Default Data Collection Target', '인터페이스 언어': 'Interface Language', '인터페이스 언어 변경': 'Change Interface Language',
  '한국어': 'Korean', '영어': 'English', '분석 언어': 'Analysis Language', '대상 국가': 'Target Country', '프롬프트 자동 생성': 'Automatic Prompt Creation',
  '대한민국': 'South Korea', '미국': 'United States', '일본': 'Japan', '중국': 'China', '켜짐': 'On', '꺼짐': 'Off',
  '수집 기본값 수정': 'Edit Collection Defaults', '수집 기본값 초기화': 'Reset Collection Defaults', '키워드 추가 시 프롬프트 자동 생성': 'Create a prompt when adding a keyword',
  '저장': 'Save', '초기화': 'Reset', '취소': 'Cancel', '삭제': 'Delete', '수정': 'Edit', '추가': 'Add', '생성': 'Create', '등록': 'Register', '확인': 'Confirm', '닫기': 'Close',
  '새로고침': 'Refresh', '검색': 'Search', '전체': 'All', '선택': 'Select', '선택 안 함': 'Not selected', '없음': 'None', '미설정': 'Not set', '미확인': 'Unknown', '미측정': 'Not measured',
  '완료': 'Completed', '실패': 'Failed', '대기 중': 'Pending', '진행 중': 'In progress', '취소됨': 'Cancelled', '활성': 'Active', '비활성': 'Inactive', '일시정지': 'Paused', '추적 중': 'Tracking',
  '읽기 전용': 'Read only', '소유자': 'Owner', '관리자': 'Administrator', '멤버 관리': 'Member Management', '워크스페이스 설정': 'Workspace Settings',
  '키워드': 'Keyword', '질문': 'Prompt', '콘텐츠': 'Content', 'AI 프롬프트': 'AI Prompts',
  '개': 'items', '건': 'records', '총': 'Total', '표본': 'Samples', '근거': 'Evidence', '관리': 'Manage', '문자': 'SMS', '일': 'Day', '연': 'Annual', '월': 'Monthly',
  '기본': 'Default', '현재': 'Current', '감시 규칙': 'Monitoring Rules', '감시 규칙 추가': 'Add Monitoring Rule', '발생 알림': 'Alerts',
  '자사': 'Our Brand', '자사 인용': 'Our Brand Cited', '미실행': 'Not run', '검색 현황': 'Search Overview', '수집 근거': 'Collection Evidence', '본문 진단': 'Content Audit', '저장 분석': 'Saved Analysis',
  '전체 세트': 'All sets', '전체 엔진': 'All engines', '전체 유형': 'All types', '전체 출처': 'All sources', '전체 콘텐츠': 'All content', '전체 클러스터': 'All clusters', '전체 태그': 'All tags',
  '높음': 'High', '보통': 'Normal', '낮음': 'Low', '최신순': 'Newest', '이름순': 'Name', '제목순': 'Title', '전체 상태': 'All statuses', '전체 기간': 'All time',
  '추천 프로그램': 'Referral Program', '피드백': 'Feedback', '추천 코드': 'Referral Codes', '초대·가입 내역': 'Invites & Signups', '보상 내역': 'Reward History',
  '워크스페이스 크레딧': 'Workspace Credits', '크레딧 원장': 'Credit Ledger', '내 추천 보상': 'My Referral Rewards', '결제와 크레딧': 'Billing and Credits',
  '적립': 'Grant', '사용': 'Consume', '회수': 'Revoke', '복원': 'Restore', '결제': 'Billing', '추천 보상': 'Referral Reward', '고객 지원': 'Support', '이관': 'Migration',
  '플랜과 사용량': 'Plan & Usage', '현재 플랜': 'Current Plan', '실시간 사용량': 'Live Usage', '플랜 선택': 'Choose a Plan', '결제 수단': 'Payment Method', '결제 내역': 'Payment History',
  '내 프로필과 보안': 'Profile & Security', '계정 설정': 'Account Settings', '로그아웃': 'Sign out', '워크스페이스 선택': 'Select Workspace',
  '키워드 추가': 'Add Keyword', '프롬프트 추가': 'Add Prompt', '세트 추가': 'Add Set', '아이디어 추가': 'Add Idea', 'CSV 내보내기': 'Export CSV',
  '검색 결과가 없습니다.': 'No search results.', '등록된 항목이 없습니다.': 'No items have been registered.', '조회 실패': 'Could not load data.', '처리 실패': 'Could not complete the request.',
  '권한 다시 확인': 'Check permissions again', '접근 권한이 없습니다': 'Access denied', '권한 확인 중…': 'Checking permissions…', '계정 정보를 확인할 수 없습니다': 'Could not load account information',
  '새 워크스페이스 만들기': 'Create Workspace', '프로필 수정': 'Edit Profile', '역할 변경': 'Change Role', '멤버 초대': 'Invite Member', '초대 링크': 'Invitation Link',
  '오늘': 'Today', '주간': 'Weekly', '월간': 'Monthly', '전체 기능': 'All features', '무료 체험': 'Free trial', '플랜 보기 →': 'View plan →',
  '파일 이력': 'File History', '실행 이력': 'Run History', '진단 이력': 'Audit History', '이벤트 이력': 'Event History', '판단 기록': 'Decision History',
  '연결 관리': 'Manage Links', '공개 URL 가져오기': 'Import Public URL', '원본 JSON 파일': 'Source JSON File', 'ZIP 다운로드': 'Download ZIP',
};

const PHRASES: Array<[string, string]> = [
  ['수집 기본값', 'collection defaults'], ['현재 워크스페이스', 'current workspace'], ['다른 워크스페이스', 'another workspace'], ['모든 멤버', 'all members'],
  ['변경 사항을 저장했습니다.', 'Changes saved.'], ['설정을 불러오는 중…', 'Loading settings…'], ['내역을 불러오는 중…', 'Loading history…'], ['불러오는 중…', 'Loading…'],
  ['워크스페이스를 바꿔도 동일합니다.', 'This stays the same when you switch workspaces.'], ['새로고침해 주세요.', 'Please refresh.'],
  ['입력해 주세요.', 'Please enter a value.'], ['선택해 주세요.', 'Please choose an option.'], ['확인해 주세요.', 'Please check the value.'],
  ['사용할 수 없습니다.', 'is unavailable.'], ['찾을 수 없습니다.', 'could not be found.'], ['지원하지 않습니다.', 'is not supported.'],
  ['조회와 검색을 할 수 있습니다.', 'You can view and search.'], ['수정·실행·다운로드는 제한됩니다.', 'Editing, running, and downloading are restricted.'],
  ['읽기 전용 · ', 'Read only · '], ['개인별', 'per account'], ['계정별', 'per account'], ['서버에서만 변경됩니다.', 'can only be changed by the server.'],
  ['기본값 변경은 워크스페이스 소유자·관리자가 할 수 있습니다.', 'Only workspace owners and administrators can change collection defaults.'],
  ['위 분석 언어는 수집 대상 언어이며 화면 언어와 별개입니다.', 'The analysis language controls collected data and is separate from the interface language.'],
  ['인터페이스 언어는 이 계정의 모든 워크스페이스와 다음 로그인에도 유지됩니다.', 'The interface language applies to this account across every workspace and future sign-ins.'],
  ['한국어·대한민국·자동 생성 켜짐으로 되돌립니다.', 'Resets to Korean, South Korea, and automatic prompt creation on.'],
  ['기존 자료와 다른 워크스페이스 설정은 유지됩니다.', 'Existing data and settings in other workspaces are preserved.'],
  ['이 워크스페이스에서 새 키워드·세트·아이디어·프롬프트를 추가할 때 적용합니다.', 'These defaults apply when new keywords, sets, ideas, and prompts are added in this workspace.'],
  ['기존 항목의 언어와 국가는 바뀌지 않으며 추가 화면에서 개별 선택할 수 있습니다.', 'Existing items keep their language and country, and each new item can override the defaults.'],
  ['새 키워드마다 언어별 문장 규칙으로 GEO 질문 1개를 등록하고 연결합니다.', 'Creates and links one GEO prompt for each new keyword using a language-specific template.'],
  ['같은 문구·언어·국가의 질문은 재사용하며, 새 질문에는 프롬프트 생성 한도 1회를 사용합니다.', 'A matching prompt is reused; a new prompt consumes one prompt creation unit.'],
  ['한도가 부족하면 키워드와 질문을 함께 저장하지 않습니다.', 'If quota is insufficient, neither the keyword nor the prompt is saved.'],
  ['자동 질문은 미분류·미실행 상태입니다.', 'Automatic prompts start unclassified and have not run.'],
  ['프롬프트 화면에서 검토·수정하고 실행하거나 예약 세트에 배치하세요.', 'Review and edit them on the Prompts page, then run them or add them to a scheduled set.'],
  ['설정을 꺼도 기존 질문과 예약은 유지됩니다.', 'Turning this off keeps existing prompts and schedules.'],
  ['수집 기본값을 저장했습니다.', 'Collection defaults saved.'], ['수집 기본값을 초기화했습니다.', 'Collection defaults reset.'], ['인터페이스 언어를 저장했습니다.', 'Interface language saved.'],
  ['AI 답변과 인용 근거를 관리합니다.', 'Manage AI answers and citation evidence.'], ['추가 사용량과 내 추천 정산을 구분하여 표시합니다.', 'Workspace usage credits and personal referral settlements are shown separately.'],
];

const dynamic = (value: string) => value
  .replace(/^(\d+)개$/, '$1 items')
  .replace(/^(\d+)건$/, '$1 records')
  .replace(/^(\d+)명$/, '$1 people')
  .replace(/^(\d+)회$/, '$1 times')
  .replace(/^(\d+)일$/, '$1 days');

export function translateUiText(value: string, language: InterfaceLanguage) {
  if (language !== 'en' || !/[가-힣]/.test(value)) return value;
  const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/); if (!match) return value;
  const [, leading, core, trailing] = match;
  let translated = EXACT[core] || dynamic(core);
  if (translated === core) for (const [from, to] of PHRASES) translated = translated.replaceAll(from, to);
  return `${leading}${translated}${trailing}`;
}
