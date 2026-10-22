from pathlib import Path
import json, re
from urllib.parse import urlsplit
from collections import defaultdict, Counter

ROOT=Path('/Users/user01/Desktop/haloX/docs')
SRC=ROOT/'sources'
def read(n): return json.loads((SRC/n).read_text())
def clean(s): return re.sub(r'\s+', ' ', str(s)).strip().replace('|','\\|')
def link(url, label=None):
 parts=urlsplit(url)
 shown=label or ((parts.path or '/')+('?' + parts.query if parts.query else '')+('#'+parts.fragment if parts.fragment else ''))
 return f'[{clean(shown)}]({url})'
def bullets(items): return '\n'.join('- '+x for x in items)

pages=[
('공통','대시보드','/app','app-dashboard.json','검색과 AI 가시성의 종합 현황을 확인하는 시작 화면.',[
'종합 지표: AVI 종합 점수, GEO 점수, SEO 점수, 웹 건강도.',
'GEO 세부 지표: 인용률, 멘션율, 인용 순위, 멘션 순위.',
'SEO 세부 지표: 평균 순위, Top10 비율, AIO 인용률.',
'현황 탭: 키워드 상위, AI 질문 상위, 사이트 진단, 주요 변화 Top 4, 키워드 상태 현황.',
'바로가기: 검색 성과 분석, AI 대화 분석, 기회 분석, 리포트.']),
('분석','키워드 현황','/app/keywords','_app_keywords.json','등록된 SEO 키워드를 확인하고 관리하는 화면.',[
'현황 카드: Top 10 키워드, AI 요약 인용, 자사 순위, 평균 순위.',
'필터·보기: 세트, 언어, 자사·경쟁사, 인텐트, 진행상태, 정렬, 세트별 묶기.',
'주요 기능: 키워드 추가, Raw 데이터, 태그, 행 액션, 키워드 검색.',
'네트워크 내부 선택 항목: 상태·내 순위·인텐트, 그룹 표시(끔·주제 그룹·인텐트), 1차·2차, 리스트·상세·설명.',
'아이디어 탭의 화면 제목: 키워드 발굴.']),
('분석','키워드 분석','/app/seo/insights','_app_seo_insights.json','검색 순위, AI 요약 인용, 자사 점유율을 분석하는 화면.',[
'개요: 검색 엔진 노출 비교, 검색 엔진별 추이, Top 키워드 순위 흐름, 키워드 순위 요약, 순위 변동 TOP.',
'비교 엔진: Google SERP, Google AIO.',
'필터: 언어, 국가, 기간 시작 전 생성분, 세트, 태그, 집계 주기와 기간.',
'성과 탭에서 개별 키워드 상세 페이지로 이동 가능.']),
('분석','프롬프트 현황','/app/geo/prompts','_app_geo_prompts.json','AI 응답에서 브랜드 노출을 확인하고 프롬프트를 관리하는 화면.',[
'지표: 멘션율, 소스율, 인용률, 멘션 순위, 멘션 점유율, 소스 점유율, 인용 점유율, 인용 순위.',
'엔진 열: ChatGPT, Gemini, Pplx(Perplexity), Claude.',
'필터·보기: 기간 시작 전 생성분, 세트, 태그, 전체 엔진, 경쟁 상태, 자사·경쟁사 범위, 세트별 묶기.',
'주요 기능: Raw, 설정, 추가, 퍼널 현황.']),
('분석','프롬프트 분석','/app/geo/analysis','_app_geo_analysis.json','AI 답변의 자사 노출도와 경쟁사를 비교하는 화면.',[
'개요: 엔진별 노출 비교, 세트·태그별 노출 비교와 추이.',
'인용 소스: 도메인 등장(Unique), 인용 건수(Total), 인용 상세, 인용 상위 도메인; 인용·소스와 율·점유율 기준 선택.',
'플랫폼: 엔진별 자사 인용률 추이, 인용 매체 비율 추이, 매체 안정성 분석, 엔진별 노출 매트릭스, 코어 매체 포트폴리오, 축별 매체 심층 분석.',
'공통 필터: 엔진, 세트, 태그, 기간 시작 전 생성분, 집계 주기와 기간.']),
('전략','전략맵','/app/strategy-map','_app_strategy-map.json','키워드 클러스터의 기회와 우선순위를 파악하는 화면.',[
'요약: 전체 클러스터, 긴급, 기회, 유지.',
'리스트 항목: 클러스터, 키워드, 검색량, SEO, AIO, GEO, Gap 유형.',
'검색·필터: 클러스터·키워드 검색, 정렬, Gap 유형, 측정 상태.',
'주요 기능: AI 전략 리포트, 클러스터링 재실행, 클러스터명 수정.']),
('전략','사이트 진단','/app/site-audit','_app_site-audit.json','검색과 AI 가시성을 저해하는 사이트의 기술적 문제를 확인하는 화면.',[
'상단 항목: 진단 도메인·상태, 마지막 분석, 진단 페이지 수, 현재 진단, 진단 기록, Raw, 새 진단.',
'개요: SEO 분석, GEO 분석, 구조화 데이터, 테크니컬 SEO, 사이트 건강 진단.',
'구조화 데이터: Schema 분류 정책, 보유 비율, 누락 항목, 페이지 타입별 커버리지, 필수 스키마 매트릭스.',
'건강 진단: 깨진 링크, 중복 콘텐츠, 중복 태그, 리다이렉트 체인, 비인덱서블, 에러 페이지.',
'AI 봇 접근성: robots.txt·llms.txt·sitemap.xml 정책 파일, 봇 접근성 매트릭스, 렌더링 방식, 페이지별 가시성, Core Web Vitals, 권장 액션.',
'페이지 탭: URL·메타·제목·설명·헤딩·스키마·캐노니컬·색인·링크·이미지·성능·HTTP·이슈 등 페이지별 진단 열.',
'가이드: AI 봇 정책, 검색 엔진, AI 검색·에이전트, 플랫폼 AI, robots.txt 템플릿과 작성 규칙.']),
('실행','콘텐츠 제작소','/app/factory','_app_factory.json','키워드 기반 콘텐츠를 생성·관리하는 화면.',[
'화면 제목은 “콘텐츠 제작”.',
'주요 진입 항목: 새 콘텐츠 만들기.',
'관찰 상태: 생성된 콘텐츠가 없는 빈 화면. 콘텐츠가 있을 때의 편집·상세 화면은 미확인.']),
('실행','콘텐츠 최적화','/app/optimize','_app_optimize.json','글이 AI에 인용되기 좋은 구조인지 채점하는 화면.',[
'입력 방식: URL, 텍스트로 붙여넣기.',
'항목: 채점하기, 채점 기준 보기, 최근 채점.',
'핵심 조건: 결론 먼저 쓰기, 수치 근거, 출처 인용, 섹션 청킹.',
'주요 조건: FAQ, 핵심 요약, 표·리스트, 연도·기준 시점.',
'보조 조건: 최종 업데이트일, 저자·전문가 정보.']),
('실행','콘텐츠 내보내기','/app/exports','_app_exports.json','완료된 콘텐츠를 다운로드하는 화면.',[
'필터: 유형, 기간, 정렬.',
'연결 항목: 콘텐츠 제작소로 이동.',
'관찰 상태: 내보낼 콘텐츠가 없는 빈 화면.']),
('모니터링','모니터링 대시보드','/app/monitoring','_app_monitoring.json','GSC 검색 성과와 GA4 트래픽을 확인하는 화면.',[
'연동 데이터: Google Search Console(검색 노출·클릭·순위), Google Analytics 4(오가닉·AI 트래픽·전환).',
'연결 항목: 연동 설정 열기, 연동 설정으로 이동.',
'관찰 상태: GSC·GA4 미연결 안내. 연동 후 차트와 세부 항목은 미확인.']),
('모니터링','주간 리포트','/app/reports/weekly','_app_reports_weekly.json','AI 가시성의 주간 진단과 우선순위를 확인하는 화면.',[
'항목: 주차·기간, 이전 주차, 다음 주차, 내보내기.',
'연결 항목: AI 대화 모니터링 시작하기.',
'관찰 상태: 선택 주차에 생성된 리포트 없음.']),
('기타','페르소나','/app/personas','_app_personas.json','AI 글쓰기 스타일 프로필을 관리하는 화면.',[
'기본 프로필 항목: 역할, 톤, 스타일; 시스템 기본 스타일은 수정 불가·기본 적용으로 표시.',
'주요 기능: 새 페르소나, 커스텀 페르소나 만들기.',
'커스텀 스타일은 글쓰기 샘플 분석을 통한 생성 안내.']),
('기타','자료실','/app/knowledgehub','_app_knowledgehub.json','제품과 토픽 엔티티를 관리하는 화면.',[
'현황: 제품, 토픽, 클레임, 키워드.',
'분류·필터: 전체, 제품, 토픽, 수집 대기, 정렬.',
'주요 기능: 엔티티 추가.']),
('기타','Raw 데이터','/app/raw-data','_app_raw-data.json','수집 원본을 CSV 묶음으로 다운로드하는 화면.',[
'데이터 구분: 키워드 Raw(SERP·순위·AIO·PAA), 프롬프트 Raw(프롬프트·응답·fan-out), 사이트 진단 Raw(메타·페이지·이슈·점수), 모니터링 Raw(GSC·GA4 일별).',
'필터: 기간(7일·14일·28일·90일), 언어, 국가, 엔진, 동일 항목 최신 1건만.',
'출력 항목: 예상 다운로드 행 수, 정규화 CSV 묶음 ZIP, README.txt.',
'기타: 유의사항·데이터 정책.'])]

