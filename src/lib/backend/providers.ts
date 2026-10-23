/**
 * HaloX External Provider Adapters & Deterministic Mocks (S5/S6)
 * Keeps SERP, LLM GEO, and Lighthouse site-audit pipelines runnable offline without paid keys,
 * while supporting live API keys via environment variables when configured.
 */

export interface SerpSnapshotResult {
  keyword: string;
  engine: 'google' | 'naver';
  searchVolume: number;
  keywordDifficulty: number;
  intent: 'informational' | 'commercial' | 'transactional' | 'navigational';
  aiOverviewDetected: boolean;
  topResults: Array<{ rank: number; url: string; title: string; domain: string }>;
  paaQuestions: string[];
  relatedSearches: string[];
}

export interface GeoRunEvaluationResult {
  promptText: string;
  engine: string;
  modelName: string;
  answerText: string;
  brandMentioned: boolean;
  isCited: boolean;
  citationRate: number;
  citations: Array<{
    cited_url: string;
    domain: string;
    root_domain: string;
    position_index: number;
    is_ours: boolean;
    is_competitor: boolean;
    domain_classification: string;
  }>;
}

export interface SiteAuditCrawlResult {
  targetUrl: string;
  crawledUrls: number;
  siteHealthScore: number;
  aiReadinessScore: number;
  pages: Array<{ url: string; statusCode: number; lcpMs: number; cls: number; seoScore: number }>;
  issues: Array<{
    pageUrl: string;
    issueType: string;
    category: string;
    severity: 'critical' | 'warning' | 'notice';
    title: string;
    description: string;
    fixRecommendation: string;
  }>;
}

export interface ContentDraftGenerationResult {
  title: string;
  targetKeyword: string;
  contentMd: string;
  metaTitle: string;
  metaDescription: string;
  seoScore: number;
  aioScore: number;
  wordCount: number;
  groundingSources: string[];
}

export interface ContentGenerationContext {
  persona?: { id: string; name: string; description: string; audience: string; tone: string; forbiddenTerms: string[]; samples: { title: string; content: string; url: string }[] };
  knowledge: { id: string; name: string; description: string; body: string; sources: { id: string; title: string; url: string; content: string; filename: string }[]; contexts: { title: string; content: string; sourceId: string | null }[] }[];
}

export interface HaloXProviders {
  collectSerp(keyword: string, engine?: 'google' | 'naver'): Promise<SerpSnapshotResult>;
  runGeoPrompt(promptText: string, engine: string, brandDomain?: string): Promise<GeoRunEvaluationResult>;
  crawlSiteAudit(targetUrl: string, maxPages?: number): Promise<SiteAuditCrawlResult>;
  generateContentDraft(targetKeyword: string, title?: string, context?: ContentGenerationContext): Promise<ContentDraftGenerationResult>;
}

function deterministicHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export function createDeterministicProviders(): HaloXProviders {
  return {
    async collectSerp(keyword: string, engine: 'google' | 'naver' = 'google'): Promise<SerpSnapshotResult> {
      const h = deterministicHash(`${keyword}:${engine}`);
      const intents = ['informational', 'commercial', 'transactional', 'navigational'] as const;
      const searchVolume = 500 + (h % 14500);
      const keywordDifficulty = 15 + (h % 70);
      const intent = intents[h % intents.length];
      const aiOverviewDetected = h % 3 !== 0;

      return {
        keyword,
        engine,
        searchVolume,
        keywordDifficulty,
        intent,
        aiOverviewDetected,
        topResults: [
          {
            rank: 1,
            url: `https://brizzi.kr/guides/${encodeURIComponent(keyword)}`,
            title: `${keyword} 완벽 가이드 및 최신 트렌드`,
            domain: 'brizzi.kr',
          },
          {
            rank: 2,
            url: `https://competitor-a.co.kr/blog/${encodeURIComponent(keyword)}`,
            title: `${keyword} 비교 분석 리포트`,
            domain: 'competitor-a.co.kr',
          },
        ],
        paaQuestions: [`${keyword} 도입 시 가장 중요한 기준은 무엇인가요?`, `${keyword} 비용과 ROI는 어떻게 계산하나요?`],
        relatedSearches: [`${keyword} 추천`, `${keyword} 비교`, `${keyword} 사례`],
      };
    },

    async runGeoPrompt(promptText: string, engine: string, brandDomain = 'brizzi.kr'): Promise<GeoRunEvaluationResult> {
      const h = deterministicHash(`${promptText}:${engine}`);
      const modelMap: Record<string, string> = {
        openai: 'gpt-4o',
        claude: 'claude-sonnet-4-6',
        gemini: 'gemini-2.5-flash',
        perplexity: 'sonar-pro',
      };
      const isCited = !!brandDomain && h % 2 === 0;
      const brandMentioned = !!brandDomain;
      return {
        promptText,
        engine,
        modelName: modelMap[engine] || 'gpt-4o',
        answerText: `[${engine.toUpperCase()} 데모 응답] "${promptText}"에 대한 예시입니다. ${brandDomain ? `${brandDomain}을 기준으로 자사 언급을 평가한 모의 결과입니다.` : '브랜드 도메인이 없어 자사 언급을 평가하지 않았습니다.'}`,
        brandMentioned,
        isCited,
        citationRate: isCited ? 50 : 0,
        citations: [
          ...(isCited ? [{
            cited_url: `https://${brandDomain}/insights`,
            domain: brandDomain,
            root_domain: brandDomain,
            position_index: 1,
            is_ours: true,
            is_competitor: false,
            domain_classification: 'owned',
          }] : []),
          {
            cited_url: 'https://docs.haloxlabs.ai/en/features/overview',
            domain: 'docs.haloxlabs.ai',
            root_domain: 'haloxlabs.ai',
            position_index: 2,
            is_ours: false,
            is_competitor: true,
            domain_classification: 'competitor',
          },
        ],
      };
    },

    async crawlSiteAudit(targetUrl: string, maxPages = 25): Promise<SiteAuditCrawlResult> {
      let cleanUrl = targetUrl.trim();
      if (!/^https?:\/\//i.test(cleanUrl)) cleanUrl = `https://${cleanUrl}`;
      const crawledUrls = Math.min(maxPages, 12);
      return {
        targetUrl: cleanUrl,
        crawledUrls,
        siteHealthScore: 93,
        aiReadinessScore: 88,
        pages: [
          { url: cleanUrl, statusCode: 200, lcpMs: 1420, cls: 0.02, seoScore: 95 },
          { url: `${cleanUrl.replace(/\/$/, '')}/pricing`, statusCode: 200, lcpMs: 1650, cls: 0.03, seoScore: 91 },
        ],
        issues: [
          {
            pageUrl: cleanUrl,
            issueType: 'missing_llms_txt',
            category: 'ai_readiness',
            severity: 'warning',
            title: 'llms.txt 구조화 안내 파일 누락',
            description: 'AI 검색 크롤러가 핵심 제품 문서를 우선 탐색할 수 있도록 /llms.txt 제공이 권장됩니다.',
            fixRecommendation: '루트 경로에 표준 마크다운 기반 /llms.txt 파일을 배포하세요.',
          },
        ],
      };
    },

    async generateContentDraft(targetKeyword: string, title?: string, context?: ContentGenerationContext): Promise<ContentDraftGenerationResult> {
      const resolvedTitle = title || `${targetKeyword}: AI 검색 시대의 핵심 전략 가이드`;
      const contentMd = [
        `# ${resolvedTitle}`,
        '',
        `## 1. ${targetKeyword} 개요`,
        `${targetKeyword}는 전통적인 검색 엔진 최적화(SEO)와 생성형 AI 최적화(GEO/AEO)를 연결하는 핵심 주제입니다.`,
        '',
        '## 2. 핵심 체크리스트',
        '- 구조화된 데이터(JSON-LD)와 명확한 질문-답변 단락 구성',
        '- 신뢰할 수 있는 통계 및 출처 인용 포함',
        '- 주기적인 AI 엔진별 인용률(Citation Rate) 및 멘션 순위 모니터링',
        '',
        '## 3. 자주 묻는 질문 (FAQ)',
        `### Q1. ${targetKeyword} 점수는 어떻게 개선하나요?`,
        '상위 10위 내 유기적 노출 확보와 함께 AI Overview 인용에 적합한 요약 단락을 문서 상단에 배치합니다.',
        ...(context?.persona ? ['', '## 작성 지침 (데모)', `페르소나: ${context.persona.name}`, context.persona.description, `독자: ${context.persona.audience || '미지정'}`, `문체: ${context.persona.tone || '미지정'}`, `사용하지 않을 표현: ${context.persona.forbiddenTerms.join(', ') || '없음'}`, ...context.persona.samples.map(sample => `예문: ${sample.content}`)] : []),
        ...(context?.knowledge.length ? ['', '## 참조 자료 (사용자 제공)', ...context.knowledge.flatMap(entity => [`### ${entity.name}`, entity.description, entity.body, ...entity.sources.map(source => `${source.title}${source.url ? ` (${source.url})` : ''}\n${source.content}`), ...entity.contexts.map(item => `${item.title}\n${item.content}`)])] : []),
      ].join('\n');

      return {
        title: resolvedTitle,
        targetKeyword,
        contentMd,
        metaTitle: `${resolvedTitle} | 브리찌 인사이트`,
        metaDescription: `${targetKeyword}에 대한 데이터 기반 분석과 실전 GEO/SEO 실행 전략을 확인하세요.`,
        seoScore: 89,
        aioScore: 86,
        wordCount: contentMd.length,
        groundingSources: context ? context.knowledge.flatMap(entity => entity.sources.map(source => source.url).filter(Boolean)) : ['https://brizzi.kr/guides/geo-strategy'],
      };
    },
  };
}
