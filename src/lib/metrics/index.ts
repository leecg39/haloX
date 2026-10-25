/**
 * HaloX Metric Engine (S1)
 * Reconstructed from REA static bundle evidence (E1-1), runtime observations (E4-1),
 * and public Mintlify documentation (S-1).
 */

export type ScoreLevel = 'critical' | 'low' | 'medium' | 'high' | 'excellent';

/**
 * 1st to 10th rank lookup table observed in the original SPA bundle (F5-5).
 * Note: In the original bundle, the `rank >= 10 -> 10` branch is evaluated
 * before indexing `POSITION_SCORE_TABLE[9]` (15), making 15 unreachable at rank=10.
 * We preserve this exact behavior for 1:1 fidelity.
 */
export const POSITION_SCORE_TABLE = [100, 85, 70, 55, 45, 37, 30, 24, 19, 15] as const;

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Convert average SERP rank into a 0-100 position score.
 * - rank <= 0 or null/undefined/NaN -> null
 * - rank <= 1 -> 100
 * - rank >= 10 -> 10 (original branch priority preserved)
 * - 1 < rank < 10 -> linear interpolation between table entries, rounded to 1 decimal place
 */
export function positionScore(rank: number | null | undefined): number | null {
  if (rank === null || rank === undefined || !Number.isFinite(rank) || rank <= 0) {
    return null;
  }
  if (rank <= 1) return 100;
  if (rank >= 10) return 10;

  const lowerIdx = Math.floor(rank) - 1;
  const upperIdx = Math.ceil(rank) - 1;
  if (lowerIdx === upperIdx) {
    return POSITION_SCORE_TABLE[lowerIdx];
  }
  const fraction = rank - Math.floor(rank);
  const lowerVal = POSITION_SCORE_TABLE[lowerIdx];
  const upperVal = POSITION_SCORE_TABLE[upperIdx];
  const interpolated = lowerVal + (upperVal - lowerVal) * fraction;
  return Math.round(interpolated * 10) / 10;
}

export interface SeoScoreInput {
  avgPosition?: number | null;
  positionScoreValue?: number | null;
  top10Rate: number;
  aioCitationRate: number;
}

/**
 * SEO Score = positionScore * 0.4 + top10Rate * 0.3 + aioCitationRate * 0.3 (F5-2).
 * Verified against observed dashboard value: pos=0, top10=0, aio=11 -> 3.3 -> 3.
 */
export function seoScore(input: SeoScoreInput): number {
  const pos =
    input.positionScoreValue !== undefined && input.positionScoreValue !== null
      ? clamp(input.positionScoreValue)
      : (positionScore(input.avgPosition) ?? 0);
  const top10 = clamp(input.top10Rate);
  const aio = clamp(input.aioCitationRate);
  return Math.round(pos * 0.4 + top10 * 0.3 + aio * 0.3);
}

export interface GeoScoreInput {
  citationRate: number;
  mentionRate: number;
  citationRankScore: number;
  mentionRankScore: number;
}

/**
 * GEO Score = citationRate * 0.25 + mentionRate * 0.25 + citationRankScore * 0.25 + mentionRankScore * 0.25 (F5-3).
 * Verified against observed value: 10, 30, 100, 100 -> 60.
 */
export function geoScore(input: GeoScoreInput): number {
  const cRate = clamp(input.citationRate);
  const mRate = clamp(input.mentionRate);
  const cRank = clamp(input.citationRankScore);
  const mRank = clamp(input.mentionRankScore);
  return Math.round(cRate * 0.25 + mRate * 0.25 + cRank * 0.25 + mRank * 0.25);
}

export interface LightGeoRawInput {
  citedPrompts: number;
  totalPrompts: number;
  mentionedRuns: number;
  totalRuns: number;
  normalizedPositionQualitySum: number;
  positionedCitedRuns: number;
}

/**
 * Light-mode GEO input derivation observed in AppOverview chunk (F5-6).
 */
export function deriveLightGeoInput(raw: LightGeoRawInput): GeoScoreInput {
  const citationRate = raw.totalPrompts > 0 ? (raw.citedPrompts / raw.totalPrompts) * 100 : 0;
  const mentionRate = raw.totalRuns > 0 ? (raw.mentionedRuns / raw.totalRuns) * 100 : 0;
  const citationRankScore =
    raw.positionedCitedRuns > 0 ? raw.normalizedPositionQualitySum / raw.positionedCitedRuns : 0;
  return {
    citationRate,
    mentionRate,
    citationRankScore,
    mentionRankScore: 0,
  };
}