out=['# HaloX 페이지 및 메뉴 항목 목록','',
'> 기준 사이트: [HaloX 앱](https://haloxlabs.ai/app) · 확인일: 2026-10-22 (한국 시간)',
'',
'## 수집 범위와 읽는 방법','',
'Firecrawl로 공개 URL과 인증 화면을 수집하고, Ego Lite의 기존 로그인 세션으로 앱 메뉴·설정·탭을 확인했습니다. 페이지명은 실제 화면의 표시를 기준으로 적었습니다. 앱의 업무 데이터 값 대신 화면 구성과 탐색 항목을 정리했습니다.',
'',
'- 사이드바 주요 페이지: **15개**.',
'- 추가 확인: AI 대화 개요, 기회 분석, 추천 프로그램, 피드백, 워크스페이스 관리, 키워드 상세.',
'- 설정 메뉴: **12개**.',
'- 주요 분석·전략 화면의 탭 전환: **40개**. 대시보드 탭과 키워드 상세 탭은 별도로 기재.',
'- Firecrawl Map 공개 URL: **258개**. 홈에서 추가 발견한 도입 문의 주소는 별도 기재.',
'- 공개 URL 목록은 발견 목록이며, 258개 각각의 본문과 현재 응답을 모두 검증한 것은 아닙니다.',
'- 앱 범위는 현재 로그인한 계정에서 보이는 메뉴입니다. 권한·플랜·연동·데이터 유무에 따라 추가 화면이 있을 수 있습니다. 데이터별 상세 화면은 대표 유형으로 정리했습니다.',
'',
'## 1. 앱 메뉴 구조','',
'```text\nHaloX\n├─ 대시보드\n├─ 분석\n│  ├─ 키워드 현황\n│  ├─ 키워드 분석\n│  ├─ 프롬프트 현황\n│  └─ 프롬프트 분석\n├─ 전략\n│  ├─ 전략맵\n│  └─ 사이트 진단\n├─ 실행\n│  ├─ 콘텐츠 제작소\n│  ├─ 콘텐츠 최적화\n│  └─ 콘텐츠 내보내기\n├─ 모니터링\n│  ├─ 모니터링 대시보드\n│  └─ 주간 리포트\n├─ 기타\n│  ├─ 페르소나\n│  ├─ 자료실\n│  └─ Raw 데이터\n├─ 계정 메뉴\n│  ├─ Pro로 업그레이드\n│  ├─ 설정\n│  ├─ 결제\n│  ├─ 알림\n│  ├─ 추천 프로그램\n│  ├─ 피드백\n│  ├─ 문서 ↗\n│  └─ 로그아웃\n└─ 워크스페이스 메뉴\n   ├─ 내 워크스페이스 목록\n   ├─ 워크스페이스 관리\n   └─ 새 워크스페이스 만들기\n```','',
'## 2. 주요 페이지 빠른 목록','',
'| 번호 | 메뉴 그룹 | 페이지 | 실제 URL |',
'| --- | --- | --- | --- |']
for i,(group,name,path,*_) in enumerate(pages,1):out.append(f'| {i} | {group} | {name} | {link("https://haloxlabs.ai"+path)} |')
out+=['','## 3. 주요 페이지별 항목','']
tabcount=0
for i,(group,name,path,filename,purpose,items) in enumerate(pages,1):
 d=read(filename)
 out += [f'### 3.{i}. {name}','',f'- 메뉴 위치: {group} → {name}',f'- URL: {link("https://haloxlabs.ai"+path)}',f'- 용도: {purpose}','',bullets(items),'']
 slug=path.removeprefix('/app/').replace('/','_')
 tabs=sorted(SRC.glob('tab-'+slug+'-*.json'),key=lambda f:int(f.stem.rsplit('-',1)[1]))
 if tabs:
  out += ['| 탭 | 실제 전환 URL | 화면에서 추가 확인한 제목 |','| --- | --- | --- |']
  for f in tabs:
   t=json.loads(f.read_text());tabcount+=1
   heads=[clean(x) for x in t['headings'][1:] if not re.search(r'/insights/|/work/',x)]
   out.append(f'| {t["item"]} | {link(t["url"])} | {" · ".join(heads) or "탭 이름·주소 확인"} |')
  out.append('')
  if len({read(f.name)['url'] for f in tabs})==1:out += ['탭을 전환해도 URL은 동일합니다. 해당 화면 안에서 탭을 선택해야 합니다.','']
 if d.get('columns'):
  cols=list(dict.fromkeys(clean(x) for x in d['columns'] if clean(x)))
  out += ['기본 화면 표의 열: '+', '.join(cols)+'.','']

