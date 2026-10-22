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
  deriveLightGeoInput,
  documentedSeoScoreFourFactor,
  geoScore,
  isQuickWinKeyword,
  positionScore,
  scoreLevel,
  searchContribution,
  seoScore,
  serverAviFiveFactor,
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
  it('isQuickWinKeyword: rank 5~15, impressions >= 100, CTR < 5%', () => {
    assert.equal(isQuickWinKeyword({ avgPosition: 5, impressions: 100, ctrPercent: 4.99 }), true);
    assert.equal(isQuickWinKeyword({ avgPosition: 15, impressions: 500, ctrPercent: 0 }), true);
    assert.equal(isQuickWinKeyword({ avgPosition: 4.9, impressions: 500, ctrPercent: 1 }), false);
    assert.equal(isQuickWinKeyword({ avgPosition: 16, impressions: 500, ctrPercent: 1 }), false);
    assert.equal(isQuickWinKeyword({ avgPosition: 8, impressions: 99, ctrPercent: 1 }), false);
    assert.equal(isQuickWinKeyword({ avgPosition: 8, impressions: 500, ctrPercent: 5 }), false);
    assert.equal(isQuickWinKeyword({ avgPosition: null, impressions: 500, ctrPercent: 1 }), false);
    assert.equal(isQuickWinKeyword({ avgPosition: 8, impressions: NaN, ctrPercent: 1 }), false);
  });
});