export interface AviCompositeInput {
  seo: number;
  geo?: number | null;
  webHealth?: number | null;
  /** Explicit weight override (`pre` bundle contract): when any weight is defined, all three are used as-is. */
  seoWeight?: number;
  geoWeight?: number;
  webWeight?: number;
}

/**
 * Dashboard AVI Composite Score (F5-4, `pre` bundle ground truth) with explicit
 * weight override and 4-way availability branching:
 * - explicit weights present: use them verbatim
 * - SEO + GEO + WebHealth available: 0.4 / 0.3 / 0.3 (Observed: 3, 60, 93 -> 47.1 -> 47)
 * - SEO + GEO only: 0.5 / 0.5
 * - SEO + WebHealth only: 0.6 / 0.4
 * - SEO only: 1.0
 */
export function aviComposite(input: AviCompositeInput): number {
  const seo = clamp(input.seo);
  // Original bundle (`pre`) treats a component as available only when its score is > 0.
  const hasGeo = typeof input.geo === 'number' && Number.isFinite(input.geo) && input.geo > 0;
  const hasWeb = typeof input.webHealth === 'number' && Number.isFinite(input.webHealth) && input.webHealth > 0;

  let wSeo: number;
  let wGeo: number;
  let wWeb: number;
  if (
    input.seoWeight !== undefined ||
    input.geoWeight !== undefined ||
    input.webWeight !== undefined
  ) {
    wSeo = input.seoWeight ?? 0;
    wGeo = input.geoWeight ?? 0;
    wWeb = input.webWeight ?? 0;
  } else if (hasGeo && hasWeb) {
    wSeo = 0.4;
    wGeo = 0.3;
    wWeb = 0.3;
  } else if (hasGeo) {
    wSeo = 0.5;
    wGeo = 0.5;
    wWeb = 0;
  } else if (hasWeb) {
    wSeo = 0.6;
    wGeo = 0;
    wWeb = 0.4;
  } else {
    wSeo = 1;
    wGeo = 0;
    wWeb = 0;
  }
  const webValue = hasWeb ? clamp(input.webHealth!) : 0;
  const geoValue = hasGeo ? clamp(input.geo!) : 0;
  return Math.round(clamp(seo * wSeo + geoValue * wGeo + webValue * wWeb, 0, 100));
}

/**
 * Score level classification (F2-2, F4-1):
 * <20 critical, <40 low, <60 medium, <80 high, >=80 excellent
 */
export function scoreLevel(score: number): ScoreLevel {
  const s = clamp(score);
  if (s < 20) return 'critical';
  if (s < 40) return 'low';
  if (s < 60) return 'medium';
  if (s < 80) return 'high';
  return 'excellent';
}

export interface ServerAviFiveFactorInput {
  citationRate: number;
  mentionRate: number;
  sentimentScore: number;
  coverageRate: number;
  positionQuality: number;
}

/**
 * Documented 5-factor server AVI formula (F2-2 / U-2 local design):
 * 35% citationRate + 20% mentionRate + 15% sentimentScore + 15% coverageRate + 15% positionQuality
 */
export function serverAviFiveFactor(input: ServerAviFiveFactorInput): number {
  return Math.round(
    clamp(input.citationRate) * 0.35 +
      clamp(input.mentionRate) * 0.2 +
      clamp(input.sentimentScore) * 0.15 +
      clamp(input.coverageRate) * 0.15 +
      clamp(input.positionQuality) * 0.15
  );
}

export interface DocumentedSeoFourFactorInput {
  positionScoreValue: number;
  brandSov: number;
  aioCoverage: number;
  trendScore: number;
}

/**
 * Documented 4-factor SEO score from public Mintlify docs (F2-3):
 * 40% position + 30% brandSov + 20% aioCoverage + 10% trendScore
 */
export function documentedSeoScoreFourFactor(input: DocumentedSeoFourFactorInput): number {
  return Math.round(
    clamp(input.positionScoreValue) * 0.4 +
      clamp(input.brandSov) * 0.3 +
      clamp(input.aioCoverage) * 0.2 +
      clamp(input.trendScore) * 0.1
  );
}