out += ['## 4. 추가 페이지와 상세 화면','',
'| 진입 위치 | 페이지 | URL / 경로 | 주요 항목 |',
'| --- | --- | --- | --- |',
'| 공개 홈의 GEO 대시보드 링크 | AI 대화 개요 | '+link('https://haloxlabs.ai/app/geo')+' | AI 노출 종합점수, 멘션율·인용률·멘션 순위·인용 순위, 질문 세트, 인용 점유율, 경쟁사 점유율 요약, 상세 분석 보기 |',
'| 대시보드 바로가기 | 기회 분석 | '+link('https://haloxlabs.ai/app/gap')+' | 기회 점수, 키워드 건강 분포, 우선 조치, 검색 × AI 매트릭스, 경쟁사 맵, 콘텐츠·트렌드 |',
'| 계정 메뉴 | 추천 프로그램 | '+link('https://haloxlabs.ai/app/referral')+' | 파트너 신청, 이름/상호, 연락받을 이메일, 휴대폰 번호, 소개 채널, 시작하기 |',
'| 계정 메뉴 | 피드백 | '+link('https://haloxlabs.ai/app/feedback')+' | 피드백 보드, 새 피드백, 필터, 정렬, 빈 목록 안내 |',
'| 워크스페이스 메뉴 | 워크스페이스 관리 | '+link('https://haloxlabs.ai/app/workspaces')+' | 워크스페이스 선택, 플랜·사용량 카드, 상세, 새 워크스페이스 만들기 |',
'| 키워드 분석의 성과 탭 | 키워드 상세 | `/app/keywords/:keywordId` | 엔진별 현황, 추천 프롬프트, 콘텐츠 전략 추천, 태그 추가, URL 등록 |','',
'`/app/keywords/:keywordId`는 실제 키워드 상세 주소 한 건을 열어 확인한 경로 형식입니다. `:keywordId`는 데이터마다 달라지므로 그대로 접속하는 주소가 아닙니다.','',
'키워드 상세의 탭: **상위 결과, AI 요약, 검색 결과 분석, 트렌드, 아이디어, GEO 연결**. 주요 지표는 자사·경쟁사 순위, AI 인용, SERP 특성, VOL, CPC, KD, COMP입니다.','',
'### 기회 분석 탭','',
'| 탭 | URL | 추가 확인 항목 |','| --- | --- | --- |']
for f in sorted(SRC.glob('tab-gap-*.json'),key=lambda f:int(f.stem.rsplit('-',1)[1])):
 t=read(f.name);tabcount+=1
 out.append(f'| {t["item"]} | {link(t["url"])} | {" · ".join(clean(x) for x in t["headings"][1:]) or "탭 이름·주소 확인"} |')
