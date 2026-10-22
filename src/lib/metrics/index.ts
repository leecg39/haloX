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
}

/**
 * Dashboard AVI Composite Score (F5-4) with 4-way availability branching:
 * - SEO + GEO + WebHealth available: 0.4 / 0.3 / 0.3 (Observed: 3, 60, 93 -> 47.1 -> 47)
 * - SEO + GEO only: 0.5 / 0.5
 * - SEO + WebHealth only: 0.6 / 0.4
 * - SEO only: 1.0
 */
export function aviComposite(input: AviCompositeInput): number {
  const seo = clamp(input.seo);
  const hasGeo = typeof input.geo === 'number' && Number.isFinite(input.geo);
  const hasWeb = typeof input.webHealth === 'number' && Number.isFinite(input.webHealth);

  if (hasGeo && hasWeb) {
    return Math.round(seo * 0.4 + clamp(input.geo!) * 0.3 + clamp(input.webHealth!) * 0.3);
  }
  if (hasGeo) {
    return Math.round(seo * 0.5 + clamp(input.geo!) * 0.5);
  }
  if (hasWeb) {
    return Math.round(seo * 0.6 + clamp(input.webHealth!) * 0.4);
  }
  return Math.round(seo);
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
 * Quick Win Keyword classification (F2-4):
 * Average position between 5 and 15 (inclusive), impressions >= 100, and 0 <= CTR (%) < 5.
 */
export function isQuickWinKeyword(input: QuickWinCandidateInput): boolean {
  const { avgPosition, impressions, ctrPercent } = input;
  if (avgPosition === null || avgPosition === undefined || !Number.isFinite(avgPosition)) {
    return false;
  }
  if (!Number.isFinite(impressions) || !Number.isFinite(ctrPercent)) {
    return false;
  }
  return avgPosition >= 5 && avgPosition <= 15 && impressions >= 100 && ctrPercent >= 0 && ctrPercent < 5;
}