/**
 * GA4 AI Traffic Share (%) = (aiSessions / organicSessions) * 100 (F2-4).
 * Clamped to [0, 100] and rounded to 2 decimal places. Returns 0 when organicSessions <= 0.
 */
export function aiTrafficShare(aiSessions: number, organicSessions: number): number {
  if (!Number.isFinite(aiSessions) || !Number.isFinite(organicSessions) || organicSessions <= 0 || aiSessions <= 0) {
    return 0;
  }
  const raw = (aiSessions / organicSessions) * 100;
  return Math.round(clamp(raw, 0, 100) * 100) / 100;
}

/**
 * GSC/GA4 Search Contribution (%) = (gscClicks / organicSessions) * 100 (F2-4).
 * Clamped to [0, 100] and rounded to 2 decimal places. Returns 0 when organicSessions <= 0.
 */
export function searchContribution(gscClicks: number, organicSessions: number): number {
  if (!Number.isFinite(gscClicks) || !Number.isFinite(organicSessions) || organicSessions <= 0 || gscClicks <= 0) {
    return 0;
  }
  const raw = (gscClicks / organicSessions) * 100;
  return Math.round(clamp(raw, 0, 100) * 100) / 100;
}

export interface QuickWinCandidateInput {
  avgPosition: number | null | undefined;
  impressions: number;
  ctrPercent: number;
}

/**
 * Documented Quick Win (public Mintlify docs F2-4, kept for contrast):
 * position 5-15, impressions >= 100, 0 <= CTR < 5. NOT the bundle behavior.
 */
export function documentedQuickWin(input: QuickWinCandidateInput): boolean {
  const { avgPosition, impressions, ctrPercent } = input;
  if (avgPosition === null || avgPosition === undefined || !Number.isFinite(avgPosition)) {
    return false;
  }
  if (!Number.isFinite(impressions) || !Number.isFinite(ctrPercent)) {
    return false;
  }
  return avgPosition >= 5 && avgPosition <= 15 && impressions >= 100 && ctrPercent >= 0 && ctrPercent < 5;
}

/**
 * Quick Win — keyword gap matrix classification (P9 ground truth,
 * `gap-intelligence` chunk `isQuickWin`):
 * keywordDifficulty <= 30 AND 11 <= ourPosition <= 30 (position required).
 */
export interface GapQuickWinInput {
  keywordDifficulty: number;
  ourPosition: number | null | undefined;
}

export function isQuickWinKeyword(input: GapQuickWinInput): boolean {
  const { keywordDifficulty, ourPosition } = input;
  if (ourPosition === null || ourPosition === undefined || !Number.isFinite(ourPosition)) {
    return false;
  }
  if (!Number.isFinite(keywordDifficulty)) return false;
  return keywordDifficulty <= 30 && ourPosition >= 11 && ourPosition <= 30;
}

// ---------------------------------------------------------------------------
// P9 ground truth — extracted from the original 2026-10-25 SPA bundle
// (docs/clone/algorithms/). Every constant and formula below is [observed]
// in the minified chunks cited in the spec docs.
// ---------------------------------------------------------------------------

/** Original bundle gap quadrants (`gap-intelligence` S). */
export type GapType = 'FORTRESS' | 'GEO_GAP' | 'SEO_GAP' | 'CRITICAL';

export function classifyGap(seoStrong: boolean, geoStrong: boolean): GapType {
  if (seoStrong && geoStrong) return 'FORTRESS';
  if (seoStrong && !geoStrong) return 'GEO_GAP';
  if (!seoStrong && geoStrong) return 'SEO_GAP';
  return 'CRITICAL';
}

/** seoStrong = our best rank exists and is <= 10 (`useGapOverview`). */
export function seoStrongFromRank(bestRank: number | null | undefined): boolean {
  return bestRank !== null && bestRank !== undefined && Number.isFinite(bestRank) && bestRank <= 10;
}

export interface GapAggregateInput {
  criticalCount: number;
  geoGapCount: number;
  seoGapCount: number;
  fortressCount: number;
  totalCount: number;
}

export interface GapAggregateResult {
  score: number;
  distribution: { fortress: number; geoGap: number; seoGap: number; critical: number };
  distributionPercent: { fortress: number; geoGap: number; seoGap: number; critical: number };
}

/**
 * Gap aggregate score (`gap-intelligence` _):
 * weights {critical:3, geoGap:2, seoGap:1, fortress:0} over totalCount*3, 0-100.
 */