out += ['','기회 분석의 탭은 같은 URL 안에서 전환됩니다.','',
'### 주소 이동과 별칭','',
'| 진입 주소 | 관찰된 도착 주소 | 설명 |','| --- | --- | --- |',
'| '+link('https://haloxlabs.ai/app/reports')+' | '+link(read('_app_reports.json')['url'])+' | 대시보드 “리포트” 링크의 이동 결과 |']
out += ['| '+link('https://haloxlabs.ai/app')+' | '+link('https://haloxlabs.ai/app/login')+' | 비로그인 Firecrawl 요청에서는 로그인 화면으로 이동 |','',
'## 5. 설정 메뉴 12개','',
'설정은 앱 위에 열리는 다이얼로그이며, 왼쪽 메뉴를 선택하면 `tab` 쿼리가 바뀝니다. 기본 진입 주소는 '+link('https://haloxlabs.ai/app/settings')+'입니다.','',
'| 메뉴 | 실제 URL | 주요 항목 |','| --- | --- | --- |']
settings={
'일반':'인터페이스 언어(한국어·English), 분석 언어, 대상 국가, 프롬프트 자동 생성',
'워크스페이스':'워크스페이스 이름·ID·생성일, robots.txt·sitemap.xml·llms.txt 정책 파일 URL, 저장, 계정 탈퇴 요청',
'멤버':'멤버 초대, 멤버 목록, 역할별 권한 매트릭스(소유자·관리자·편집자·뷰어), 섹션별 접근 권한',
'사용량':'키워드·AI 프롬프트·콘텐츠·사이트 진단 사용량, 재설정일, 새로고침, 플랜 변경, 최근 활동',
'구독/결제':'현재 플랜, 플랜 변경, 등록 카드·카드 등록, 결제 내역, 세금계산서 안내, 결제 문의',
'연동':'Google 통합 계정 연결, Search Console·Analytics 4; 네이버 서치어드바이저·Bing·Slack은 준비 중',
'브랜드 트래킹':'도메인 매칭 정책(루트·전체), 자사·경쟁사 브랜드, 멘션·도메인·상품, 별칭 매핑, 과거 데이터 재계산, 자사 제품 라인업',
'태그':'태그 그룹 관리, 새 그룹; 키워드와 프롬프트가 태그를 함께 사용',
'등록 URL':'외부 채널 발행 URL 등록, CSV 업로드, 첫 URL 등록하기',
'내보내기':'발행인 이름·URL, 작성자 이름·프로필 URL, 구조화 데이터 미리보기, 스키마 복사, 변경 사항 저장',
'알림':'준비 중 안내',
'API & MCP':'키 관리·사용량·한도 탭, API 키 이름·만료·발급·권한 범위, 외부 도구 연결 방법'}
for i in [1,2,0,3,4,5,6,7,8,9,10,11]:
 d=read(f'settings-{i}.json');out.append(f'| {d["item"]} | {link(d["url"])} | {settings[d["item"]]} |')
