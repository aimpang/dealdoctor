import type { AgentReport, ExtractedData, Grade, Issue } from '../../shared/types';

const def = <T>(v: T | undefined | null, fallback: T): T => (v == null ? fallback : v);

function gradeFromIssues(issues: Issue[]): Grade {
  const c = issues.filter((i) => i.severity === 'CRITICAL').length;
  const h = issues.filter((i) => i.severity === 'HIGH').length;
  const m = issues.filter((i) => i.severity === 'MEDIUM').length;
  if (c > 0) return 'F';
  if (h > 2) return 'D';
  if (h > 0) return 'C';
  if (m > 2) return 'B';
  return 'A';
}

/**
 * Pure-code consistency agent. No API calls — runs instantly. Everything
 * defined in the spec.
 */
export function runConsistencyAgent(data: ExtractedData): AgentReport {
  const issues: Issue[] = [];

  const s = data.summaryCard || {};
  const sens = data.sensitivity?.baseCase || {};

  // IRR contradiction
  if (s.irr != null && sens.irr != null && Math.abs(s.irr - sens.irr) > 0.1) {
    issues.push({
      severity: 'CRITICAL',
      title: 'IRR contradiction',
      category: 'irr_mismatch',
      reportSays: `Summary card: ${s.irr}% IRR`,
      conflict: `Sensitivity base case: ${sens.irr}% IRR`,
      fix: 'Both must call the same IRR function with identical inputs',
    });
  }

  // Breakeven across views
  const ic = data.instantCard?.breakeven;
  const fr = data.fullReport?.breakeven;
  if (ic != null && fr != null && Math.abs(ic - fr) > 100) {
    issues.push({
      severity: 'HIGH',
      title: 'Breakeven mismatch',
      category: 'breakeven_mismatch',
      reportSays: `Instant card: $${ic.toLocaleString()}`,
      conflict: `Full report: $${fr.toLocaleString()}`,
      fix: 'Both views must call the same breakeven function',
    });
  }

  // Divergence warning firing when divergence is small
  if (data.avm != null && data.compsMedian != null) {
    const divergence = Math.abs(data.avm - data.compsMedian) / Math.min(data.avm, data.compsMedian);
    if (data.showsDivergenceWarning && divergence < 0.25) {
      issues.push({
        severity: 'HIGH',
        title: 'False divergence warning',
        category: 'false_warning',
        reportSays: 'Warning: "estimates diverge by more than 25%"',
        conflict: `Actual divergence: ${(divergence * 100).toFixed(1)}%`,
        fix: 'Fix threshold comparison logic',
      });
    }

    // Spread label vs actual
    if (data.spreadLabel != null) {
      const actualSpread = divergence * 100;
      if (Math.abs(data.spreadLabel - actualSpread) > 5) {
        issues.push({
          severity: 'HIGH',
          title: 'Spread label misleading',
          category: 'misleading_label',
          reportSays: `"${data.spreadLabel}% SPREAD"`,
          conflict: `Displayed values are ${actualSpread.toFixed(1)}% apart`,
          fix: 'Clarify whether spread = AVM confidence band width or source divergence',
        });
      }
    }
  }

  // Cash flow consistency
  if (s.cashFlow != null && sens.cashFlow != null && Math.abs(s.cashFlow - sens.cashFlow) > 1) {
    issues.push({
      severity: 'HIGH',
      title: 'Cash flow mismatch',
      category: 'cashflow_mismatch',
      reportSays: `Summary: $${s.cashFlow}/mo`,
      conflict: `Sensitivity: $${sens.cashFlow}/mo`,
      fix: 'Both sections must use same cash flow value',
    });
  }

  // Wealth table math
  const years = data.wealthTable?.years || [];
  for (const y of years) {
    const expected = def(y.cumulativeCashFlow, 0) + def(y.cumulativeTaxShield, 0) + def(y.cumulativeEquityBuilt, 0);
    if (Math.abs(def(y.wealth, 0) - expected) > 50) {
      issues.push({
        severity: 'MEDIUM',
        title: `Wealth table math error Y${y.number}`,
        category: 'wealth_math',
        reportSays: `Wealth: $${y.wealth?.toLocaleString()}`,
        conflict: `CF + Tax + Equity = $${expected.toLocaleString()}`,
        fix: 'Verify wealth build formula',
      });
    }
    if (y.equityBuilt != null && y.equityBuilt < 0) {
      issues.push({
        severity: 'MEDIUM',
        title: `Negative "Equity Built" in Y${y.number}`,
        category: 'wealth_math',
        reportSays: `Equity Built: $${y.equityBuilt}`,
        conflict: 'Principal paydown is always positive. If this combines paydown + appreciation, rename the column.',
        fix: "Split into 'Principal Paydown' (positive) and 'Appreciation' (can be negative), or rename to 'Net Equity Change'",
      });
    }
  }

  // PASS verdict with failing metrics
  if (data.verdict?.toUpperCase() === 'PASS') {
    const problems: string[] = [];
    if (data.dscr != null && data.dscr < 1.25) problems.push(`DSCR ${data.dscr} < 1.25 lender threshold`);
    if (!data.hoa && (data.propertyType || '').toLowerCase().includes('condo')) problems.push('HOA missing on condo');
    if (s.irr != null && s.irr < 0) problems.push(`Negative IRR: ${s.irr}%`);
    if (problems.length > 0) {
      issues.push({
        severity: 'LOW',
        title: 'PASS verdict on weak/incomplete data',
        category: 'verdict_questionable',
        reportSays: `PASS Score ${data.score ?? '?'}/100`,
        conflict: problems.join('; '),
        fix: 'Add hard-fail conditions for missing data and failing lender metrics',
      });
    }
  }

  // Rent comp dedup
  const rentComps = data.rentComps || [];
  if (rentComps.length > 1) {
    const normalize = (addr: string) =>
      addr
        .replace(/\b(Apt|Unit|No\.?|#)\b/gi, '')
        .replace(/\s+/g, ' ')
        .replace(/[A-Z]$/i, '')
        .trim()
        .toLowerCase();
    const seen = new Map<string, string[]>();
    for (const c of rentComps) {
      const key = `${normalize(c.address)}|${c.sqft ?? ''}`;
      const prev = seen.get(key) || [];
      prev.push(c.address);
      seen.set(key, prev);
    }
    const dupes = Array.from(seen.values()).filter((v) => v.length > 1);
    if (dupes.length > 0) {
      const dupeList = dupes.map((v) => v.join(' / ')).join('; ');
      issues.push({
        severity: 'MEDIUM',
        title: `${dupes.length} duplicate rent comp${dupes.length > 1 ? 's' : ''}`,
        category: 'duplicate_comps',
        reportSays: `${rentComps.length} rent comps shown`,
        conflict: `${dupeList} appear to be the same unit`,
        fix: 'Deduplicate by normalized address + unit + sqft',
      });
    }
  }

  // ── Expanded invariants ─────────────────────────────────────────────────

  // DSCR plausibility band — 0.6 to 2.5 covers 99% of real deals. Below 0.6
  // means the property can't service its own debt (check math). Above 2.5
  // means rent or debt-service is off by a zero (comp-mismatched or wrong loan).
  if (data.dscr != null) {
    if (data.dscr < 0.6 || data.dscr > 2.5) {
      issues.push({
        severity: data.dscr < 0.3 || data.dscr > 3.5 ? 'HIGH' : 'MEDIUM',
        title: 'DSCR outside plausible range',
        category: 'dscr_range',
        reportSays: `DSCR ${data.dscr.toFixed(2)}`,
        conflict: 'Real investor deals land between 0.6 and 2.5; this is either a math bug or a rent/expense input error',
        fix: 'Recompute: DSCR = NOI / annual debt service. Check units (monthly vs annual) and that NOI is after vacancy/maintenance.',
      });
    }
  }

  // Cap rate vs a coarse US-wide plausible band. Zip-specific bands are nicer
  // but this catches the most common bug — cap rate computed on wrong price
  // or NOI.
  if (data.avm != null && data.rentEstimate != null && data.rentEstimate > 0) {
    // Rough cap rate = (rent * 12 * 0.5 as NOI proxy) / price. 0.5 NOI margin
    // is intentionally loose; refine if we want.
    const grossRentMultiplier = data.avm / (data.rentEstimate * 12);
    // GRM below 4 or above 40 is almost always a data bug.
    if (grossRentMultiplier < 4 || grossRentMultiplier > 40) {
      issues.push({
        severity: 'MEDIUM',
        title: 'Implausible gross-rent-multiplier',
        category: 'grm_range',
        reportSays: `AVM $${data.avm.toLocaleString()} / annual rent $${(data.rentEstimate * 12).toLocaleString()} = GRM ${grossRentMultiplier.toFixed(1)}`,
        conflict: 'Real properties cluster between GRM 6 and 25. Outside [4, 40] implies a units mismatch (per-bedroom rent vs whole-property, or price vs rent scaled wrong).',
        fix: 'Verify rent is whole-property monthly and AVM is total sale price. Cross-check studentHousing multiplier and rentAdjustment.effectiveRent.',
      });
    }
  }

  // Price-per-sqft vs comps median. Huge divergence = different era/quality
  // or wrong sqft.
  if (data.avm != null && data.squareFeet != null && data.squareFeet > 0 && (data.saleComps?.length ?? 0) > 0) {
    const subjectPpsf = data.avm / data.squareFeet;
    const compPpsfs = (data.saleComps ?? [])
      .map((c) => (c.pricePerSqft ?? (c.price != null && c.sqft ? c.price / c.sqft : null)))
      .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
    if (compPpsfs.length >= 2) {
      const sorted = [...compPpsfs].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const divergence = Math.abs(subjectPpsf - median) / median;
      if (divergence > 0.5) {
        issues.push({
          severity: 'MEDIUM',
          title: 'Subject $/sqft diverges >50% from comps',
          category: 'ppsf_divergence',
          reportSays: `Subject ${subjectPpsf.toFixed(0)} $/sqft vs comp median ${median.toFixed(0)} $/sqft`,
          conflict: 'Either the comps are from the wrong submarket/era, or the subject sqft / AVM is off',
          fix: 'Re-select comps in same building or same era; verify property.sqft matches public record',
        });
      }
    }
  }

  // HOA nullity on condo/apartment property types. Zero HOA on a condo is
  // almost always "we failed to capture it", not a real free-HOA condo.
  if ((data.hoa ?? 0) === 0 && data.propertyType) {
    const pt = data.propertyType.toLowerCase();
    if (pt.includes('condo') || pt.includes('apartment') || pt.includes('co-op')) {
      issues.push({
        severity: 'HIGH',
        title: 'HOA missing on condo/apartment property type',
        category: 'hoa',
        reportSays: `propertyType: ${data.propertyType}, monthlyHOA: 0`,
        conflict: 'Condos and apartment-style units essentially always carry HOA fees; 0 means Rentcast lacked the field, not that fees are zero',
        fix: 'Scrape Apartments.com / building listing for actual HOA, or at minimum flag hoaSource: "not-captured" so downstream calcs add a reserve',
      });
    }
  }

  // STR night-cap sanity (DC/NYC/SF have strict non-primary caps). If
  // strProjection is in the data and occupancy > 25% of 365 (~91 nights),
  // flag unless owner-occupied.
  const str = (data.raw as { strProjection?: { occupancyRate?: number; ownerOccupied?: boolean; monthlyGrossRevenue?: number } })?.strProjection;
  if (str && !str.ownerOccupied && (str.occupancyRate ?? 0) > 0.26) {
    const state = (data.raw as { property?: { state?: string } })?.property?.state;
    const strictStates = ['DC', 'NY', 'CA'];
    if (state && strictStates.includes(state)) {
      issues.push({
        severity: 'MEDIUM',
        title: `STR occupancy exceeds ${state} non-primary cap`,
        category: 'str_cap',
        reportSays: `strProjection.occupancyRate: ${str.occupancyRate}`,
        conflict: `${state} caps non-primary STR at ~90 nights/yr (~24.7% occupancy). ${((str.occupancyRate ?? 0) * 100).toFixed(0)}% implies primary-residence use, which the buyer may not have.`,
        fix: 'Cap non-primary occupancy at 0.247 or flag STR verdict as "owner-occupied only"',
      });
    }
  }

  // Year-1 cash flow vs 5-year cumulative cash flow consistency. Typical
  // rent growth is 0-8%/yr; if Y5 cumulative cash flow is <4x or >8x Y1, the
  // growth model is off.
  if (years.length >= 5) {
    const y1 = years[0];
    const y5 = years[4];
    const y1Annual = def(y1?.cumulativeCashFlow, 0);
    const y5Cum = def(y5?.cumulativeCashFlow, 0);
    if (y1Annual > 100 && y5Cum > 0) {
      const ratio = y5Cum / y1Annual;
      if (ratio < 3.5 || ratio > 9) {
        issues.push({
          severity: 'MEDIUM',
          title: 'Year-5 cumulative cash flow inconsistent with Year-1',
          category: 'growth_model',
          reportSays: `Y1 cumulative: $${y1Annual.toLocaleString()}; Y5 cumulative: $${y5Cum.toLocaleString()} (ratio ${ratio.toFixed(2)})`,
          conflict: 'Typical rent/expense growth produces a Y5/Y1 ratio of 4-7. Outside [3.5, 9] suggests bad growth assumptions or compounding bug.',
          fix: 'Verify rentGrowthRate and expenseGrowthRate; check that Y1 is a full year, not Y0 partial',
        });
      }
    }
  }

  // If essentially nothing was extracted, don't return a false "all clear" —
  // flag the extraction gap so the operator knows the audit was degenerate.
  const hasAnyData = [
    data.avm,
    data.rentEstimate,
    data.summaryCard?.irr,
    data.fullReport?.breakeven,
    data.dscr,
  ].some((v) => v != null);
  if (!hasAnyData) {
    issues.push({
      severity: 'HIGH',
      title: 'Extraction yielded no structured data',
      category: 'extraction_failed',
      reportSays: 'no fields recovered from /api/report or DOM scrape',
      conflict: 'Consistency agent cannot run its invariants without numbers',
      fix: 'Either expose window.__DD_REPORT__ in the full-report client component, or update capture.ts mergeData() to match DealDoctor\'s /api/report JSON shape',
    });
  }

  return {
    agent: 'internal_consistency',
    grade: gradeFromIssues(issues),
    issues,
  };
}