export function gapAggregateScore(input: GapAggregateInput): GapAggregateResult {
  const weighted =
    input.criticalCount * 3 + input.geoGapCount * 2 + input.seoGapCount * 1 + input.fortressCount * 0;
  const denom = input.totalCount * 3;
  const score = denom > 0 ? Math.round(clamp((weighted / denom) * 100, 0, 100)) : 0;
  const total = input.totalCount || 1;
  const pct = (n: number) => Math.round((n / total) * 1000) / 10;
  return {
    score,
    distribution: {
      fortress: input.fortressCount,
      geoGap: input.geoGapCount,
      seoGap: input.seoGapCount,
      critical: input.criticalCount,
    },
    distributionPercent: {
      fortress: pct(input.fortressCount),
      geoGap: pct(input.geoGapCount),
      seoGap: pct(input.seoGapCount),
      critical: pct(input.criticalCount),
    },
  };
}

export interface OpportunityScoreInput {
  searchVolume: number;
  keywordDifficulty: number;
  gapType: GapType;
  ourPosition: number | null | undefined;
}

export interface OpportunityScoreResult {
  score: number;
  components: { volumeScore: number; difficultyScore: number; gapBonus: number };
  isQuickWin: boolean;
}

/** Gap bonus by quadrant (`gap-intelligence` h). */
export const GAP_BONUS: Record<GapType, number> = {
  CRITICAL: 100,
  GEO_GAP: 70,
  SEO_GAP: 50,
  FORTRESS: 0,
};

/**
 * Opportunity score (`gap-intelligence` v):
 * volumeScore = min(log10(max(volume,1)) * 10, 50)
 * difficultyScore = (100 - min(KD,100)) / 100 * 30
 * score = volumeScore*0.4 + difficultyScore*0.3 + gapBonus*0.3
 * isQuickWin = KD<=30 && 11<=ourPosition<=30 (position required)
 */
export function opportunityScore(input: OpportunityScoreInput): OpportunityScoreResult {
  const volume = Math.max(input.searchVolume, 1);
  const volumeScore = Math.min(Math.log10(volume) * 10, 50);
  const difficultyScore = ((100 - Math.min(input.keywordDifficulty, 100)) / 100) * 30;
  const gapBonus = GAP_BONUS[input.gapType] ?? 0;
  const raw = volumeScore * 0.4 + difficultyScore * 0.3 + gapBonus * 0.3;
  return {
    score: Math.round(clamp(raw, 0, 100)),
    components: {
      volumeScore: Math.round(volumeScore * 10) / 10,
      difficultyScore: Math.round(difficultyScore * 10) / 10,
      gapBonus,
    },
    isQuickWin: isQuickWinKeyword({
      keywordDifficulty: input.keywordDifficulty,
      ourPosition: input.ourPosition,
    }),
  };
}

export interface ContentIssueInput {
  hasArticle: boolean;
  ourPosition: number | null | undefined;
  competitorPosition: number | null | undefined;
  lastUpdatedMonthsAgo: number | null | undefined;
  outdatedThresholdMonths?: number;
}

export type ContentIssue = 'missing_content' | 'outdated_content' | 'weak_content' | null;

/** Content issue classification (`gap-intelligence` p). */
export function contentIssue(input: ContentIssueInput): ContentIssue {
  const threshold = input.outdatedThresholdMonths ?? 12;
  if (!input.hasArticle) return 'missing_content';
  if (input.lastUpdatedMonthsAgo !== null && input.lastUpdatedMonthsAgo !== undefined && input.lastUpdatedMonthsAgo >= threshold) {
    return 'outdated_content';
  }
  if (input.ourPosition !== null && input.ourPosition !== undefined && input.ourPosition > 10 &&
      input.competitorPosition !== null && input.competitorPosition !== undefined && input.competitorPosition <= 10) {
    return 'weak_content';
  }
  return null;
}

export interface CompetitorThreatInput {
  domain: string;
  seoGapCount: number;
  geoGapCount: number;
}

/** Competitor threat level (`gap-intelligence` M): >=50 high, >=20 medium, else low. */
export function competitorThreat(input: CompetitorThreatInput): { domain: string; totalGaps: number; threatLevel: 'high' | 'medium' | 'low' } {
  const totalGaps = input.seoGapCount + input.geoGapCount;
  return {
    domain: input.domain,
    totalGaps,
    threatLevel: totalGaps >= 50 ? 'high' : totalGaps >= 20 ? 'medium' : 'low',
  };
}