out+=['','API & MCP 연결 방법 탭: **Claude Code (CLI), Claude 앱 (커스텀 커넥터), REST API**. 실제 키 발급이나 권한 변경은 수행하지 않았습니다.','',
'## 6. 공통 메뉴와 지원 항목','',
'| 영역 | 항목 | 확인 내용 |','| --- | --- | --- |',
'| 상단 | 사이드바 토글, 경로 표시 | 현재 페이지 위치 및 메뉴 펼침·접힘 |',
'| 상단 | AI 프롬프트 사용량 | 사용량 비율과 초기화 시점 안내 |',
'| 계정 | Pro로 업그레이드, 설정, 결제, 알림 | 메뉴 항목 확인; 설정 내 사용량·구독/결제·알림 항목은 별도 확인 |',
'| 계정 | 추천 프로그램, 피드백 | 4절의 독립 페이지 |',
'| 계정 | 문서 | [HaloX 문서](https://docs.haloxlabs.ai/)로 연결; 별도 문서 사이트 내부는 수집 범위 밖 |',
'| 계정 | 로그아웃 | 동작 항목; 별도 콘텐츠 페이지로 세지 않음 |',
'| 사이드바 하단 | 도움이 필요하신가요? | SEO/GEO 컨설팅, 서비스 개선 피드백 |',
'| 사이드바 하단 | 체험 잔여 기간, 플랜 보기 | 계정 상태에 따른 표시 |',
'| 워크스페이스 | 내 워크스페이스, 관리, 새로 만들기 | 작업 공간 선택과 관리 진입 |',
'| 대시보드 | 빠른 탐색 | 검색 성과 분석·AI 대화 분석·기회 분석·리포트 바로가기 영역 펼침 |','',
'## 7. 로그인·가입·복구 화면','',
'| 페이지 | URL | 입력·동작 항목 |','| --- | --- | --- |',
'| 로그인 | '+link('https://haloxlabs.ai/app/login')+' | Email, Password, Sign In, Forgot password?, 회원가입하기, 이용약관, 개인정보 처리방침 |',
'| 회원가입 | '+link('https://haloxlabs.ai/app/signup')+' | 이름, 휴대폰 번호, 국가번호, 인증번호 발송, 이메일, 비밀번호, 비밀번호 확인, 가입하기, 로그인으로 돌아가기 |',
'| 비밀번호 재설정 요청 | '+link('https://haloxlabs.ai/app/forgot-password')+' | Email, Send reset link, Back to sign in |','',
'위 3개 화면은 Firecrawl로 본문을 확인했습니다. 인증번호 발송·가입·재설정 메일 전송은 실행하지 않았습니다.','',
'## 8. 공개 웹사이트 메뉴와 URL 목록','',
'### 공개 홈에서 확인한 메뉴','',
'- 상단: 제품, 리소스, 고객 사례, 가격 안내, 도입 문의, 로그인 / 무료 시작.',
'- 주요 연결: 기능, 워크플로우, 연동, 무료 도구, 문서, 블로그, 용어 사전, 측정 방식, 리서치, 컨설팅, 도입 문의.',
'- 회사·지원·정책: 소개, 보안, 파트너 추천, 업데이트 소식, FAQ, 개인정보 처리방침, 이용약관, 환불 정책.',
'',
'### Firecrawl Map 발견 목록','',
'아래는 Firecrawl Map이 반환한 **258개 URL 전체**입니다. 언어별 경로, 과거 주소, 추천 파라미터가 있는 주소를 원본대로 보존했습니다. 제목이 없는 항목은 임의의 페이지명을 붙이지 않고 경로 식별자를 표시했습니다. 제목은 검색·사이트맵 인덱스의 값이므로 현재 화면 제목과 다를 수 있습니다.','']
mapped=read('firecrawl-initial.json')['map']['links']
groups=defaultdict(list)
for row in mapped:
 path=urlsplit(row['url']).path;parts=path.strip('/').split('/')
 lang=parts[0] if parts[0] in ['ko','en','zh','vi','id'] else '기타'
 section=parts[1] if len(parts)>1 else '홈'
 if section not in ['blog','glossary','tools','features','use-cases','compare','customers','tag','solutions','authors']:
  section='기본·회사·지원 페이지'
 if lang=='기타': section='기타 주소'
 groups[(lang,section)].append(row)
