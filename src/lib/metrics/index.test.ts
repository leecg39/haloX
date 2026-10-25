/**
 * S1 fidelity tests: compare the metric engine against reference functions
 * transcribed from the original SPA bundle (index-Ccsf13ME.js, REA E1-1):
 *   XR  -> positionScore      dre -> seoScore
 *   are -> geoScore           ure -> aviComposite      ZR -> scoreLevel
 * Run: node --experimental-strip-types --test src/lib/metrics/index.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiTrafficShare,
  aviComposite,
  brandScopeClassify,
  classifyGap,
  citationRatePct,
  competitorThreat,
  contentIssue,
  ctrBenchmark,
  deriveLightGeoInput,
  documentedQuickWin,
  documentedSeoScoreFourFactor,
  ENGINE_DOMAINS,
  ENGINE_LABELS,
  engineNormalize,
  funnelHealth,
  freshnessClassify,
  gapAggregateScore,
  gapLevelLabel,
  geoRunFlags,
  geoScore,
  goalStatus,
  isQuickWinKeyword,
  opportunityScore,
  percentShare,
  positionScore,
  scoreLevel,
  searchContribution,
  seoScore,
  serverAviOverviewScore,
  seoStrongFromRank,
  serpQuickWin,
  serverAviFiveFactor,
  tierKindAllowed,
  tierPriority,
  CLAIM_CONFIDENCE_THRESHOLD,
  webVitalRating,
  webVitalScore,
} from './index.ts';

// ---- Reference oracle (original bundle semantics) ----
const WI = [100, 85, 70, 55, 45, 37, 30, 24, 19, 15];
const clampRef = (v: number) => Math.max(0, Math.min(100, v));

function refPosition(e: number | null | undefined): number | null {
  if (e == null || !Number.isFinite(e) || e <= 0) return null;
  if (e <= 1) return WI[0];
  if (e >= WI.length) return 10;
  const t = Math.floor(e);
  const n = Math.ceil(e);
  const o = WI[t - 1];
  if (t === n) return o;
  const r = WI[n - 1];
  return Math.round((o + (r - o) * (e - t)) * 10) / 10;
}

function refSeo(avgPosition: number | null, top10Rate: number, aioRate: number): number {
  const t = refPosition(avgPosition) ?? 0;
  return Math.round(clampRef(t * 0.4 + top10Rate * 0.3 + aioRate * 0.3));
}

function refGeo(m: number, c: number, mr: number, cr: number): number {
  return Math.round(clampRef(m * 0.25 + c * 0.25 + mr * 0.25 + cr * 0.25));
}

function refAvi(seo: number, geo: number, web: number | null): number {
  const hasWeb = web !== undefined && web !== null && web > 0;
  const hasGeo = geo > 0;
  const [o, r, a] = hasWeb && hasGeo ? [0.4, 0.3, 0.3] : hasGeo ? [0.5, 0.5, 0] : hasWeb ? [0.6, 0, 0.4] : [1, 0, 0];
  const i = hasWeb ? (web as number) : 0;
  return Math.round(clampRef(seo * o + geo * r + i * a));
}

function refLevel(e: number): string {
  return e < 20 ? 'critical' : e < 40 ? 'low' : e < 60 ? 'medium' : e < 80 ? 'high' : 'excellent';
}

const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
};

// ---- Observed dashboard values (REA E4-1, 2026-10-22) ----
describe('observed dashboard values', () => {
  it('GEO 10/30/100/100 -> 60', () => {
    assert.equal(geoScore({ citationRate: 10, mentionRate: 30, citationRankScore: 100, mentionRankScore: 100 }), 60);
  });
  it('SEO no rank / top10 0 / AIO 11 -> 3', () => {
    assert.equal(seoScore({ avgPosition: null, top10Rate: 0, aioCitationRate: 11 }), 3);
  });
  it('AVI composite SEO 3 / GEO 60 / web 93 -> 47', () => {
    assert.equal(aviComposite({ seo: 3, geo: 60, webHealth: 93 }), 47);
  });
});

describe('positionScore matches bundle XR', () => {
  it('equals oracle on 0..12 step 0.05 and invalid inputs', () => {
    for (const r of [...range(0, 12, 0.05), -1, NaN, Infinity, null, undefined]) {
      assert.equal(positionScore(r as number), refPosition(r as number), `rank=${r}`);
    }
  });
  it('rank 10 yields 10, table value 15 unreachable (original quirk)', () => {
    assert.equal(positionScore(10), 10);
    assert.equal(positionScore(9.99), 15);
  });
});

describe('seoScore matches bundle dre', () => {
  it('equals oracle on rank x top10 x aio grid', () => {
    for (const rank of [null, 1, 2.5, 7, 10, 30]) {
      for (const top10 of range(0, 100, 12.5)) {
        for (const aio of range(0, 100, 12.5)) {
          assert.equal(seoScore({ avgPosition: rank, top10Rate: top10, aioCitationRate: aio }),
            refSeo(rank, top10, aio), `rank=${rank} top10=${top10} aio=${aio}`);
        }
      }
    }
  });
});

describe('geoScore matches bundle are', () => {
  it('equals oracle on component grid', () => {
    const vals = range(0, 100, 20);
    for (const m of vals) for (const c of vals) for (const mr of vals) for (const cr of vals) {
      assert.equal(geoScore({ mentionRate: m, citationRate: c, mentionRankScore: mr, citationRankScore: cr }), refGeo(m, c, mr, cr));
    }
  });
});

describe('aviComposite matches bundle ure (availability = score > 0)', () => {
  it('equals oracle on seo x geo x web grid including zeros and null', () => {
    for (const seo of range(0, 100, 10)) {
      for (const geo of range(0, 100, 10)) {
        for (const web of [null, ...range(0, 100, 10)]) {
          assert.equal(aviComposite({ seo, geo, webHealth: web }), refAvi(seo, geo, web), `seo=${seo} geo=${geo} web=${web}`);
        }
      }
    }
  });
  it('GEO 0 is treated as unavailable: SEO 50 / GEO 0 / web 80 -> 62', () => {
    assert.equal(aviComposite({ seo: 50, geo: 0, webHealth: 80 }), 62);
  });
});

describe('scoreLevel matches bundle ZR', () => {
  it('equals oracle on 0..100 step 0.5', () => {
    for (const s of range(0, 100, 0.5)) assert.equal(scoreLevel(s), refLevel(s), `score=${s}`);
  });
});

describe('deriveLightGeoInput matches AppOverview derivation', () => {
  it('computes rates and normalized citation rank', () => {
    assert.deepEqual(
      deriveLightGeoInput({ citedPrompts: 1, totalPrompts: 10, mentionedRuns: 3, totalRuns: 10, normalizedPositionQualitySum: 180, positionedCitedRuns: 2 }),
      { citationRate: 10, mentionRate: 30, citationRankScore: 90, mentionRankScore: 0 },
    );
  });
  it('returns zeros when there are no prompts or runs', () => {
    assert.deepEqual(
      deriveLightGeoInput({ citedPrompts: 0, totalPrompts: 0, mentionedRuns: 0, totalRuns: 0, normalizedPositionQualitySum: 0, positionedCitedRuns: 0 }),
      { citationRate: 0, mentionRate: 0, citationRankScore: 0, mentionRankScore: 0 },
    );
  });
});

// ---- Documented (SUP S-1) formulas — not in the client bundle, kept for the server-AVI design (U-2) ----
describe('documented formulas', () => {
  it('serverAviFiveFactor = 35/20/15/15/15 weighted, inputs clamped', () => {
    assert.equal(serverAviFiveFactor({ citationRate: 100, mentionRate: 100, sentimentScore: 100, coverageRate: 100, positionQuality: 100 }), 100);
    assert.equal(serverAviFiveFactor({ citationRate: 10, mentionRate: 30, sentimentScore: 50, coverageRate: 0, positionQuality: 0 }), 17);
    assert.equal(serverAviFiveFactor({ citationRate: 200, mentionRate: -5, sentimentScore: 0, coverageRate: 0, positionQuality: 0 }), 35);
  });
  it('documentedSeoScoreFourFactor differs from the implemented SEO score (F2-3 vs F5-2)', () => {
    assert.equal(documentedSeoScoreFourFactor({ positionScoreValue: 0, brandSov: 0, aioCoverage: 11, trendScore: 0 }), 2);
    assert.notEqual(
      documentedSeoScoreFourFactor({ positionScoreValue: 0, brandSov: 0, aioCoverage: 11, trendScore: 0 }),
      seoScore({ avgPosition: null, top10Rate: 0, aioCitationRate: 11 }),
    );
  });
  it('aiTrafficShare = ai / organic * 100, 2 decimals, guards invalid input', () => {
    assert.equal(aiTrafficShare(25, 200), 12.5);
    assert.equal(aiTrafficShare(1, 3), 33.33);
    assert.equal(aiTrafficShare(5, 0), 0);
    assert.equal(aiTrafficShare(-1, 10), 0);
    assert.equal(aiTrafficShare(NaN, 10), 0);
    assert.equal(aiTrafficShare(300, 100), 100);
  });
  it('searchContribution = gsc clicks / organic * 100, 2 decimals, guards invalid input', () => {
    assert.equal(searchContribution(40, 160), 25);
    assert.equal(searchContribution(0, 160), 0);
    assert.equal(searchContribution(10, -1), 0);
    assert.equal(searchContribution(Infinity, 10), 0);
  });
  it('documentedQuickWin (docs F2-4): rank 5~15, impressions >= 100, CTR < 5%', () => {
    assert.equal(documentedQuickWin({ avgPosition: 5, impressions: 100, ctrPercent: 4.99 }), true);
    assert.equal(documentedQuickWin({ avgPosition: 15, impressions: 500, ctrPercent: 0 }), true);
    assert.equal(documentedQuickWin({ avgPosition: 4.9, impressions: 500, ctrPercent: 1 }), false);
    assert.equal(documentedQuickWin({ avgPosition: 16, impressions: 500, ctrPercent: 1 }), false);
    assert.equal(documentedQuickWin({ avgPosition: 8, impressions: 99, ctrPercent: 1 }), false);
    assert.equal(documentedQuickWin({ avgPosition: 8, impressions: 500, ctrPercent: 5 }), false);
    assert.equal(documentedQuickWin({ avgPosition: null, impressions: 500, ctrPercent: 1 }), false);
    assert.equal(documentedQuickWin({ avgPosition: 8, impressions: NaN, ctrPercent: 1 }), false);
  });
  it('isQuickWinKeyword (bundle ground truth): KD <= 30 and position 11~30', () => {
    assert.equal(isQuickWinKeyword({ keywordDifficulty: 30, ourPosition: 11 }), true);
    assert.equal(isQuickWinKeyword({ keywordDifficulty: 30, ourPosition: 30 }), true);
    assert.equal(isQuickWinKeyword({ keywordDifficulty: 31, ourPosition: 15 }), false);
    assert.equal(isQuickWinKeyword({ keywordDifficulty: 10, ourPosition: 10 }), false);
    assert.equal(isQuickWinKeyword({ keywordDifficulty: 10, ourPosition: 31 }), false);
    assert.equal(isQuickWinKeyword({ keywordDifficulty: 10, ourPosition: null }), false);
    assert.equal(isQuickWinKeyword({ keywordDifficulty: NaN, ourPosition: 15 }), false);
  });
});

// ---- P9 bundle ground truth (docs/clone/algorithms/) ----
describe('P9 golden: original 2026-10-25 dashboard observations', () => {
  // Captured original workspace (E8-1, 1920x939 screenshot + captured HTML):
  // positionScore 52, top10 15%, AIO 17% -> SEO 30
  it('SEO 30 = 52*0.4 + 15*0.3 + 17*0.3 (observed 10-25 dashboard)', () => {
    assert.equal(seoScore({ positionScoreValue: 52, top10Rate: 15, aioCitationRate: 17 }), 30);
  });
  // citationRate 30, mentionRate 30, citationRank 100, mentionRank 100 -> GEO 65
  it('GEO 65 = 30/4 + 30/4 + 100/4 + 100/4 (observed 10-25 dashboard)', () => {
    assert.equal(geoScore({ citationRate: 30, mentionRate: 30, citationRankScore: 100, mentionRankScore: 100 }), 65);
  });
  // SEO 30, GEO 65, webHealth 93 -> AVI 59 (30*0.4 + 65*0.3 + 93*0.3 = 59.4)
  it('AVI 59 from SEO 30 / GEO 65 / web 93 (observed 10-25 dashboard)', () => {
    assert.equal(aviComposite({ seo: 30, geo: 65, webHealth: 93 }), 59);
  });
});

describe('P9 gap algorithms (gap-intelligence chunk)', () => {
  it('classifyGap quadrant matrix', () => {
    assert.equal(classifyGap(true, true), 'FORTRESS');
    assert.equal(classifyGap(true, false), 'GEO_GAP');
    assert.equal(classifyGap(false, true), 'SEO_GAP');
    assert.equal(classifyGap(false, false), 'CRITICAL');
  });
  it('seoStrongFromRank: rank exists and <= 10', () => {
    assert.equal(seoStrongFromRank(10), true);
    assert.equal(seoStrongFromRank(11), false);
    assert.equal(seoStrongFromRank(null), false);
  });
  it('gapAggregateScore: weighted 3/2/1/0 over 3n, percentages 0.1 step', () => {
    const r = gapAggregateScore({ criticalCount: 9, geoGapCount: 0, seoGapCount: 0, fortressCount: 1, totalCount: 10 });
    assert.equal(r.score, Math.round((27 / 30) * 100));
    assert.equal(r.distributionPercent.fortress, 10);
    assert.equal(gapAggregateScore({ criticalCount: 0, geoGapCount: 0, seoGapCount: 0, fortressCount: 0, totalCount: 0 }).score, 0);
  });
  it('opportunityScore: volume log10 cap 50, difficulty inverted, gap bonus', () => {
    const r = opportunityScore({ searchVolume: 480, keywordDifficulty: 30, gapType: 'CRITICAL', ourPosition: 12 });
    const volumeScore = Math.min(Math.log10(480) * 10, 50);
    const difficultyScore = ((100 - 30) / 100) * 30;
    const raw = volumeScore * 0.4 + difficultyScore * 0.3 + 100 * 0.3;
    assert.equal(r.score, Math.round(raw));
    assert.equal(r.components.gapBonus, 100);
    assert.equal(r.isQuickWin, true);
    assert.equal(opportunityScore({ searchVolume: 1, keywordDifficulty: 100, gapType: 'FORTRESS', ourPosition: null }).score, 0);
    // Structural original quirk: volumeScore caps at 50 and difficultyScore at 30,
    // so the theoretical maximum is 50*0.4 + 30*0.3 + 100*0.3 = 59 (never 100).
    assert.equal(opportunityScore({ searchVolume: 1e12, keywordDifficulty: 0, gapType: 'CRITICAL', ourPosition: null }).score, 59);
  });
  it('contentIssue: missing / outdated >= 12mo / weak when competitor <= 10 and ours > 10', () => {
    assert.equal(contentIssue({ hasArticle: false, ourPosition: 1, competitorPosition: 1, lastUpdatedMonthsAgo: 0 }), 'missing_content');
    assert.equal(contentIssue({ hasArticle: true, ourPosition: 1, competitorPosition: 1, lastUpdatedMonthsAgo: 12 }), 'outdated_content');
    assert.equal(contentIssue({ hasArticle: true, ourPosition: 11, competitorPosition: 5, lastUpdatedMonthsAgo: 1 }), 'weak_content');
    assert.equal(contentIssue({ hasArticle: true, ourPosition: 5, competitorPosition: 20, lastUpdatedMonthsAgo: 1 }), null);
  });
  it('competitorThreat: >=50 high, >=20 medium, else low', () => {
    assert.equal(competitorThreat({ domain: 'a.com', seoGapCount: 25, geoGapCount: 25 }).threatLevel, 'high');
    assert.equal(competitorThreat({ domain: 'a.com', seoGapCount: 10, geoGapCount: 10 }).threatLevel, 'medium');
    assert.equal(competitorThreat({ domain: 'a.com', seoGapCount: 1, geoGapCount: 2 }).threatLevel, 'low');
  });
  it('gapLevelLabel thresholds 20/40/60/80', () => {
    assert.equal(gapLevelLabel(20), 'excellent');
    assert.equal(gapLevelLabel(21), 'good');
    assert.equal(gapLevelLabel(41), 'medium');
    assert.equal(gapLevelLabel(61), 'high');
    assert.equal(gapLevelLabel(81), 'critical');
  });
  it('funnelHealth matches gap-intelligence T branches', () => {
    assert.deepEqual(funnelHealth({ gscClicks: 0, organicSessions: 0, engagementRate: 0, hasConversionSetup: false, organicConversions: 0 }).level, 'unknown');
    assert.deepEqual(funnelHealth({ gscClicks: 50, organicSessions: 0, engagementRate: 0, hasConversionSetup: false, organicConversions: 0 }).level, 'blocked');
    assert.deepEqual(funnelHealth({ gscClicks: 5, organicSessions: 20, engagementRate: 20, hasConversionSetup: false, organicConversions: 0 }).level, 'leaking');
    assert.deepEqual(funnelHealth({ gscClicks: 5, organicSessions: 20, engagementRate: 55, hasConversionSetup: true, organicConversions: 2 }).level, 'healthy');
    assert.deepEqual(funnelHealth({ gscClicks: 5, organicSessions: 20, engagementRate: 45, hasConversionSetup: false, organicConversions: 0 }).level, 'healthy');
  });
});

describe('P9 quality thresholds (score-utils / grounding / freshness / ctr-benchmarks)', () => {
  it('webVitalScore: linear 100->0 between [good, poor]', () => {
    assert.equal(webVitalScore('lcp', 2500), 100);
    assert.equal(webVitalScore('lcp', 4000), 0);
    assert.equal(webVitalScore('lcp', 3250), 50);
    assert.equal(webVitalRating('cls', 0.1), 'good');
    assert.equal(webVitalRating('cls', 0.2), 'needs-improvement');
    assert.equal(webVitalRating('cls', 0.3), 'poor');
  });
  it('grounding tier thresholds and tier-kind rules', () => {
    assert.equal(CLAIM_CONFIDENCE_THRESHOLD.official, 0.4);
    assert.equal(CLAIM_CONFIDENCE_THRESHOLD.unknown, 0.8);
    assert.equal(tierKindAllowed('pricing', 'reputable'), false);
    assert.equal(tierKindAllowed('pricing', 'official'), true);
    assert.equal(tierKindAllowed('general', 'unknown'), true);
    assert.ok(tierPriority('official') > tierPriority('reputable') && tierPriority('reputable') > tierPriority('community'));
  });
  it('freshness: <30 high, <90 medium, else low; goalStatus ordering', () => {
    assert.equal(freshnessClassify(10), 'high');
    assert.equal(freshnessClassify(50), 'medium');
    assert.equal(freshnessClassify(200), 'low');
    assert.equal(freshnessClassify(undefined), 'medium');
    assert.equal(goalStatus({ hasArticle: true, publishedAt: new Date(Date.now() - 86400000 * 100), weeklyTargetWeeks: 4, currentRank: 3, bestRank: 5 }), 'achieved');
    assert.equal(goalStatus({ hasArticle: false, publishedAt: null, weeklyTargetWeeks: 4, currentRank: null, bestRank: null }), 'no_article');
    assert.equal(goalStatus({ hasArticle: true, publishedAt: new Date(Date.now() - 86400000 * 100), weeklyTargetWeeks: 4, currentRank: null, bestRank: null }), 'overdue');
    assert.equal(goalStatus({ hasArticle: true, publishedAt: new Date(Date.now() - 86400000 * 25), weeklyTargetWeeks: 4, currentRank: null, bestRank: null }), 'due_soon');
    assert.equal(goalStatus({ hasArticle: true, publishedAt: new Date(Date.now() - 86400000 * 5), weeklyTargetWeeks: 4, currentRank: null, bestRank: null }), 'pending');
  });
  it('ctr benchmarks and serpQuickWin classification', () => {
    assert.equal(ctrBenchmark(1), 28);
    assert.equal(ctrBenchmark(10), 2.1);
    assert.equal(ctrBenchmark(11), 1);
    assert.deepEqual(serpQuickWin({ avgPosition: 8, impressions: 60, ctr: 2 }), { type: 'quick-win' });
    assert.deepEqual(serpQuickWin({ avgPosition: 8, impressions: 60, ctr: 1 }), { type: 'ctr-gap' });
    assert.deepEqual(serpQuickWin({ avgPosition: 3, impressions: 60, ctr: 2 }), { type: null });
    assert.deepEqual(serpQuickWin({ avgPosition: 8, impressions: 10, ctr: 2 }), { type: null });
  });
});

describe('P9 KPI contracts (engines, rounding, run flags, brand scope)', () => {
  it('engine normalization: openai->chatgpt, unknown->chatgpt', () => {
    assert.equal(engineNormalize('openai'), 'chatgpt');
    assert.equal(engineNormalize('claude'), 'claude');
    assert.equal(engineNormalize('naver'), 'chatgpt');
    assert.equal(ENGINE_LABELS.perplexity, 'Pplx');
    assert.equal(ENGINE_DOMAINS.gemini, 'gemini.google.com');
  });
  it('citationRatePct one decimal, percentShare integer', () => {
    assert.equal(citationRatePct(1, 3), 33.3);
    assert.equal(citationRatePct(0, 0), 0);
    assert.equal(percentShare(1, 3), 33);
  });
  it('geoRunFlags derived states (ghost, sourcedOnly, compOnlyCited)', () => {
    assert.deepEqual(geoRunFlags({ brand_mentioned: false, is_cited: true, our_source_count: 0, source_but_not_cited: false, competitor_citation_count: 0 }), { mentioned: false, sourced: true, cited: true, hasCompetitorCitation: false, sourcedOnly: false, ghost: true, mentionOnly: false, compOnlyCited: false });
    assert.deepEqual(geoRunFlags({ brand_mentioned: true, is_cited: false, our_source_count: 2, source_but_not_cited: true, competitor_citation_count: 3 }), { mentioned: true, sourced: true, cited: false, hasCompetitorCitation: true, sourcedOnly: true, ghost: false, mentionOnly: true, compOnlyCited: true });
  });
  it('brandScopeClassify: normalized contains-match, brand wins over competitor', () => {
    assert.deepEqual(brandScopeClassify('브리찌 vs 모비데이즈 비교', ['브리찌'], ['모비데이즈']), { scope: 'brand', matchedBrand: '브리찌', matchedCompetitor: '모비데이즈' });
    assert.equal(brandScopeClassify('모비데이즈 가격', ['브리찌'], ['모비데이즈']).scope, 'competitor');
    assert.equal(brandScopeClassify('노트북 추천', ['브리찌'], ['모비데이즈']).scope, 'non_brand');
    assert.equal(brandScopeClassify('', ['브리찌'], []).scope, 'non_brand');
  });
});

describe('P9 aviComposite explicit weight override (pre bundle contract)', () => {
  it('explicit weights are used verbatim regardless of availability', () => {
    assert.equal(aviComposite({ seo: 30, geo: 65, webHealth: 93, seoWeight: 0.5, geoWeight: 0.5, webWeight: 0 }), Math.round(30 * 0.5 + 65 * 0.5));
    assert.equal(aviComposite({ seo: 30, geo: 0, webHealth: 93, seoWeight: 0.4, geoWeight: 0.6, webWeight: 0 }), Math.round(30 * 0.4));
    assert.equal(aviComposite({ seo: 30, geo: 65, geoWeight: 0.5, webWeight: 0.5 }), Math.round(65 * 0.5));
  });
});

describe('P9 server AVI (original experiment, U-2 resolved)', () => {
  it('observed get_avi_overview: 30/30/100/100 -> 65 (refutes documented 5-factor)', () => {
    assert.equal(serverAviOverviewScore({ mentionRate: 30, citationRate: 30, mentionRankScore: 100, citationRankScore: 100 }), 65);
    // Documented 5-factor upper bound with these inputs: 30*0.35+30*0.2+30*0.15+100*0.15 = 28.5 (+15 sentiment max = 43.5+15=58.5? use exact: 10.5+6+4.5+15+15=51) — cannot reach 65.
    assert.equal(serverAviFiveFactor({ citationRate: 30, mentionRate: 30, sentimentScore: 100, coverageRate: 30, positionQuality: 100 }), 51);
  });
});