/** Gap score label (`gap-intelligence` C). */
export function gapLevelLabel(score: number): 'excellent' | 'good' | 'medium' | 'high' | 'critical' {
  const s = clamp(score);
  if (s <= 20) return 'excellent';
  if (s <= 40) return 'good';
  if (s <= 60) return 'medium';
  if (s <= 80) return 'high';
  return 'critical';
}

export interface FunnelHealthInput {
  gscClicks: number;
  organicSessions: number;
  engagementRate: number;
  hasConversionSetup: boolean;
  organicConversions: number;
}

export type FunnelHealthLevel = 'unknown' | 'blocked' | 'leaking' | 'healthy';

/** Funnel health (`gap-intelligence` T). */
export function funnelHealth(input: FunnelHealthInput): { level: FunnelHealthLevel; reason: string } {
  const { gscClicks, organicSessions, engagementRate, hasConversionSetup, organicConversions } = input;
  if (gscClicks === 0 && organicSessions === 0) {
    return { level: 'unknown', reason: 'No traffic data' };
  }
  if (gscClicks > 10 && organicSessions === 0) {
    return { level: 'blocked', reason: 'GSC clicks exist but no GA4 sessions — tracking issue' };
  }
  if (organicSessions > 10 && engagementRate < 30) {
    return { level: 'leaking', reason: `Low engagement (${engagementRate}%) — content quality issue` };
  }
  if (hasConversionSetup && organicConversions > 0 && engagementRate >= 50) {
    return { level: 'healthy', reason: `Strong funnel: ${engagementRate}% engagement, ${organicConversions} conversions` };
  }
  if (engagementRate >= 40) {
    return { level: 'healthy', reason: `Good engagement: ${engagementRate}%` };
  }
  return { level: 'leaking', reason: `Moderate engagement (${engagementRate}%)` };
}

// --- Core Web Vitals (`score-utils` M/P/a) ---

export type WebVitalKey = 'fcp' | 'lcp' | 'si' | 'tbt' | 'tti' | 'cls' | 'ttfb' | 'fid';

export const WEB_VITAL_THRESHOLDS: Record<WebVitalKey, [number, number]> = {
  fcp: [1800, 3000],
  lcp: [2500, 4000],
  si: [3400, 5800],
  tbt: [200, 600],
  tti: [3800, 7300],
  cls: [0.1, 0.25],
  ttfb: [800, 1800],
  fid: [100, 300],
};

/** Linear web-vital score: <=good -> 100, >=poor -> 0, else 1-(v-good)/(poor-good) rounded. */
export function webVitalScore(key: WebVitalKey, value: number): number {
  const [good, poor] = WEB_VITAL_THRESHOLDS[key];
  if (!Number.isFinite(value)) return 0;
  if (value <= good) return 100;
  if (value >= poor) return 0;
  return Math.round(100 * (1 - (value - good) / (poor - good)));
}

export function webVitalRating(key: WebVitalKey, value: number): 'good' | 'needs-improvement' | 'poor' {
  const [good, poor] = WEB_VITAL_THRESHOLDS[key];
  if (!Number.isFinite(value)) return 'poor';
  if (value <= good) return 'good';
  if (value <= poor) return 'needs-improvement';
  return 'poor';
}

// --- Grounding tiers (`grounding-thresholds`) ---

export type SourceTier = 'official' | 'reputable' | 'community' | 'unknown';
export type ClaimKind =
  | 'pricing' | 'policy' | 'promotion' | 'update' | 'tech_version' | 'benchmark'
  | 'statistic' | 'feature' | 'comparison' | 'definition' | 'mechanism' | 'risk'
  | 'quote' | 'general';

export const GROUNDING_MIN_SEGMENT_LENGTH = 40;
export const GROUNDING_MIN_SOURCE_CONFIDENCE = 0.3;

export const CLAIM_CONFIDENCE_THRESHOLD: Record<SourceTier, number> = {
  official: 0.4,
  reputable: 0.6,
  community: 0.6,
  unknown: 0.8,
};