out += ['| 언어 / 경로 | 발견 URL 수 |','| --- | --- |']
for lang,n in sorted(Counter(k[0] for k in [key for key, rows in groups.items() for _ in rows]).items()):out.append(f'| {lang} | {n} |')
out.append('')
num=0
for (lang,section),rows in sorted(groups.items(),key=lambda kv:({'ko':0,'en':1}.get(kv[0][0],2),kv[0])):
 out += [f'#### {lang} / {section} ({len(rows)}개)','', '| 번호 | 제목 또는 경로 식별자 | URL |','| --- | --- | --- |']
 for r in sorted(rows,key=lambda r:r['url']):
  num+=1; title=r.get('title') or '제목 미제공 · '+(urlsplit(r['url']).path or '/')
  label=urlsplit(r['url']).path or '/'
  if urlsplit(r['url']).query:label+='?'+urlsplit(r['url']).query
  out.append(f'| {num} | {clean(title)} | {link(r["url"],label)} |')
 out.append('')
out+=['### 홈에서 추가 발견한 공개 주소','',
'| 항목 | URL | 근거 |','| --- | --- | --- |',
'| 도입 문의 | '+link('https://haloxlabs.ai/ko/contact-sales')+' | 공개 홈 링크 |',
'| 도입 문의 — 온보딩 진입 | '+link('https://haloxlabs.ai/ko/contact-sales?type=onboarding&from=home_support')+' | 공개 홈 지원 영역의 링크; 위 페이지의 쿼리 변형 |','',
'## 9. 확인 상태와 수집 근거','',
'- **실제 화면 확인**: 앱의 사이드바 15개 페이지, 추가 페이지, 설정 12개 항목, 분석·전략 탭의 메뉴명과 URL.',
'- **빈 상태 / 제한 상태**: 콘텐츠 제작·내보내기·주간 리포트는 데이터가 없는 상태였고, 모니터링은 GSC·GA4 미연결 상태였습니다. 해당 조건이 충족된 후의 화면 구성은 확인하지 않았습니다.',
'- **준비 중**: 설정의 알림, 연동의 네이버 서치어드바이저·Bing·Slack.',
'- **공개 URL 발견만 확인**: 부록의 Map URL 258개 및 홈에서 발견한 추가 링크. 현재 유효성·본문 전체 수집을 의미하지 않습니다.',
'- **제외 범위**: 계정별 모든 레코드의 상세 URL 나열, 권한 밖 관리자 화면, 콘텐츠 생성 후에만 나타나는 화면, 결제 완료 후 흐름, 외부 문서 사이트 전체.',
'- 클릭형 메뉴·탭·조회로 수집했으며 콘텐츠 생성, 결제, 회원가입, 초대 발송, 설정 저장, 재분석 실행은 하지 않았습니다.',
'',
'수집 파일은 [sources 폴더](/Users/user01/Desktop/haloX/docs/sources)에 보관했습니다. Firecrawl 원본은 [초기 수집 JSON](/Users/user01/Desktop/haloX/docs/sources/firecrawl-initial.json)과 [추가 수집 JSON](/Users/user01/Desktop/haloX/docs/sources/firecrawl-extra.json), 앱 화면 근거는 개별 JSON 파일입니다.','']
assert len(pages)==15
assert len(mapped)==258
assert tabcount==40,tabcount
text='\n'.join(out)
(ROOT/'page.md').write_text(text,encoding='utf-8')
print(json.dumps({'output':str(ROOT/'page.md'),'lines':len(text.splitlines()),'main_pages':len(pages),'settings':len(settings),'primary_tabs':tabcount,'public_map_urls':len(mapped)},ensure_ascii=False))