export const TIER_KIND_RULES: Record<ClaimKind, SourceTier[]> = {
  pricing: ['official'],
  policy: ['official'],
  promotion: ['official'],
  update: ['official', 'reputable'],
  tech_version: ['official', 'reputable'],
  benchmark: ['official', 'reputable'],
  statistic: ['official', 'reputable'],
  feature: ['official', 'reputable', 'community'],
  comparison: ['official', 'reputable', 'community'],
  definition: ['official', 'reputable', 'community', 'unknown'],
  mechanism: ['official', 'reputable', 'community'],
  risk: ['official', 'reputable', 'community'],
  quote: ['official', 'reputable', 'community'],
  general: ['official', 'reputable', 'community', 'unknown'],
};

export function tierKindAllowed(kind: ClaimKind, tier: SourceTier): boolean {
  return (TIER_KIND_RULES[kind] ?? ['official', 'reputable', 'community', 'unknown']).includes(tier);
}

/** Source tier priority for best-source selection: official > reputable > community > unknown. */
export function tierPriority(tier: SourceTier): number {
  return { official: 3, reputable: 2, community: 1, unknown: 0 }[tier];
}

// --- Freshness (`freshness`) ---

export type FreshnessClass = 'high' | 'medium' | 'low';

export function freshnessClassify(ageDays: number | undefined): FreshnessClass {
  if (ageDays === undefined) return 'medium';
  if (ageDays < 30) return 'high';
  if (ageDays < 90) return 'medium';
  return 'low';
}

export interface GoalStatusInput {
  hasArticle: boolean;
  publishedAt: Date | string | null | undefined;
  weeklyTargetWeeks: number;
  currentRank: number | null | undefined;
  bestRank: number | null | undefined;
}

export type GoalStatus = 'no_article' | 'not_published' | 'pending' | 'due_soon' | 'overdue' | 'achieved';

export function goalStatus(input: GoalStatusInput): GoalStatus {
  const effectiveBest =
    [input.currentRank, input.bestRank]
      .filter((r): r is number => typeof r === 'number' && r > 0)
      .length > 0
      ? Math.min(
          ...([input.currentRank, input.bestRank].filter(
            (r): r is number => typeof r === 'number' && r > 0,
          ) as number[]),
        )
      : null;
  if (effectiveBest !== null && effectiveBest <= 10) return 'achieved';
  if (!input.hasArticle) return 'no_article';
  if (!input.publishedAt) return 'not_published';
  const published = typeof input.publishedAt === 'string' ? new Date(input.publishedAt) : input.publishedAt;
  const ageDays = Math.floor((Date.now() - published.getTime()) / 86400000);
  const targetDays = input.weeklyTargetWeeks * 7;
  if (ageDays >= targetDays) return 'overdue';
  if (ageDays >= targetDays - 7) return 'due_soon';
  return 'pending';
}

// --- CTR benchmarks (`ctr-benchmarks`) ---

/** Positional CTR benchmark (%), 1st..10th then everything beyond. */
export function ctrBenchmark(position: number): number {
  if (position <= 1) return 28;
  if (position <= 2) return 15;
  if (position <= 3) return 11;
  if (position <= 4) return 8;
  if (position <= 5) return 6.3;
  if (position <= 6) return 4.5;
  if (position <= 7) return 3.5;
  if (position <= 8) return 2.9;
  if (position <= 9) return 2.4;
  if (position <= 10) return 2.1;
  return 1;
}

export interface SerpQuickWinInput {
  avgPosition: number;
  impressions: number;
  ctr: number;
}

/** SERP quick-win / CTR-gap classification variant `c` (keyword stats: pos 4-10, impressions > 50). */
export function serpQuickWin(input: SerpQuickWinInput): { type: 'quick-win' | 'ctr-gap' | null } {
  if (input.avgPosition >= 4 && input.avgPosition <= 10 && input.impressions > 50) {
    const bench = ctrBenchmark(input.avgPosition);
    return input.ctr < bench * 0.6 ? { type: 'ctr-gap' } : { type: 'quick-win' };
  }
  return { type: null };
}

// --- Engines (`tT` family) ---

export const GEO_ENGINES = ['chatgpt', 'gemini', 'perplexity', 'claude'] as const;
export type GeoEngine = (typeof GEO_ENGINES)[number];

export const ENGINE_DOMAINS: Record<GeoEngine, string> = {
  chatgpt: 'chatgpt.com',
  gemini: 'gemini.google.com',
  perplexity: 'perplexity.ai',
  claude: 'claude.ai',
};

export const ENGINE_LABELS: Record<GeoEngine, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Pplx',
  claude: 'Claude',
};

/** Engine normalization (`PH`): "openai" -> "chatgpt", anything unknown -> "chatgpt". */
export function engineNormalize(engine: string): GeoEngine {
  if (engine === 'openai') return 'chatgpt';
  return (GEO_ENGINES as readonly string[]).includes(engine) ? (engine as GeoEngine) : 'chatgpt';
}

// --- Rounding helpers (`Hb`, `dre`) ---

/** Citation rate in % with one decimal: round(cited/total*1000)/10; total 0 -> 0. */
export function citationRatePct(cited: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((cited / total) * 1000) / 10;
}

/** Plain percent share: round(part/total*100); total 0 -> 0. */
export function percentShare(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}

// --- GEO run flags (`calculateKpiStats` z/B/H/q) ---

export interface GeoRunMetrics {
  brand_mentioned?: boolean | null;
  is_cited?: boolean | null;
  our_source_count?: number | null;
  source_but_not_cited?: boolean | null;
  competitor_citation_count?: number | null;
}

export interface GeoRunFlags {
  mentioned: boolean;
  sourced: boolean;
  cited: boolean;
  hasCompetitorCitation: boolean;
  sourcedOnly: boolean;
  ghost: boolean;
  mentionOnly: boolean;
  compOnlyCited: boolean;
}

/** Per-run state flags from the original KPI pipeline. */
export function geoRunFlags(m: GeoRunMetrics): GeoRunFlags {
  const mentioned = !!m.brand_mentioned;
  const cited = !!m.is_cited;
  const sourced = !!m.is_cited || (m.our_source_count ?? 0) > 0 || !!m.source_but_not_cited;
  const hasCompetitorCitation = (m.competitor_citation_count ?? 0) > 0;
  return {
    mentioned,
    sourced,
    cited,
    hasCompetitorCitation,
    sourcedOnly: sourced && !cited,
    ghost: cited && !mentioned,
    mentionOnly: mentioned && !cited,
    compOnlyCited: !cited && hasCompetitorCitation,
  };
}

/** 9-hour UTC offset used by the original window boundary (KST day end). */
export const GEO_WINDOW_UTC_OFFSET_MS = 9 * 60 * 60 * 1000;
export const GEO_KPI_WINDOW_DAYS = 28;

// --- Brand scope (`classifyBrandScope`) ---

export type BrandScope = 'brand' | 'competitor' | 'non_brand';

function scopeNormalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function scopeMatch(normalized: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const c = scopeNormalize(candidate);
    if (c && normalized.includes(c)) return candidate;
  }
  return null;
}

export function brandScopeClassify(
  text: string,
  brands: string[],
  competitors: string[],
): { scope: BrandScope; matchedBrand: string | null; matchedCompetitor: string | null } {
  if (!text) return { scope: 'non_brand', matchedBrand: null, matchedCompetitor: null };
  const normalized = scopeNormalize(text);
  const brand = scopeMatch(normalized, brands);
  const competitor = scopeMatch(normalized, competitors);
  if (brand) return { scope: 'brand', matchedBrand: brand, matchedCompetitor: competitor };
  if (competitor) return { scope: 'competitor', matchedBrand: null, matchedCompetitor: competitor };
  return { scope: 'non_brand', matchedBrand: null, matchedCompetitor: null };
}

// --- Server AVI (`get_avi_overview`) — resolved by original experiment (P9, U-2) ---
// docs/clone/algorithms/server-avi.md: observed averageScore 65 from components
// {mentionRate 30, citationRate 30, mentionRank 100, citationRank 100} matches the
// GEO 4-element formula exactly; the documented 5-factor formula is refuted (max 51 < 65).

export interface ServerAviOverviewInput {
  mentionRate: number;
  citationRate: number;
  mentionRankScore: number;
  citationRankScore: number;
}

/** Server AVI = same 4-element quarter-weight formula as the GEO score (observed, not documented). */
export function serverAviOverviewScore(input: ServerAviOverviewInput): number {
  return geoScore({
    citationRate: input.citationRate,
    mentionRate: input.mentionRate,
    citationRankScore: input.citationRankScore,
    mentionRankScore: input.mentionRankScore,
  });
}
