import { prisma } from './db'
import { logger } from './logger'
import type { Report } from '@prisma/client'
import { runInvariantCheck, InvariantGateError, type InvariantFailure } from './invariantCheck'
import { runReviewLoop, type ReviewConcern } from './reviewReport'
import {
  searchProperty,
  getRentEstimate,
  getComparableSales,
  getRentComps,
  getMarketSnapshot,
  buildingKey,
  isUnitLikeAddress,
  type PropertyData,
  type RentEstimate,
  type MarketSnapshot,
} from './propertyApi'
import {
  hasResolvedListingPrice,
  parseListingPriceResolution,
} from './listing-price-resolution'
import { resolveListingPrice } from './property-value-signals'
import {
  getCurrentRates,
  applyInvestorPremium,
  INVESTOR_PREMIUM,
  type Strategy,
  type CurrentRates,
} from './rates'
import {
  calculateDealMetrics,
  calculateBreakEvenPrice,
  calculateCashToClose,
  projectWealth,
  calculateHoldPeriodIRR,
  computeCompositeScore,
  calculateFinancingAlternatives,
  calculateSensitivity,
  calculateRecommendedOffers,
  calculateSTRProjection,
  getStatePropertyTaxGrowth,
  STATE_RULES,
  CITY_RULES,
  getJurisdictionRules,
  isStrProhibitedForInvestor,
} from './calculations'
import { generateDealDoctor, estimateSTRRevenue, type DealDoctorOutput } from './dealDoctor'
import { getClimateAndInsurance, type ClimateAndInsurance } from './climateRisk'
import { getLocationSignals, type LocationSignals } from './locationSignals'
import { resolveMonthlyInsuranceEstimate } from './property-insurance'
import {
  applyStudentHousingHeuristic,
  matchesKnownStudentComplex,
  crossCheckRentAgainstComps,
} from './studentHousing'
import { lookupBuildingHoa, isKnownCondoBuilding } from './buildingHoa'
import {
  attachReviewStage,
  buildAuthorityAudit,
  buildMarketAudit,
  buildPropertyProfileAudit,
  buildQualityAudit,
  createPendingMarketAudit,
  QualityAuditError,
} from './qualityAudit'
import { evaluateFirstPageTrust } from './first-page-trust'

/**
 * The inputs composeFullReport needs. All external-service calls happen in
 * generateFullReport; compose is a pure function of these results + the
 * Report row. `PromiseSettledResult` preserves rejection info so compose can
 * log per-endpoint failures and degrade gracefully.
 */
export interface ReportFetchResults {
  property: PropertyData
  rates: CurrentRates
  rentEstimate: PromiseSettledResult<RentEstimate | null>
  saleComps: PromiseSettledResult<any[]>
  rentComps: PromiseSettledResult<any[]>
  marketSnapshot: PromiseSettledResult<MarketSnapshot | null>
  climate: PromiseSettledResult<ClimateAndInsurance | null>
  locationSignals: PromiseSettledResult<LocationSignals | null>
}

/**
 * AI narration factory — injected into composeFullReport so tests can pass a
 * deterministic stub instead of calling Anthropic. Default wires to the real
 * Claude Haiku generator.
 */
export type AiGenerator = typeof generateDealDoctor

export interface ReportWarning {
  code:
    | 'multi-unit-property'
    | 'manufactured-home'
    | 'condo-no-hoa-captured'
    | 'state-rules-fallback'
    | 'bed-bath-ratio-mismatch'
    | 'rent-comps-wide-spread'
    | 'property-profile-inferred'
    | 'bedrooms-implausible'
    | 'bedroom-matched-comp-divergence'
    | 'comps-cross-building'
    | 'appreciation-suspect'
    | 'value-triangulation-single-signal'
    | 'hoa-above-building-avg'
    | 'nyc-likely-coop'
    | 'rent-avm-below-comps'
    | 'sqft-corrected'
    | 'property-tax-likely-exempted'
    | 'year-built-implausible'
    | 'price-per-sqft-implausible'
    | 'property-classification-uncertain'
    | 'thin-comp-set'
    | 'condo-weak-same-building-support'
    | 'condo-misclassified'
    | 'listing-price-unavailable'
    | 'florida-condo-structural-diligence'
    | 'florida-condo-insurance-diligence'
    | 'sqft-bedroom-mismatch'
    | 'avm-wide-range'
    | 'avm-extremely-wide'
  message: string
}

function isCondoLikePropertyType(propertyType?: string | null): boolean {
  return /condo|apartment|high[\s-]?rise|co[- ]?op/i.test(propertyType || '')
}

/**
 * Build the report-level warnings array. Pure function so we can unit-test
 * each class-of-property / data-gap branch without spinning up a full
 * composeFullReport call.
 *
 * Each class corresponds to a real bug uncovered in the 10-address pressure
 * audit: multi-unit bed/value mismatch (Hialeah), manufactured-home depreciation
 * misfit (Myrtle Beach), condo with missing HOA (Chicago high-rise), and
 * silent TX fallback for states not in STATE_RULES (Santa Fe).
 */
export function buildReportWarnings(input: {
  propertyType?: string | null
  monthlyHOA: number
  stateRulesMissing: boolean
  state: string
  bedrooms?: number | null
  bathrooms?: number | null
  squareFeet?: number | null
  yearBuilt?: number | null
  askPrice?: number | null
  rentCompRents?: Array<number>       // raw rent values (finite, >0) for spread analysis
  // Rent AVM (what Rentcast returns) vs. the comp median, for flagging a
  // systematic under-estimate in luxury markets where the AVM regularly
  // lags same-building listings by 50–200% (Chicago Kingsbury, LA
  // Hollywood audits). When the comp median sits materially above the AVM
  // we present the comp median as an alternate scenario anchor.
  rentAvmMonthly?: number | null
  rentCompMedianMonthly?: number | null
  // NYC co-op hint — surfaces sublet / board-approval caveats that don't
  // apply to condos.
  likelyNYCCoop?: boolean
  dataCompleteness?: 'full' | 'avm-only'
  // Subject's Rentcast AVM value + our own bedroom-matched comp median. When
  // they diverge (>15%) with enough comps to be credible, the AVM is
  // probably blending different unit types (e.g., studios + junior 1-beds
  // at overlapping sqft) and the comp median is the better anchor.
  subjectAvmValue?: number
  bedroomMatchedCompMedian?: number
  bedroomMatchedCompCount?: number
  // For condo/apartment subjects: does the subject have a parseable
  // building key, and did the comp set include at least one same-building
  // match? When no, the comps are from elsewhere in the neighborhood —
  // a structurally weaker anchor than in-building units.
  subjectHasBuildingKey?: boolean
  sameBuildingCompCount?: number
  totalCompCount?: number
  // Sale comps whose address sits at the subject's building key AND carries
  // a unit marker (Unit/#/Apt/Suite). When ≥2, the "building" is really a
  // multi-unit structure and the subject — even if Rentcast labeled it
  // "Single Family" — is almost certainly a condo unit.
  sameBuildingUnitCompCount?: number
  // Zip 12-month appreciation (raw decimal, e.g. 0.22 = +22%). Flagged when
  // it exceeds ~15% OR diverges sharply from rent growth — small-N artifacts
  // and mix-shift can blow up a trailing-12mo median swing.
  zipAppreciation12mo?: number | null
  zipRentGrowth12mo?: number | null
  // Number of independent value signals used in triangulation. When < 2
  // (AVM only, no sale-comp median / tax assessment / grown-sale to anchor),
  // "high confidence" is misleading regardless of the spread.
  valueSignalCount?: number
  // Building-level HOA average from buildingHoa.ts, when we have a record.
  // Used to flag when the captured listing HOA sits materially above the
  // known building average (often a tier/sqft-driven premium, sometimes a
  // listing-sheet error).
  buildingHoaAvg?: number | null
  hoaSource?: 'listing' | 'building-db' | 'building-avg' | 'inferred-condo-default' | 'not-captured'
}): ReportWarning[] {
  const warnings: ReportWarning[] = []
  const pt = input.propertyType || ''
  const condoLikeSubject =
    isCondoLikePropertyType(pt) || (input.sameBuildingUnitCompCount ?? 0) >= 2

  // Rentcast /properties 404'd → we synthesized bed/bath/sqft/year-built from
  // AVM comparables rather than direct measurement. The report is still
  // useful (AVM price is real) but these inferred fields are honest estimates,
  // not facts about the subject.
  if (input.dataCompleteness === 'avm-only') {
    warnings.push({
      code: 'property-profile-inferred',
      message: `We couldn't find a direct property record for this address in our data source — the AVM (price) is real, but bed/bath/sqft/year-built were inferred from the median of nearby comparable sales. Verify these fields against the listing before trusting comp-driven math (comp matching, rent AVM, 5-year projection).`,
    })
  }

  if (/duplex|triplex|quadruplex|multi[\s-]?family/i.test(pt)) {
    warnings.push({
      code: 'multi-unit-property',
      message: `Property type is "${pt}". Rentcast often returns one unit's bed/bath count combined with whole-property value, producing an inconsistent picture. Verify the listing's unit configuration and split the rent/value between units before relying on these numbers.`,
    })
  }

  if (/manufactured|mobile home/i.test(pt)) {
    warnings.push({
      code: 'manufactured-home',
      message: `Property type is "${pt}". Manufactured and mobile homes often depreciate rather than appreciate, and land/site-lease terms can dominate the deal economics. The 5-year wealth projection and 27.5-yr depreciation schedule assume a standard residential structure — treat projected appreciation and tax shield as upper bounds, and verify whether the land is owned or leased.`,
    })
  }

  if (/condo|apartment|high.rise|co[- ]?op/i.test(pt) && input.monthlyHOA === 0) {
    warnings.push({
      code: 'condo-no-hoa-captured',
      message: `Property type is "${pt}" but no HOA fee was captured from the data source. Condo / apartment units almost always carry monthly dues ($200–$800+ is common). Verify HOA from the listing and re-run — a $500/mo HOA would reduce net cash flow by $6,000/yr.`,
    })
  }

  if (input.stateRulesMissing) {
    warnings.push({
      code: 'state-rules-fallback',
      message: `State "${input.state}" isn't in our per-state rules table; we fell back to Texas defaults (1.8% property tax, no rent control, landlord-friendly, no statewide STR ban). Verify the actual property-tax rate and STR rules for this jurisdiction before trusting the numbers.`,
    })
  }

  // Bed/bath ratio mismatch — Rentcast occasionally returns a low bedroom
  // count on a large estate (3BR with 6.5 baths on 5,693 sqft surfaced in
  // the Old Westbury audit). Bathrooms > 1.5× bedrooms is implausible; the
  // bedroom field is probably wrong, which cascades into comp matching.
  if (
    typeof input.bedrooms === 'number' &&
    typeof input.bathrooms === 'number' &&
    input.bedrooms > 0 &&
    input.bathrooms > input.bedrooms * 1.5
  ) {
    warnings.push({
      code: 'bed-bath-ratio-mismatch',
      message: `Bedroom count (${input.bedrooms}) looks low relative to bathrooms (${input.bathrooms}) — a ratio of >1.5 baths per bedroom is uncommon. The bedroom count drives comp matching, so the sale and rent comps may be pulling properties of the wrong size. Verify against the listing.`,
    })
  }

  // Bedrooms implausibly high for the square footage — catches the DC
  // Dupont Circle case where a 501 sqft studio had been silently upgraded
  // to 3BR (the `|| 3` default in propertyApi.ts), producing 167 sqft/bed.
  // Rule of thumb: a real bedroom needs ~200 sqft of building footprint
  // (bedroom + share of kitchen/bath/living). Below that the bedroom count
  // is almost certainly wrong.
  if (
    typeof input.bedrooms === 'number' &&
    input.bedrooms > 0 &&
    typeof input.squareFeet === 'number' &&
    input.squareFeet > 0 &&
    input.squareFeet / input.bedrooms < 200
  ) {
    warnings.push({
      code: 'bedrooms-implausible',
      message: `Bedroom count (${input.bedrooms}) is high relative to the property's square footage (${input.squareFeet} sqft, ~${Math.round(input.squareFeet / input.bedrooms)} sqft/bed). Real bedrooms need ~200+ sqft apiece. The bedroom count drives comp matching + rent AVM, so both may be off. Verify against the listing — a studio or 1BR misclassified as 3BR is the typical cause.`,
    })
  }

  // Bedroom-matched comp divergence. Rentcast's /avm/value doesn't filter
  // by bedroom count — for a studio in a building that also has junior
  // 1-beds at similar sqft, the AVM blends both pools and undershoots.
  // Our own getComparableSales DOES filter by bedroom count, so when its
  // median diverges >15% from the AVM with ≥3 same-bed comps, the AVM is
  // probably wrong for this unit type. (Washington DC Dupont Circle audit.)
  if (
    typeof input.subjectAvmValue === 'number' &&
    input.subjectAvmValue > 0 &&
    typeof input.bedroomMatchedCompMedian === 'number' &&
    input.bedroomMatchedCompMedian > 0 &&
    typeof input.bedroomMatchedCompCount === 'number' &&
    input.bedroomMatchedCompCount >= 3
  ) {
    const divergence =
      Math.abs(input.bedroomMatchedCompMedian - input.subjectAvmValue) /
      input.subjectAvmValue
    if (divergence > 0.15) {
      const higher =
        input.bedroomMatchedCompMedian > input.subjectAvmValue ? 'above' : 'below'
      warnings.push({
        code: 'bedroom-matched-comp-divergence',
        message: `The bedroom-matched comp median ($${Math.round(input.bedroomMatchedCompMedian).toLocaleString()}, ${input.bedroomMatchedCompCount} comps) is ${Math.round(divergence * 100)}% ${higher} the AVM ($${Math.round(input.subjectAvmValue).toLocaleString()}). AVMs can blend different unit types at overlapping square footage (e.g. studios mixed with junior 1-beds). Prefer the same-bedroom comp median as the value anchor when the divergence is this large.`,
      })
    }
  }

  // Cross-building comp fallback. When the subject has a clear building key
  // (number + street) — typical for condos / apartments — and ZERO of the
  // returned comps share that building, the comp set is all from nearby
  // buildings. Values can diverge sharply from in-building peers (the DC
  // "Apolline" audit: Apolline studios $247–337k, returned comps from
  // "Wisteria Mansion" 0.7 mi away at $257k). Flag it so the user knows.
  if (
    input.subjectHasBuildingKey &&
    typeof input.totalCompCount === 'number' &&
    input.totalCompCount > 0 &&
    (input.sameBuildingCompCount ?? 0) === 0
  ) {
    warnings.push({
      code: 'comps-cross-building',
      message: `All ${input.totalCompCount} sale comps are from nearby buildings, not the subject's own building. For condos / apartments that's materially weaker signal — same-building peers usually diverge from neighborhood comps by 10–20%. Cross-check the subject building's recent sales directly (Redfin / the listing agent) before trusting the median.`,
    })
  }

  // Thin comp set — 0 or 1 sale comp returned. A single comp can't establish
  // a median or confirm a price range; the AVM is essentially unchecked.
  // Chicago 1847 N California audit: Rentcast returned one comp on a different
  // street, missing three $635-640k same-block condo sales. Better to flag
  // "valuation uncertain — independent appraisal recommended" than to anchor
  // the buyer on a single stray data point.
  if (
    condoLikeSubject &&
    input.subjectHasBuildingKey &&
    typeof input.totalCompCount === 'number' &&
    input.totalCompCount > 1 &&
    (input.sameBuildingCompCount ?? 0) === 1
  ) {
    warnings.push({
      code: 'condo-weak-same-building-support',
      message: `Only 1 same-building sale comp supports this condo valuation; the other ${Math.max(
        input.totalCompCount - 1,
        0
      )} comp${input.totalCompCount - 1 === 1 ? '' : 's'} are from nearby buildings. That is not enough in-building evidence to call the value tight. Treat ARV, DSCR, and offer guidance as low-confidence until you confirm more recent same-building sales.`,
    })
  }

  // Thin comp set: 0 or 1 sale comp returned. A single comp cannot establish
  // a median or confirm a price range; the AVM is essentially unchecked.
  if (
    typeof input.totalCompCount === 'number' &&
    input.totalCompCount <= 1
  ) {
    warnings.push({
      code: 'thin-comp-set',
      message: `Only ${input.totalCompCount} sale comp${input.totalCompCount === 1 ? '' : 's'} returned for this property. A valuation built on zero or one comps is effectively unchecked — the AVM has no peer anchors to verify against. Pull recent same-block / same-building sales from Redfin or your agent's MLS before trusting the ARV or offer math.`,
    })
  }

  // Property classification uncertain — Rentcast's propertyType is notoriously
  // weak in dense urban markets (Chicago, NYC, DC) where vintage 2-4 flats,
  // condos, and multi-family units all get filed under "Apartment". When the
  // HOA is an inferred market default (not captured from a real listing or
  // building DB), we have a strong signal the subject is a condo/multi that
  // needs manual verification — running single-unit math on what may be a
  // whole 4-flat (or conversely, treating a condo as a standalone apartment)
  // cascades errors through every downstream number.
  if (
    input.hoaSource === 'inferred-condo-default' &&
    input.propertyType &&
    /^apartment$/i.test(input.propertyType.trim())
  ) {
    warnings.push({
      code: 'property-classification-uncertain',
      message: `Property is classified as "${input.propertyType}" by our data source but the HOA above is an inferred market default — we have no real confirmation this is a standalone apartment vs. a condo unit in a converted building vs. a single floor of a multi-family. This is a data-classification gap that cascades into every number below (rent math, financing, HOA, cash flow). Before acting on this report, confirm on the actual listing whether you're buying a condo unit (HOA applies), a whole multi-family building (no HOA, rental income from other units offsets the mortgage), or a true single-unit apartment.`,
    })
  }

  // Condo misclassified as Single Family. Rentcast regularly returns
  // "Single Family" for individual condo units in high-rise buildings
  // (54 Rainey St Austin / The Milago, 1847 N California Chicago). When
  // multiple same-building sale comps carry unit markers (#, Unit, Apt),
  // the structure is a multi-unit building and a "Single Family" label on
  // the subject is almost certainly wrong. HOA, financing, and cash-flow
  // math all misfire on a misclassified condo.
  if (
    /^single family$/i.test(pt.trim()) &&
    (input.sameBuildingUnitCompCount ?? 0) >= 2
  ) {
    warnings.push({
      code: 'condo-misclassified',
      message: `Property is labeled "Single Family" but ${input.sameBuildingUnitCompCount} sale comps at the same street address carry unit numbers — the building is almost certainly multi-unit and this is a condo unit misclassified by our data source. HOA ($0 assumed), financing eligibility, and cash-flow math below are likely wrong. Pull the actual listing before acting on this report.`,
    })
  }

  if (input.state.trim().toUpperCase() === 'FL' && condoLikeSubject) {
    warnings.push({
      code: 'florida-condo-structural-diligence',
      message: `Florida condo underwriting is incomplete without the association documents. Before trusting this report, verify the milestone inspection / reserve study status, current reserve funding, board minutes, deferred-maintenance items, and any pending or recently approved special assessments.`,
    })
    warnings.push({
      code: 'florida-condo-insurance-diligence',
      message: `Florida condo cash flow can move fast on insurance and dues repricing. Verify the current master-policy premium, wind/flood coverage, deductible structure, litigation status, and any planned HOA dues increase before relying on the monthly cash flow or DSCR below.`,
    })
  }

  // Square-footage / bedroom ratio sanity. Rentcast occasionally maps the
  // wrong unit's floor-plan size onto a condo address without a unit
  // number — e.g. returning unit 804's 1,189 sqft 2BD/2BA plan for a
  // 1BD/1BA query at the same street address. Downstream rent and
  // value math then use a square footage that belongs to a different
  // unit type. Thresholds: >900 sqft for 1BD, >1,400 for 2BD, >700
  // sqft-per-bed for 3BD+.
  if (
    typeof input.squareFeet === 'number' &&
    typeof input.bedrooms === 'number' &&
    input.bedrooms > 0 &&
    input.squareFeet > 0
  ) {
    const sqftPerBed = input.squareFeet / input.bedrooms
    const oversized =
      (input.bedrooms === 1 && input.squareFeet > 900) ||
      (input.bedrooms === 2 && input.squareFeet > 1400) ||
      (input.bedrooms >= 3 && sqftPerBed > 700)
    if (oversized) {
      warnings.push({
        code: 'sqft-bedroom-mismatch',
        message: `Square footage (${input.squareFeet.toLocaleString()} sqft) is unusually large for a ${input.bedrooms}-bed unit (${Math.round(sqftPerBed)} sqft per bedroom). In condo buildings without a unit number, our data source occasionally returns a different unit's floor plan — verify the actual unit size against the listing before trusting rent, value, or cash-flow math below.`,
      })
    }
  }

  // Zip appreciation cross-check. Trailing-12mo median-sale swings in
  // narrow zips can hit 20%+ purely from mix shift (one luxury sale lands
  // in the trailing window) — folding that into a 5-yr wealth projection
  // overstates equity from appreciation. Flag when it exceeds 15%, OR when
  // it diverges sharply from rent growth (rent falling while sale prices
  // rocket up is almost always a data artifact, not real momentum).
  if (
    typeof input.zipAppreciation12mo === 'number' &&
    Number.isFinite(input.zipAppreciation12mo)
  ) {
    const appr = input.zipAppreciation12mo
    const rent = typeof input.zipRentGrowth12mo === 'number' ? input.zipRentGrowth12mo : null
    const divergesFromRent = rent != null && rent < 0 && appr > 0.08
    if (appr > 0.15 || divergesFromRent) {
      warnings.push({
        code: 'appreciation-suspect',
        message: `Zip 12-month appreciation prints at ${(appr * 100).toFixed(1)}%${
          rent != null ? ` while rent growth is ${(rent * 100).toFixed(1)}%` : ''
        }. Trailing-12mo medians in small zips can swing dramatically from mix shift or a single luxury sale. Cross-check against Redfin/Zillow for the same zip before trusting the 5-year wealth projection — we cap appreciation at 3% in the model when this divergence is present, but the market snapshot shows the raw print.`,
      })
    }
  }

  // Single-signal value triangulation. When the only value signal is the
  // AVM (no sale-comp median, no tax assessment, no grown-sale), the price
  // input to every downstream metric is unverified. Flag so users know to
  // cross-check on Zillow/Redfin/Homes.com before trusting the number.
  if (typeof input.valueSignalCount === 'number' && input.valueSignalCount < 2) {
    warnings.push({
      code: 'value-triangulation-single-signal',
      message: `The property's value is anchored on a single signal (AVM only) — no sale-comp median, tax assessment, or grown-sale price crosses it. Confidence is capped at "medium" regardless of the AVM band. Cross-check the price on Zillow / Redfin / Homes.com before relying on cash-flow, DSCR, or the 5-yr projection.`,
    })
  }

  // HOA outlier check — when the captured listing HOA is materially above
  // the building average we track in buildingHoa.ts, flag it. HOA tiers
  // driven by sqft/view can explain a premium, but a $1,212 captured HOA
  // against a ~$1,036 building average (414 Water St Baltimore audit) is
  // worth surfacing so users verify against the listing sheet.
  if (
    input.hoaSource === 'listing' &&
    typeof input.buildingHoaAvg === 'number' &&
    input.buildingHoaAvg > 0 &&
    input.monthlyHOA > input.buildingHoaAvg * 1.15
  ) {
    const pctOver = Math.round(((input.monthlyHOA - input.buildingHoaAvg) / input.buildingHoaAvg) * 100)
    warnings.push({
      code: 'hoa-above-building-avg',
      message: `Captured HOA ($${Math.round(input.monthlyHOA).toLocaleString()}/mo) is ${pctOver}% above the building average we track ($${Math.round(input.buildingHoaAvg).toLocaleString()}/mo). Could be a legitimate sqft/view tier — or a listing-sheet error. Verify against the current listing before using this number in cash-flow or DSCR math.`,
    })
  }

  // Rent-comp wide spread — a 4× spread between min and max rent comp (the
  // Old Westbury audit hit $4,800–$19,500 on the same comp set) means the
  // rent AVM can't be trusted. Rent comps have no sqft / bathroom proximity
  // filter so a 7BR 7,800-sqft listing can land in a 3BR comp set.
  if (input.rentCompRents && input.rentCompRents.length >= 3) {
    const rents = input.rentCompRents.filter((r) => Number.isFinite(r) && r > 0)
    if (rents.length >= 3) {
      const min = Math.min(...rents)
      const max = Math.max(...rents)
      if (min > 0 && max / min > 3) {
        warnings.push({
          code: 'rent-comps-wide-spread',
          message: `Rent comps span $${Math.round(min).toLocaleString()}–$${Math.round(max).toLocaleString()}/mo (${(max / min).toFixed(1)}× spread). Rent comps are matched by bedroom count only — properties of very different size or configuration may be mixed in. The rent AVM is unreliable when the comp spread is this wide; verify against the listing history.`,
        })
      }
    }
  }

  // NYC co-op advisory — if our heuristic flags the property as a likely
  // co-op, surface the key structural differences vs a condo so the buyer
  // doesn't underwrite this as a standard condo purchase. (Batch pressure
  // test item #8.)
  if (input.likelyNYCCoop) {
    warnings.push({
      code: 'nyc-likely-coop',
      message: `This NYC address is likely a co-op rather than a condo (based on borough + building type + assessment pattern). Co-ops have maintenance fees (not HOA), require board approval for any sale or sublease, often cap subletting at 1–2 years every 3–5 years, and are often financed with proprietary/share loans rather than a standard mortgage. None of the numbers below model co-op-specific constraints — verify the building's bylaws and sublet policy before underwriting.`,
    })
  }

  // Rent AVM materially below comp median — luxury markets routinely
  // produce this pattern (Chicago Kingsbury: $2,910 AVM vs $5,990 comp
  // median, 106% gap; LA Hollywood: $2,540 vs $8,250, 225% gap). The
  // financial model uses the AVM so the deal looks worse than it likely
  // is. Flag so the user can opt into the comp-based scenario.
  if (
    typeof input.rentAvmMonthly === 'number' && input.rentAvmMonthly > 0 &&
    typeof input.rentCompMedianMonthly === 'number' && input.rentCompMedianMonthly > 0 &&
    input.rentCompRents && input.rentCompRents.length >= 3
  ) {
    const avm = input.rentAvmMonthly
    const median = input.rentCompMedianMonthly
    const gap = (median - avm) / avm
    if (gap >= 0.5) {
      warnings.push({
        code: 'rent-avm-below-comps',
        message: `Rent AVM ($${Math.round(avm).toLocaleString()}/mo) is ${Math.round(gap * 100)}% BELOW the comp median ($${Math.round(median).toLocaleString()}/mo) across ${input.rentCompRents.length} comps. The financial model below uses the AVM — luxury markets systematically under-shoot here. An alternate scenario at the comp-median rent would lift monthly cash flow by roughly $${Math.round(median - avm).toLocaleString()}/mo before opex. Verify against current same-building listings before trusting the DEAL verdict either way.`,
      })
    }
  }

  // Reality-check bounds on raw inputs. Cheap, deterministic, catches
  // data-vendor errors the reviewer can't (reviewer is narrative-vs-data,
  // doesn't re-compute math or sanity-check magnitudes).
  if (
    input.yearBuilt != null &&
    Number.isFinite(input.yearBuilt) &&
    (input.yearBuilt < 1800 || input.yearBuilt > new Date().getFullYear() + 2)
  ) {
    warnings.push({
      code: 'year-built-implausible',
      message: `Year built (${input.yearBuilt}) is outside the plausible range (1800–present). Data source returned a malformed value — could be a renovation date misfiled as original construction, or a parcel-record error. Age drives maintenance, insurance, and depreciation assumptions; verify against the listing.`,
    })
  }

  if (
    input.askPrice &&
    input.squareFeet &&
    Number.isFinite(input.squareFeet) &&
    input.squareFeet > 100
  ) {
    const ppsf = input.askPrice / input.squareFeet
    if (ppsf < 20 || ppsf > 5000) {
      warnings.push({
        code: 'price-per-sqft-implausible',
        message: `Price per square foot works out to $${Math.round(ppsf).toLocaleString()}/sqft — outside the plausible US-residential range of $20–$5,000/sqft. Either the price ($${input.askPrice.toLocaleString()}) or the square footage (${input.squareFeet.toLocaleString()}) is a data error. Verify both against the listing before trusting any comp-driven math.`,
      })
    }
  }

  return warnings
}

export function deriveValueConfidence(input: {
  signalPoints: number[]
  estimatedValue: number
  propertyType?: string | null
  subjectHasBuildingKey?: boolean
  sameBuildingCompCount?: number
  sameBuildingUnitCompCount?: number
}): { spread: number; confidence: 'high' | 'medium' | 'low' } {
  const signalPoints = input.signalPoints.filter((value) => Number.isFinite(value) && value > 0)
  const spread =
    signalPoints.length > 1 && input.estimatedValue > 0
      ? (Math.max(...signalPoints) - Math.min(...signalPoints)) / input.estimatedValue
      : 0

  const rawConfidence: 'high' | 'medium' | 'low' =
    spread < 0.1 ? 'high' : spread < 0.25 ? 'medium' : 'low'

  let confidence: 'high' | 'medium' | 'low' =
    signalPoints.length < 2 ? 'low' : rawConfidence

  const condoLikeSubject =
    isCondoLikePropertyType(input.propertyType) ||
    (input.sameBuildingUnitCompCount ?? 0) >= 2

  if (condoLikeSubject && input.subjectHasBuildingKey) {
    const sameBuildingCompCount = input.sameBuildingCompCount ?? 0
    if (sameBuildingCompCount <= 1) {
      confidence = 'low'
    } else if (sameBuildingCompCount === 2 && confidence === 'high') {
      confidence = 'medium'
    }
  }

  return { spread, confidence }
}

/**
 * Collapse near-duplicate comps — same street name, same bed/bath/sqft
 * footprint, and prices within $5k of each other — to one representative.
 * Three units at 201/203/207 Heights Ln at $240/$241/$242k anchored the
 * Blacksburg audit's comp median to one complex. This keeps that cluster as
 * one data point for the median while preserving the underlying records for
 * display (they're NOT removed from the returned report).
 *
 * Pure + exported so it's unit-testable.
 */
export function dedupeNearDuplicateComps(comps: Array<any>): Array<any> {
  if (!Array.isArray(comps) || comps.length < 2) return comps ?? []

  // Extract the non-numeric street "name" from an address — drop the leading
  // house number and any trailing unit marker. "201 Heights Ln" → "heights ln".
  const streetName = (addr: string): string =>
    String(addr || '')
      .toLowerCase()
      .replace(/^\s*\d+\s*/, '')
      .replace(/[,#].*$/, '')
      .replace(/\s+(apt|unit|ste)\s*\S+$/, '')
      .trim()

  // Two comps are considered duplicates of the same building when they share
  // street name + bed count + bath count + ~sqft (bucketed to 100). The first
  // version of this helper also bucketed PRICE to $5k, which failed for the
  // Heights Ln cluster ($232k/$235k/$240k/$242k — straddled two $5k buckets
  // and survived dedup). Price variation within a single complex is expected
  // (different floors / renovations / views) — presence on the same street
  // with identical bed/bath/sqft is already enough signal that these are
  // units of the same building.
  const keptByCluster = new Map<string, any>()
  for (const c of comps) {
    const key = [
      streetName(c.address),
      Number(c.bedrooms) || 0,
      Number(c.bathrooms) || 0,
      // Sqft bucketed to the nearest 100 so 1740/1744/1750 all match.
      Math.round((Number(c.square_feet) || 0) / 100),
    ].join('|')
    // First one wins — stable order preserves the original comp ranking.
    if (!keptByCluster.has(key)) keptByCluster.set(key, c)
  }
  return Array.from(keptByCluster.values())
}

/**
 * NYC co-op heuristic. Co-ops differ from condos: monthly "maintenance"
 * fees (not HOA), board approval for subletting, and different tax treatment.
 * Rentcast lumps both under "Apartment" / "Condo" property types. Without
 * a reliable data source, we use a combination of signals: NY state +
 * urban NYC borough + building-level tax assessment (>10× AVM) OR pre-1970
 * high-rise in Manhattan / Brooklyn / Bronx / Queens — both strongly
 * associated with co-op structure. Returns a non-blocking hint that the
 * narrative and UI can surface.
 */
export function isLikelyNYCCoop(input: {
  state: string | undefined | null
  city: string | undefined | null
  propertyType: string | undefined | null
  yearBuilt: number | undefined | null
  taxAssessmentRatio?: number
}): boolean {
  const state = (input.state || '').toUpperCase()
  if (state !== 'NY') return false
  const city = (input.city || '').toLowerCase()
  const nycBoroughs = ['new york', 'manhattan', 'brooklyn', 'queens', 'bronx', 'staten island']
  if (!nycBoroughs.some((b) => city.includes(b))) return false
  const pt = (input.propertyType || '').toLowerCase()
  if (!/apartment|condo|co-?op/.test(pt)) return false
  // Strong signal: assessment is clearly building-level.
  if (typeof input.taxAssessmentRatio === 'number' && input.taxAssessmentRatio > 10) return true
  // Weaker signal: pre-1970 apartment in a co-op-heavy borough.
  if ((input.yearBuilt ?? 2000) < 1970 && /apartment/.test(pt)) return true
  return false
}

/**
 * State + property-type aware tax-assessment multiplier. The default 1.15×
 * assumes fractional assessment (most states assess at 80–90% of market).
 * A few jurisdictions assess at 100% of market value — multiplying by 1.15
 * there systematically overshoots. Pressure test (Philly 1414 S Penn Sq)
 * flagged 73% overshoot on a $1.79M AVM because PA uses CAMA at market.
 * Exported for unit-testability.
 */
export function getTaxAssessmentMultiplier(state: string, propertyType?: string | null): number {
  const s = (state || '').toUpperCase()
  const ptLower = (propertyType || '').toLowerCase()
  // Full-market-value assessors — multiplier 1.0.
  if (s === 'FL') return 1.0
  // NY condos + co-ops (Class 2): the finance dept already publishes a
  // market-value assessment; the 1.15 lift double-counts.
  if (s === 'NY' && /condo|apartment|co-?op|coop/.test(ptLower)) return 1.0
  // PA re-assessed to 100% market value in the Philly CAMA overhaul.
  if (s === 'PA') return 1.0
  // DC Class 1 residential is assessed at 100% market value.
  if (s === 'DC') return 1.0
  // Default: fractional assessment with ~15% undershoot.
  return 1.15
}

/**
 * Evidence-based property-type inference. Rentcast inconsistently labels
 * individual condo units inside high-rise buildings as "Single Family" when
 * the building's units are deeded separately (Chicago 1720 S Michigan Ave
 * #1501 audit: reported as SFR despite rent comps referencing Apt 2307 /
 * Apt 2104 in the same tower). Returns true when either (a) the subject's
 * own address carries a unit/apt/# token, or (b) at least two comps share
 * the subject's street address with different unit numbers.
 */
export function isCondoEvidenceStrong(
  subjectAddress: string,
  saleComps: Array<{ address?: string }> | undefined,
  rentComps: Array<{ address?: string }> | undefined
): { isCondo: boolean; reason: string } {
  const hasUnitToken = (addr: string): boolean =>
    /#\s*\d|\b(apt|unit|ste|suite)\s*\d/i.test(String(addr || ''))
  const primaryStreet = (addr: string): string =>
    String(addr || '')
      .toLowerCase()
      .replace(/\s+(apt|unit|ste|suite|#)\s*\S+$/i, '')
      .replace(/#.*$/, '')
      .replace(/,.*$/, '')
      .replace(/\s+/g, ' ')
      .trim()

  if (hasUnitToken(subjectAddress)) {
    return { isCondo: true, reason: 'subject address contains apt/unit/# token' }
  }
  const subjPrimary = primaryStreet(subjectAddress)
  if (!subjPrimary) return { isCondo: false, reason: 'subject address unparseable' }

  const hits = [...(saleComps ?? []), ...(rentComps ?? [])].filter((c) => {
    if (!c?.address) return false
    return primaryStreet(String(c.address)) === subjPrimary && hasUnitToken(String(c.address))
  })
  if (hits.length >= 2) {
    return {
      isCondo: true,
      reason: `${hits.length} comps reference the same street address with unit numbers`,
    }
  }
  return { isCondo: false, reason: `only ${hits.length} same-building comps` }
}

/**
 * Select the comp set used for the ARV / triangulation median. When ANY
 * comp in the returned set shares the subject's building, return only the
 * same-building subset — same-building peers are a far stronger anchor for
 * condo units than 1-mile neighborhood matches and mixing the two produces
 * spurious triangulation divergence (414 Water St audit: 2 cross-neighborhood
 * comps at $323k median vs same-building median ~$216k). This helper is the
 * single source of truth so `comparableSales` surfaced in the report matches
 * the basis of the triangulation median — otherwise the report can claim
 * "Median of 1 comp" while rendering 2 comps.
 */
export function selectCompsForArv(
  dedupedSaleComps: Array<any>,
  subject?: {
    zip_code?: string | null
    property_type?: string | null
    square_feet?: number | null
  } | null
): Array<any> {
  if (!Array.isArray(dedupedSaleComps) || dedupedSaleComps.length === 0) return []

  // Size-outlier guard — drop comps whose sqft deviates >25% from subject.
  // 414 Water St audit: the sole sale comp was 1,454 sqft against a 1,067
  // sqft subject (36% larger) — a different product type (bedroom count,
  // layout, price/sqft band), not a valid comp regardless of ZIP match.
  const SIZE_TOLERANCE = 0.25
  const subjSqft = Number(subject?.square_feet)
  const withinSize = (c: any) => {
    if (!Number.isFinite(subjSqft) || subjSqft <= 0) return true
    const compSqft = Number(c?.square_feet)
    if (!Number.isFinite(compSqft) || compSqft <= 0) return true
    return Math.abs(compSqft - subjSqft) / subjSqft <= SIZE_TOLERANCE
  }
  const sized = dedupedSaleComps.filter(withinSize)

  // Same-building branch: require ≥3 same-building closings before gating
  // out the ZIP supplement. 414 Water St audit: selector used to exit at
  // length >= 1, so a single same-building outlier anchored the ARV with
  // no neighborhood context. ≥3 is the minimum median sample that isn't
  // just the one closing in either direction.
  const sameBuilding = sized.filter((c: any) => c?.same_building)
  if (sameBuilding.length >= 3) return sameBuilding

  // ZIP + subtype gate — drop cross-submarket comps before falling back to the
  // unfiltered list. 414 Water St audit: sole comp was a townhouse in a
  // different ZIP / neighborhood (Ridgely's Delight 21230 vs Inner Harbor
  // 21202), 36% larger footprint, anchoring the ARV to the wrong submarket.
  if (subject && (subject.zip_code || subject.property_type)) {
    const subjZip = String(subject.zip_code || '').trim()
    const subjSubtype = classifyCondoSubtype(subject.property_type)
    const filtered = sized.filter((c: any) => {
      if (subjZip) {
        const compZip = String(c?.zip_code || '').trim()
        if (compZip && compZip !== subjZip) return false
      }
      if (subjSubtype) {
        const compSubtype = classifyCondoSubtype(c?.property_type)
        if (compSubtype && compSubtype !== subjSubtype) return false
      }
      return true
    })
    return filtered
  }

  return sized
}

function classifyCondoSubtype(pt: string | null | undefined): string | null {
  if (!pt) return null
  const s = String(pt).toLowerCase()
  if (/townhouse|townhome|town\s*home|row\s*house/.test(s)) return 'townhouse'
  if (/condo|apartment|high.?rise|co[- ]?op/.test(s)) return 'condo'
  if (/single.?family|detached/.test(s)) return 'sfr'
  if (/duplex|triplex|multi/.test(s)) return 'multi'
  return null
}

/**
 * Canonical breakeven resolver. Picks the single number every downstream
 * consumer (summaryCard, recommendedOffers, AI narration) must use. Prefers
 * the teaser's locked-in breakeven when present, otherwise falls back to
 * the full-report recommendedOffers solver. Pre-fix, the AI read a different
 * solver result than the summaryCard, yielding narratives like "renegotiate
 * to $148,000" stacked on top of a $138k card — a $10k internal mismatch.
 */
export function resolveCanonicalBreakeven(
  teaserData: unknown,
  recommendedOffersBreakeven: number
): number {
  const parsed =
    typeof teaserData === 'string'
      ? (() => { try { return JSON.parse(teaserData) } catch { return null } })()
      : (teaserData as any) ?? null
  const teaserBe = Number(parsed?.breakevenPrice)
  if (Number.isFinite(teaserBe) && teaserBe > 0) return teaserBe
  return recommendedOffersBreakeven
}

export function applyStoredListingPriceResolution(
  property: PropertyData,
  teaserData: unknown
): PropertyData {
  const storedListingPriceResolution = parseListingPriceResolution(teaserData)
  if (!hasResolvedListingPrice(storedListingPriceResolution)) {
    return property
  }

  return {
    ...property,
    primary_listing_price:
      storedListingPriceResolution.primaryListingPrice ?? property.primary_listing_price,
    fallback_listing_price:
      storedListingPriceResolution.fallbackListingPrice ?? property.fallback_listing_price,
    listing_price: storedListingPriceResolution.listingPrice,
    listing_price_source: storedListingPriceResolution.listingPriceSource,
    listing_price_status: storedListingPriceResolution.listingPriceStatus,
    listing_price_checked_at: storedListingPriceResolution.listingPriceCheckedAt,
    listing_price_user_supplied: storedListingPriceResolution.listingPriceUserSupplied,
  }
}

/**
 * Flag rent-comp sets that are entirely in the subject building. Returns a
 * user-facing warning string when >= 3 comps share the subject's building
 * key and ALL parseable comp keys match. Single-building + active-asking
 * rents (days_old ≤ 7) bias the rent anchor — per 414 Water St #1501
 * audit where four same-building 1-day-old comps passed as the rent
 * anchor. Pure / easy to regression-test.
 */
export function buildSameBuildingRentCompWarning(
  subjectAddress: string,
  rentComps: Array<any>
): string | null {
  if (!Array.isArray(rentComps) || rentComps.length < 3) return null
  const subjectKey = buildingKey(subjectAddress)
  if (!subjectKey) return null
  const compBuildingKeys = rentComps
    .map((c: any) => buildingKey(c?.address || ''))
    .filter((k): k is string => Boolean(k))
  if (compBuildingKeys.length < 3) return null
  const sameBuilding = compBuildingKeys.filter((k) => k === subjectKey).length
  const allSameBuilding = sameBuilding === compBuildingKeys.length
  if (!allSameBuilding) return null
  const allFresh = rentComps.every(
    (c: any) => c?.days_old != null && Number(c.days_old) <= 7
  )
  return `All ${rentComps.length} rent comps are in the subject building${
    allFresh ? ' and all are active listings under 7 days old' : ''
  } — single-building + asking-vs-effective-rent bias. ${
    allFresh
      ? 'Applied a 3–5% concession haircut to the effective-rent anchor to correct for this bias.'
      : 'Apply a 3–5% concession haircut before trusting as the effective-rent anchor.'
  }`
}

/**
 * Returns a multiplicative haircut factor to apply to the rent AVM when all
 * rent comps share the subject building AND are fresh active listings
 * (days_old <= 7). Active asking rents systematically overstate effective
 * rent by 3–5% due to concessions; applying the haircut keeps breakeven,
 * DSCR, and the 5yr projection consistent with the warning copy. Returns
 * 1.0 (no haircut) when the concentration signal is absent.
 */
export function computeConcessionHaircutFactor(
  subjectAddress: string,
  rentComps: Array<any>
): number {
  if (!Array.isArray(rentComps) || rentComps.length < 3) return 1.0
  const subjectKey = buildingKey(subjectAddress)
  if (!subjectKey) return 1.0
  const compBuildingKeys = rentComps
    .map((c: any) => buildingKey(c?.address || ''))
    .filter((k): k is string => Boolean(k))
  if (compBuildingKeys.length < 3) return 1.0
  const allSameBuilding =
    compBuildingKeys.length === rentComps.length &&
    compBuildingKeys.every((k) => k === subjectKey)
  if (!allSameBuilding) return 1.0
  const allFresh = rentComps.every(
    (c: any) => c?.days_old != null && Number(c.days_old) <= 7
  )
  if (!allFresh) return 1.0
  return 0.96
}

/**
 * True when the STR projection card should be rendered at all. Excludes
 * jurisdictions where non-owner-occupied whole-unit STR is broadly
 * prohibited (Baltimore §5A, NYC Local Law 18) — rendering a $0-revenue
 * STR card reads as "STR is a $21k/yr loss" rather than "STR is legally
 * off the table for an investor".
 */
export function shouldIncludeStrProjection(input: {
  state?: string | null
  city?: string | null
  ownerOccupied?: boolean | null
}): boolean {
  if (input?.ownerOccupied) return true
  return !isStrProhibitedForInvestor(input?.state || '', input?.city || '')
}

/**
 * Build the valueTriangulation output object surfaced on the report. When
 * confidence is 'low' AND the spread between signal point-estimates exceeds
 * 30% of the subject value, the single-point AVM is suppressed from the
 * headline and a value range is exposed instead — a 66% spread with only
 * one reliable signal is not a trustworthy point estimate, and anchoring
 * the deal math on it steers the user toward offers that match a bogus ask.
 * Baltimore 414 Water St #1501 audit: AVM $216K == asking $216K with a
 * contaminated cross-neighborhood comp median $380K produced a 66% spread
 * that the report still showed as a single headline number.
 */
export function buildValueTriangulationOutput(input: {
  signals: Array<{ label: string; value: number; source: string }>
  signalPoints: number[]
  primaryValue: number
  valueSource: string | null | undefined
  valueRangeLow?: number | null
  valueRangeHigh?: number | null
  spread: number
  confidence: 'high' | 'medium' | 'low'
  askPrice?: number
  sameBuildingMedian?: number | null
}) {
  const {
    signals, signalPoints, primaryValue, valueSource,
    valueRangeLow, valueRangeHigh, spread, confidence, askPrice,
    sameBuildingMedian,
  } = input
  const spreadPct = Math.round(spread * 1000) / 10
  // AVM-matches-ask flag: when the "AVM" is literally the listing price,
  // triangulation is anchored to the ask and spread reflects noise against
  // one external data point. Call this out explicitly.
  const avmEqualsAsk =
    typeof askPrice === 'number' &&
    askPrice > 0 &&
    Math.abs(primaryValue - askPrice) / askPrice < 0.005
  // Headline suppression:
  //   - low confidence + >30% spread: classic case — AVM isn't a reliable
  //     single-point anchor.
  //   - AVM=ask + >25% spread: stronger signal regardless of confidence —
  //     the point estimate is definitionally anchored to the listing price,
  //     not to independent market data. 414 Water St #1501 audit: AVM
  //     $216k literally equaled ask $216k with a 66% spread, yet headline
  //     wasn't suppressed because confidence flipped to 'medium'.
  const headlineSuppressed =
    (confidence === 'low' && spread > 0.3) ||
    (avmEqualsAsk && spread > 0.25)
  let displayRange: { low: number; high: number } | null = null
  if (headlineSuppressed && signalPoints.length > 0) {
    displayRange = {
      low: Math.round(Math.min(...signalPoints)),
      high: Math.round(Math.max(...signalPoints)),
    }
  }
  // Fallback anchor — when the headline is suppressed, surface the same-
  // building median (if available) as the replacement anchor downstream
  // consumers should render instead of echoing the ask. 414 Water St
  // audit: report showed no replacement value when AVM was suppressed.
  let fallbackValue: number | null = null
  let fallbackSource: string | null = null
  if (
    headlineSuppressed &&
    typeof sameBuildingMedian === 'number' &&
    Number.isFinite(sameBuildingMedian) &&
    sameBuildingMedian > 0
  ) {
    fallbackValue = Math.round(sameBuildingMedian)
    fallbackSource = 'same-building median'
  }
  return {
    signals,
    primaryValue,
    valueSource,
    valueRangeLow,
    valueRangeHigh,
    spreadPct,
    confidence,
    headlineSuppressed,
    displayRange,
    avmEqualsAsk,
    fallbackValue,
    fallbackSource,
  }
}

// ─── resolvePropertyTax ───────────────────────────────────────────────────────

export interface ResolvePropertyTaxResult {
  monthlyPropertyTax: number
  propertyTaxSource: 'county-record' | 'city-override' | 'state-average'
  taxIsBuildingLevel: boolean
  /** State-average monthly figure used for building-level detection and exemption warnings */
  stateAverageTax: number
  /** County-record monthly figure (0 if Rentcast returned no data or negative) */
  countyRecordTax: number
}

/**
 * Pure helper that chooses the best property-tax estimate for a single unit.
 *
 * Source priority:
 *   1. county-record  — Rentcast annualPropertyTax (positive and not building-level)
 *   2. city-override  — statePropertyTaxRate already contains the CITY_RULES override;
 *                       hasCityTaxOverride signals which badge label to show
 *   3. state-average  — pure STATE_RULES fallback
 *
 * Building-level rejection: if the county-record monthly figure exceeds 3× the
 * state-average estimate OR the annual amount exceeds 60% of the offer price,
 * it almost certainly represents the entire building (e.g., NYC co-ops). Fall
 * back to state-average (or city-override if available).
 */
export function resolvePropertyTax(input: {
  annualPropertyTax: number | undefined
  offerPrice: number
  statePropertyTaxRate: number
  hasCityTaxOverride: boolean
  city: string
  state: string
}): ResolvePropertyTaxResult {
  const { annualPropertyTax, offerPrice, statePropertyTaxRate, hasCityTaxOverride, city, state } =
    input

  const stateAverageTax = Math.round((offerPrice * statePropertyTaxRate) / 12)
  const countyRecordTax =
    annualPropertyTax != null && annualPropertyTax > 0
      ? Math.round(annualPropertyTax / 12)
      : 0

  const taxIsBuildingLevel =
    countyRecordTax > 0 &&
    (countyRecordTax > stateAverageTax * 3 ||
      (annualPropertyTax ?? 0) > Math.max(offerPrice, 1) * 0.6)

  if (countyRecordTax > 0 && !taxIsBuildingLevel) {
    return {
      monthlyPropertyTax: countyRecordTax,
      propertyTaxSource: 'county-record',
      taxIsBuildingLevel: false,
      stateAverageTax,
      countyRecordTax,
    }
  }

  if (taxIsBuildingLevel) {
    logger.warn('property_tax.building_level_rejected', {
      city,
      state,
      countyRecordMonthly: countyRecordTax,
      stateAverageMonthly: stateAverageTax,
      ratio: +(countyRecordTax / Math.max(stateAverageTax, 1)).toFixed(1),
      annualTaxToOfferPricePct: +(((annualPropertyTax ?? 0) / Math.max(offerPrice, 1)) * 100).toFixed(1),
      fallbackSource: hasCityTaxOverride ? 'city-override' : 'state-average',
    })
  } else {
    logger.warn('property_tax.rentcast_missing', {
      city,
      state,
      fallbackSource: hasCityTaxOverride ? 'city-override' : 'state-average',
      stateAverageMonthly: stateAverageTax,
      offerPrice,
    })
  }

  return {
    monthlyPropertyTax: stateAverageTax,
    propertyTaxSource: hasCityTaxOverride ? 'city-override' : 'state-average',
    taxIsBuildingLevel,
    stateAverageTax,
    countyRecordTax,
  }
}

/**
 * Pure composition — all the math, warnings, triangulation, and data assembly
 * that used to live inside generateFullReport. Takes already-fetched external
 * data and produces the fullReportData object that gets persisted + rendered.
 *
 * The Claude call is the one async operation still inside; it's injected so
 * scenario tests can use a stub. The function never touches Prisma — fixture-
 * testable end-to-end without a test DB.
 */
export async function composeFullReport(
  report: Report,
  results: ReportFetchResults,
  aiGenerator: AiGenerator = generateDealDoctor
): Promise<Record<string, any>> {
  const { property, rates } = results
  const rentEstimate =
    results.rentEstimate.status === 'fulfilled' ? results.rentEstimate.value : null
  const saleComps =
    results.saleComps.status === 'fulfilled' ? results.saleComps.value : []
  const rentComps =
    results.rentComps.status === 'fulfilled' ? results.rentComps.value : []

  // Evidence-based property-type reclassification. Rentcast mislabels many
  // high-rise condo units as "Single Family" — cascades into zero HOA,
  // wrong inspection red flags ("row home / SFR roof" for a 30th-floor
  // condo), and understated carrying costs. When the subject address has
  // a unit token OR comps reference the same building with unit numbers,
  // force the classification to Condo so the HOA fallback + condo-specific
  // inspection rules downstream actually fire. (Chicago 1720 S Michigan
  // #1501 audit.)
  if (!/condo|apartment|co-?op/i.test(property.property_type || '')) {
    const ev = isCondoEvidenceStrong(report.address, saleComps, rentComps)
    if (ev.isCondo) {
      console.log(
        `[reportGenerator] reclassifying property_type "${property.property_type}" → "Condo" (${ev.reason})`
      )
      property.property_type = 'Condo'
    }
  }

  // Sqft sanity for condo/apartment units. Rentcast occasionally returns
  // the *building's* gross sqft on an individual unit record — 3200 N Lake
  // Shore Dr #2408 audit: 32,400 sqft on a 3BR Lakeview unit. That figure
  // cascades into $/sqft maintenance (~$1,296/mo vs $150 typical), sqft-
  // bucketed comp dedupe clusters, value-triangulation confidence, AI
  // narrative ("this 32,400 sqft unit..."), and PDF display. Cap condo
  // units at 5,000 sqft; replace with bedroom-matched comp median, else
  // fall back to a bedroom heuristic (~650 sqft/BR, min 500).
  let sqftCorrection: { original: number; replaced: number; source: 'comp-median' | 'bedroom-heuristic' } | null = null
  const CONDO_SQFT_CEILING = 5000
  const isCondoish = /condo|apartment|co-?op/i.test(property.property_type || '')
  if (isCondoish && typeof property.square_feet === 'number' && property.square_feet > CONDO_SQFT_CEILING) {
    const compSqfts = saleComps
      .map((c: any) => Number(c?.square_feet))
      .filter((n: number) => Number.isFinite(n) && n > 200 && n < CONDO_SQFT_CEILING)
      .sort((a: number, b: number) => a - b)
    const compMedian = compSqfts.length > 0 ? compSqfts[Math.floor(compSqfts.length / 2)] : null
    const bedroomFallback = Math.max(500, (property.bedrooms || 1) * 650)
    const replaced = compMedian ?? bedroomFallback
    sqftCorrection = {
      original: property.square_feet,
      replaced,
      source: compMedian ? 'comp-median' : 'bedroom-heuristic',
    }
    console.warn(
      `[reportGenerator] sqft sanity: ${property.property_type} sqft ${property.square_feet} > ${CONDO_SQFT_CEILING} — replaced with ${replaced} (${sqftCorrection.source})`
    )
    property.square_feet = replaced
  }
  const marketSnapshot =
    results.marketSnapshot.status === 'fulfilled' ? results.marketSnapshot.value : null
  const climate =
    results.climate.status === 'fulfilled' && results.climate.value
      ? results.climate.value
      : null
  const locationSignals =
    results.locationSignals.status === 'fulfilled' ? results.locationSignals.value : null

  const askPrice =
    typeof property.listing_price === 'number' && property.listing_price > 0
      ? property.listing_price
      : resolveListingPrice(property)
  const hasListingPrice =
    typeof property.listing_price === 'number' && property.listing_price > 0
  const offerPrice = report.offerPrice ?? askPrice
  const downPaymentPct = report.downPaymentPct ?? 0.2
  const rehabBudget = report.rehabBudget ?? 0

  // Apply investor-rate premium based on strategy. PMMS is owner-occupied;
  // real DSCR / non-owner-occupied pricing runs higher. See rates.ts for rationale.
  const strategy = (report.strategy as Strategy) ?? 'LTR'
  const investorRate = applyInvestorPremium(rates.mortgage30yr, strategy)
  const rawRentAvm = rentEstimate?.estimated_rent || property.estimated_value * 0.005

  // Student-housing heuristic: when the AVM is clearly a per-bedroom rate
  // (subdivision match or implausibly low yield), multiply by bedroom count
  // to get whole-property rent. ALL downstream math (cash flow, DSCR, 5yr
  // wealth, IRR, breakeven, sensitivity) then uses the corrected figure.
  let rentAdjustment = applyStudentHousingHeuristic({
    rentAvm: rawRentAvm,
    propertyValue: offerPrice,
    bedrooms: property.bedrooms,
    subdivision: property.subdivision,
    zipCode: report.zipCode ?? property.zip_code,
  })

  // Cross-check the multiplied rent against actual rent comps. Shared helper
  // — called from both this full-report path AND the teaser preview route,
  // so paid/preview numbers can't drift (Blacksburg teaser/report mismatch).
  const crossCheck = crossCheckRentAgainstComps({
    adjustment: rentAdjustment,
    rawRentAvm,
    rentCompRents: (rentComps || [])
      .map((c: any) => Number(c?.rent))
      .filter((v: number) => Number.isFinite(v) && v > 0),
  })
  rentAdjustment = crossCheck.adjustment
  const rentMultiplierRevertedDueToComps = crossCheck.revertedDueToComps

  // Concession haircut — when every rent comp is a same-building active
  // asking rent (days_old ≤ 7), subtract 3-5% for typical landlord
  // concessions so breakeven/DSCR/wealth projection match the warning copy
  // that tells the user to do the same. 414 Water St #1501 audit: all 4
  // comps were 1-day-old asking rents in the subject building.
  const concessionHaircutFactor = computeConcessionHaircutFactor(
    report.address,
    rentComps || []
  )
  const monthlyRent = Math.round(
    rentAdjustment.effectiveRent * concessionHaircutFactor
  )
  const stateRulesMissing = !STATE_RULES[report.state]
  const stateRules = getJurisdictionRules(report.state, report.city)

  // If climate is entirely unavailable (rare — it has its own null-safe paths),
  // fall back to $1,800/yr national-average homeowners insurance. Report still
  // generates; the climate section just won't render.
  // Property tax: prefer actual county record from Rentcast, fall back to
  // the jurisdictional rate × price. When we have a CITY_RULES override
  // (e.g. Houston's 2.03% Harris County effective rate vs TX's 1.80%
  // state-wide), the fallback is a city-specific estimate, not a state
  // average — surface that in the badge so users don't see "state avg"
  // when the rate is actually a county effective figure.
  const cityTaxKey = `${report.city.trim().toUpperCase()}, ${report.state.trim().toUpperCase()}`
  const hasCityTaxOverride = typeof CITY_RULES[cityTaxKey]?.propertyTaxRate === 'number'
  const { monthlyPropertyTax, propertyTaxSource, taxIsBuildingLevel, stateAverageTax, countyRecordTax } = resolvePropertyTax({
    annualPropertyTax: property.annual_property_tax,
    offerPrice,
    statePropertyTaxRate: stateRules.propertyTaxRate,
    hasCityTaxOverride,
    city: report.city.trim().toUpperCase(),
    state: report.state.trim().toUpperCase(),
  })

  // Exemption detection: when the county-record tax is materially below the
  // state-average estimate (< 50%), the prior owner likely carries a homestead,
  // senior-freeze, veteran, or similar exemption that doesn't transfer on sale.
  // Investor buyers see their bill reset to the non-exempt rate — a classic
  // first-year gotcha (Chicago audit: Harbor House unit showed $247/mo vs
  // $500/mo state-average and $350-450/mo building actual). We keep the
  // county-record number to avoid overstating, but surface a warning so the
  // user verifies with the assessor before relying on the carrying cost.
  const taxLikelyExempted =
    propertyTaxSource === 'county-record' &&
    stateAverageTax > 0 &&
    countyRecordTax < stateAverageTax * 0.5

  // HOA capture: prefer the Rentcast-reported value. If the feed has no HOA
  // for a condo/apartment (Rentcast often doesn't carry HOA for urban condo
  // buildings — e.g. The Jefferson House in DC), fall back to a conservative
  // sqft-based estimate so breakeven/DSCR don't assume a free-ride condo
  // that actually carries $500+/mo in dues. ~$1/sqft/mo tracks typical
  // amenity-rich urban condo dues (floor $300 for studios, cap $1,500 for
  // very large units). hoaSource flips to 'inferred-condo-default' so the
  // report still flags that the number is estimated and should be verified.
  const capturedHOA = property.hoa_fee_monthly ?? 0
  const propertyTypeLower = (property.property_type || '').toLowerCase()
  const isCondoLike = /condo|apartment|co-?op|coop/.test(propertyTypeLower)
  // Building-level HOA override: for condos/apartments we have direct records
  // for, skip the sqft-based estimate. Jefferson House (922 24th St NW, DC)
  // averages ~$717/mo — the sqft formula gave $499 and inverted the deal.
  const buildingHoaRecord = isCondoLike ? lookupBuildingHoa(report.address) : null
  // Outlier override: when we have a building-db record AND the listing HOA
  // is materially above the building average (>15%), prefer the building
  // average. Listing sheets occasionally carry a unit's full assessment line
  // (base dues + special assessment + parking) as the HOA, inflating it well
  // above what a typical unit in the building actually pays — that inflated
  // figure then consumes half the rent estimate and cratered cash flow. A
  // typical-tier building average is a safer anchor than a single noisy
  // listing print. (414 Water St Baltimore audit: captured $1,212 vs
  // building avg $1,036 → 17% over, deal misread as cash-flow negative.)
  const listingHoaIsOutlier =
    capturedHOA > 0 &&
    !!buildingHoaRecord &&
    buildingHoaRecord.monthlyHoa > 0 &&
    capturedHOA > buildingHoaRecord.monthlyHoa * 1.15
  const buildingHoaRecordUsed =
    capturedHOA === 0 || listingHoaIsOutlier ? buildingHoaRecord : null
  // Tier-adjusted inference: full-service amenity-rich high-rise markets
  // carry materially higher HOA than the national ~$1/sqft/mo baseline.
  // NYC condos routinely clear $1.40–$2.00/sqft/mo for even modest units
  // (doorman, gym, concierge, elevator, garage all baked in). DC / Boston
  // / SF / Chicago Loop sit in between. Everywhere else: baseline.
  const inferredHoaTier = ((): { floor: number; cap: number; rate: number } => {
    const city = (report.city || '').toLowerCase()
    const state = (report.state || '').toUpperCase()
    if (state === 'NY' && /new york|brooklyn|queens|bronx|staten|manhattan/.test(city)) {
      return { floor: 900, cap: 2500, rate: 1.4 }
    }
    if (
      state === 'DC' ||
      (state === 'MA' && /boston|cambridge|brookline/.test(city)) ||
      (state === 'CA' && /san francisco/.test(city)) ||
      (state === 'IL' && /chicago/.test(city))
    ) {
      return { floor: 500, cap: 2000, rate: 1.2 }
    }
    return { floor: 300, cap: 1500, rate: 1.0 }
  })()
  const inferredCondoHOA =
    capturedHOA === 0 && isCondoLike && !buildingHoaRecord
      ? Math.min(
          inferredHoaTier.cap,
          Math.max(
            inferredHoaTier.floor,
            Math.round((property.square_feet || 500) * inferredHoaTier.rate)
          )
        )
      : 0
  const monthlyHOA = buildingHoaRecordUsed
    ? buildingHoaRecordUsed.monthlyHoa
    : capturedHOA > 0
      ? capturedHOA
      : inferredCondoHOA
  const hoaInferred = capturedHOA === 0 && !buildingHoaRecordUsed && inferredCondoHOA > 0
  const hoaFromBuildingDb = !!buildingHoaRecordUsed
  const insuranceEstimate = resolveMonthlyInsuranceEstimate({
    annualInsuranceEstimate: climate?.estimatedAnnualInsurance,
    floodInsuranceRequired: climate?.floodInsuranceRequired,
    monthlyHoa: monthlyHOA,
    propertyType: property.property_type,
  })
  const monthlyInsurance = insuranceEstimate.monthlyInsurance
  // Maintenance scales with square footage — a 5,693 sqft luxury estate
  // costs more to maintain than a 1,100 sqft starter home. $150 flat was
  // absurd on anything above ~3,000 sqft. Using $0.04/sqft/mo (~$480/yr per
  // 1,000 sqft) as a conservative rule of thumb, floored at $150 so small
  // homes don't drop below the reserves baseline.
  const monthlyMaintenance = Math.max(
    150,
    property.square_feet ? Math.round(property.square_feet * 0.04) : 150
  )
  const monthlyExpenses = monthlyPropertyTax + monthlyInsurance + monthlyMaintenance + monthlyHOA

  const ltrMetrics = calculateDealMetrics(
    {
      purchasePrice: offerPrice,
      downPaymentPct,
      annualRate: investorRate,
      amortizationYears: 30,
      state: report.state,
      rehabBudget,
    },
    { estimatedMonthlyRent: monthlyRent, vacancyRate: 0.05, monthlyExpenses },
    report.state
  )

  // ARV from sale comps median. Dedupe near-duplicate comps first: three
  // units in the same condo complex at $240/$241/$242k (Heights Ln case)
  // should count as 1 data point for the median, not 3 — otherwise one
  // complex's pricing artificially anchors the whole comp analysis.
  const dedupedSaleComps = dedupeNearDuplicateComps(saleComps)
  const subjectBuildingKeyForWarning = buildingKey(report.address)
  const sameBuildingCompCount = dedupedSaleComps.filter((c: any) => c?.same_building).length
  const sameBuildingUnitCompCount = dedupedSaleComps.filter(
    (c: any) => c?.same_building && isUnitLikeAddress(c?.address || '')
  ).length
  const sameBuildingValues = dedupedSaleComps
    .filter((c: any) => c?.same_building)
    .map((c: any) => Number(c.estimated_value))
    .filter((v: number) => Number.isFinite(v) && v > 0)
    .sort((a: number, b: number) => a - b)
  const sameBuildingMedian =
    sameBuildingValues.length > 0
      ? sameBuildingValues[Math.floor(sameBuildingValues.length / 2)]
      : null
  // Same-building preference: when ANY comp in the returned set shares the
  // subject's building, use only those for the median. Mixing same-building
  // and cross-neighborhood comps produces spurious triangulation divergence
  // (414 Water St / Spinnaker Bay audit: 2 wrong-submarket comps at $323k
  // median vs same-building median ~$216k, triggered a 49.5% "divergence
  // warning" against an AVM that actually agreed with the in-building
  // comps). Same-building peers are the stronger signal for condos.
  const compsForArv = selectCompsForArv(dedupedSaleComps, {
    zip_code: property.zip_code,
    property_type: property.property_type,
    square_feet: property.square_feet,
  })
  const compValues = compsForArv
    .map((c: any) => Number(c.estimated_value))
    .filter((v: number) => Number.isFinite(v) && v > 0)
    .sort((a: number, b: number) => a - b)
  const arvEstimate =
    compValues.length > 0 ? compValues[Math.floor(compValues.length / 2)] : undefined

  // Value triangulation — build a list of every independent signal we have
  // for the property's value. If they diverge by >25%, we flag low confidence.
  type ValueSignal = { label: string; value: number; source: string }
  const valueSignals: ValueSignal[] = []
  valueSignals.push({
    label: property.value_source === 'listing' ? 'Active listing price' : 'Rentcast AVM',
    value: property.estimated_value,
    source:
      property.value_source === 'listing'
        ? 'Current MLS listing'
        : property.value_source === 'avm'
        ? 'Rentcast automated value model'
        : property.value_source === 'tax-assessment'
        ? 'Tax assessment × 1.15'
        : property.value_source === 'last-sale-grown'
        ? 'Last sale grown at 3%/yr'
        : 'Unknown source',
  })
  if (arvEstimate) {
    valueSignals.push({
      label: 'Sale comps median',
      value: arvEstimate,
      source: `Median of ${compValues.length} recent sold comps (1-mile radius, same bed count)`,
    })
  }
  if (property.latest_tax_assessment && property.value_source !== 'tax-assessment') {
    // Building-level assessment detection: NYC co-ops + some multi-unit
    // records return the ENTIRE building's assessment on every unit record.
    // When the assessment is >10× the AVM, it's structurally impossible for
    // a single unit — exclude from triangulation entirely. (Bronx 5700
    // Arlington Ave audit: $14M assessment on a $223K apartment produced
    // -$5.47M wealth build.)
    const assessmentRatio = property.latest_tax_assessment / Math.max(askPrice, 1)
    const BUILDING_LEVEL_RATIO = 10
    const isBuildingLevelAssessment = assessmentRatio > BUILDING_LEVEL_RATIO

    // State-aware multiplier. Some jurisdictions assess at 100% of market
    // (FL by statute, NY condos by class 2 rule); multiplying by 1.15
    // universally overshoots there. (Philly $3.1M assessment × 1.15 on a
    // $1.79M AVM = 73% overshoot — Philly uses market-value assessment as
    // of 2023.)
    const assessmentMultiplier = getTaxAssessmentMultiplier(report.state, property.property_type)

    // Some states (notably AZ, CA under Prop 13) publish the *assessed* value —
    // a fraction of market — rather than full market value. In AZ the LPV runs
    // ~10% of market, so even a 1.15× produces a number an order of magnitude
    // off. Skip the signal entirely when the assessment is implausibly low
    // relative to ask price.
    if (isBuildingLevelAssessment) {
      // Explicitly drop — the valueSignals array will just not get this entry.
      // Surface as a warning instead (see buildReportWarnings input).
      console.log(
        `[reportGenerator] tax assessment ${property.latest_tax_assessment.toLocaleString()} is >${BUILDING_LEVEL_RATIO}× AVM ${askPrice.toLocaleString()} — treating as building-level and excluding from triangulation`
      )
    } else if (assessmentRatio >= 0.5) {
      const multLabel = assessmentMultiplier === 1.0 ? '' : ` × ${assessmentMultiplier.toFixed(2)}`
      valueSignals.push({
        label: `Tax assessment${multLabel}`,
        value: Math.round(property.latest_tax_assessment * assessmentMultiplier),
        source:
          assessmentMultiplier === 1.0
            ? `County assessor records (${report.state} assesses at full market value)`
            : `County assessor records (assessments typically lag market ~${Math.round((assessmentMultiplier - 1) * 100)}%)`,
      })
    }
  }
  if (property.last_sale_price && property.last_sale_date && property.value_source !== 'last-sale-grown') {
    const saleYear = new Date(property.last_sale_date).getFullYear()
    const yearsSinceSale = Math.max(0, new Date().getFullYear() - saleYear)
    // Extrapolation ceiling: trailing-12mo zip growth compounded for 28 years
    // produces garbage ($1.55M on a $688K Fort Lauderdale AVM from a 1998
    // basis). Batch pressure test flagged this in 29% of reports.
    //   > 7yr old: drop entirely — too stale to inform current value
    //   1-5yr:    compound the actual elapsed years
    //   5-7yr:    cap the compound at 5 years
    const MAX_EXTRAPOLATION_YEARS = 5
    const MAX_SIGNAL_AGE_YEARS = 7
    if (yearsSinceSale > 0 && yearsSinceSale <= MAX_SIGNAL_AGE_YEARS) {
      const extrapolationYears = Math.min(yearsSinceSale, MAX_EXTRAPOLATION_YEARS)
      const zipGrowth = marketSnapshot?.salePriceGrowth12mo
      const growthRate =
        typeof zipGrowth === 'number' && Number.isFinite(zipGrowth)
          ? Math.max(-0.05, Math.min(0.08, zipGrowth))
          : 0.03
      const pctLabel = `${growthRate >= 0 ? '+' : ''}${(growthRate * 100).toFixed(1)}%`
      const capNote = yearsSinceSale > MAX_EXTRAPOLATION_YEARS ? ` (capped at ${MAX_EXTRAPOLATION_YEARS}yr extrapolation)` : ''
      const sourceLabel =
        typeof zipGrowth === 'number' && Number.isFinite(zipGrowth)
          ? `Sold ${saleYear} for $${property.last_sale_price.toLocaleString()} — grown at zip 12mo trend (${pctLabel}/yr)${capNote}`
          : `Sold ${saleYear} for $${property.last_sale_price.toLocaleString()} — no zip trend available, defaulted to +3%/yr${capNote}`
      valueSignals.push({
        label: `Last sale grown ${extrapolationYears}yr @ ${pctLabel}`,
        value: Math.round(property.last_sale_price * Math.pow(1 + growthRate, extrapolationYears)),
        source: sourceLabel,
      })
    }
    // sales > MAX_SIGNAL_AGE_YEARS old are intentionally dropped — a 1998 or
    // 2010 sale projected forward at today's trailing zip trend is not a
    // credible current-value anchor regardless of the cap.
  }

  // Value-spread only over POINT ESTIMATES (listing / AVM / comp median /
  // tax assessment / grown-sale). Previously the AVM's own confidence band
  // (value_range_low/high) was folded into the spread, meaning a wide AVM
  // band automatically produced low confidence even when the point
  // estimates agreed — DC Apolline audit: AVM $266k, comp median $285k
  // (7.1% point spread) was reporting "38.7% spread" because the AVM band
  // $215k-$316k was being stretched over the same denominator. The AVM
  // band is surfaced separately via the `avm-wide-range` warning.
  const signalPoints = valueSignals.map((s) => s.value)
  const { spread: valueSpread, confidence: valueConfidence } = deriveValueConfidence({
    signalPoints,
    estimatedValue: property.estimated_value,
    propertyType: property.property_type,
    subjectHasBuildingKey: subjectBuildingKeyForWarning !== null,
    sameBuildingCompCount,
    sameBuildingUnitCompCount,
  })
  // Single-signal triangulation can't be called "triangulated" at all —
  // one AVM with no cross-check (no sale-comp median, tax assessment, or
  // grown-sale) is by definition unverified. Force 'low' whenever we have
  // fewer than 2 independent value signals (DC Jefferson House audit: one
  // Rentcast AVM across a 25% price band was labeling "high/medium").

  // Value-uncertainty verdict cap. If the value triangulation has LOW
  // confidence AND the spread between the highest and lowest value signal
  // exceeds 50% of the subject price, the underlying price input to the
  // deal math may be wrong. A "STRONG DEAL" verdict on top of an uncertain
  // price is actively misleading — cap the verdict at MARGINAL so the user
  // is steered toward verifying value before trusting the math.
  //
  // Blacksburg audit: AVM $540k vs sale-comp median $240k = 101% spread,
  // confidence=low, but ltrMetrics.verdict landed on DEAL after the rent
  // heuristic multiplied. The cap protects against heuristic/AVM error.
  //
  // Second path (Fort Lauderdale / Escalones audit): single-signal AVM with
  // an internal band ≥40% wide. Cross-signal spread is zero (only one point
  // estimate), so the existing check misses it — but the AVM provider itself
  // is signalling ±20%+ uncertainty on the midpoint it returned. Treat a
  // ≥40% internal band on a single-signal valuation the same as a wide
  // cross-signal spread: cap DEAL → MARGINAL.
  const avmBandSpread =
    property.value_range_low && property.value_range_high && property.estimated_value > 0
      ? (property.value_range_high - property.value_range_low) / property.estimated_value
      : 0
  const valueUncertaintyCapped =
    (valueConfidence === 'low' && valueSpread > 0.5) ||
    (valueConfidence === 'low' && avmBandSpread >= 0.40)
  const effectiveVerdict: typeof ltrMetrics.verdict =
    valueUncertaintyCapped && ltrMetrics.verdict === 'DEAL' ? 'MARGINAL' : ltrMetrics.verdict
  // The raw classifier returns 'PASS' meaning "pass ON this deal" (i.e.
  // decline). Auditors and UI readers misread that label as approval (score
  // 15, -$720 cash flow, verdict 'PASS' reads as a passing grade). Derive
  // the surfaced label from the dealScore band so a failing deal can't carry
  // a label that sounds like success.
  const derivedVerdict =
    effectiveVerdict === 'PASS' || ltrMetrics.dealScore < 40
      ? 'FAIL'
      : effectiveVerdict
  const cappedLtrMetrics = {
    ...ltrMetrics,
    verdict: derivedVerdict as typeof ltrMetrics.verdict,
    primaryFailureMode:
      valueUncertaintyCapped && ltrMetrics.verdict === 'DEAL'
        ? 'VALUE_UNCERTAIN'
        : ltrMetrics.primaryFailureMode,
  }

  const rentWarnings: string[] = []
  const sameBuildingRentCompCount = (rentComps || []).filter((comp: any) => {
    return buildingKey(comp?.address || '') === buildingKey(report.address)
  }).length
  if (rentMultiplierRevertedDueToComps) {
    rentWarnings.push(
      `The student-housing rent multiplier pushed rent above 2× the highest nearby comparable, so we reverted to the raw AVM ($${Math.round(rawRentAvm).toLocaleString()}/mo). The AVM was likely already a whole-unit figure, not per-bedroom. If this is a student rental, verify whole-unit rent with a local property manager.`
    )
  }
  if (rentComps && rentComps.length >= 3) {
    const rentCompMedian = [...rentComps]
      .map((c: any) => Number(c.rent))
      .filter((v: number) => Number.isFinite(v) && v > 0)
      .sort((a: number, b: number) => a - b)[Math.floor(rentComps.length / 2)]
    if (rentCompMedian && monthlyRent < rentCompMedian * 0.75) {
      rentWarnings.push(
        `Rent AVM ($${Math.round(monthlyRent).toLocaleString()}/mo) is >25% below rent-comps median ($${Math.round(rentCompMedian).toLocaleString()}/mo) — AVM may have picked up lower-priced comps.`
      )
    }
    const sameBuildingWarning = buildSameBuildingRentCompWarning(
      report.address,
      rentComps
    )
    if (sameBuildingWarning) rentWarnings.push(sameBuildingWarning)
  }

  // Use the single source of truth in lib/studentHousing.ts — the old inline
  // copy drifted from studentHousing.ts's list.
  if (matchesKnownStudentComplex(property.subdivision)) {
    rentWarnings.push(
      `Property is in "${property.subdivision}" — a known student-rental complex. Rent AVMs typically return per-bedroom rates here; whole-property rent is often 3-5× the reported figure.`
    )
  }

  // Report-level warnings — class-of-property and data-gap caveats that live
  // on the FULL report (not just the teaser) so paying users see them too.
  // Computed by the pure helper below so it can be unit-tested standalone.
  const warnings = buildReportWarnings({
    propertyType: property.property_type,
    monthlyHOA,
    stateRulesMissing,
    state: report.state,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    squareFeet: property.square_feet,
    yearBuilt: property.year_built,
    askPrice: offerPrice,
    rentCompRents: (rentComps || [])
      .map((c: any) => Number(c?.rent))
      .filter((v: number) => Number.isFinite(v) && v > 0),
    likelyNYCCoop: isLikelyNYCCoop({
      state: report.state,
      city: report.city,
      propertyType: property.property_type,
      yearBuilt: property.year_built,
      taxAssessmentRatio:
        property.latest_tax_assessment && property.estimated_value
          ? property.latest_tax_assessment / Math.max(property.estimated_value, 1)
          : undefined,
    }),
    rentAvmMonthly: rawRentAvm,
    rentCompMedianMonthly: (() => {
      const rs = (rentComps || [])
        .map((c: any) => Number(c?.rent))
        .filter((v: number) => Number.isFinite(v) && v > 0)
        .sort((a: number, b: number) => a - b)
      if (rs.length === 0) return null
      const mid = Math.floor(rs.length / 2)
      return rs.length % 2 ? rs[mid] : Math.round((rs[mid - 1] + rs[mid]) / 2)
    })(),
    dataCompleteness: property.data_completeness,
    subjectAvmValue: property.value_source === 'avm' ? property.estimated_value : undefined,
    bedroomMatchedCompMedian: arvEstimate,
    bedroomMatchedCompCount: compValues.length,
    subjectHasBuildingKey: subjectBuildingKeyForWarning !== null,
    sameBuildingCompCount,
    totalCompCount: dedupedSaleComps.length,
    sameBuildingUnitCompCount,
    zipAppreciation12mo: marketSnapshot?.salePriceGrowth12mo,
    zipRentGrowth12mo: marketSnapshot?.rentGrowth12mo,
    valueSignalCount: signalPoints.length,
    buildingHoaAvg: buildingHoaRecord?.monthlyHoa ?? null,
    hoaSource: hoaFromBuildingDb
      ? 'building-avg'
      : capturedHOA > 0
      ? 'listing'
      : hoaInferred
      ? 'inferred-condo-default'
      : 'not-captured',
  })

  if (!hasListingPrice) {
    warnings.push({
      code: 'listing-price-unavailable',
      message: `Our data provider did not return a live listing price for this address. The ask/breakeven comparison below is using Deal Doctor's estimated value (${askPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}) as a fallback, not the current MLS ask. Verify the active listing price before relying on the negotiation guidance or offer tiers.`,
    })
  }

  // AVM confidence band — mirror the preview warning so paying users also see
  // it. Same two-tier logic: ≥40% → extremely wide (do not rely on midpoint),
  // 30–40% → wide (verify before acting). avmBandSpread is computed alongside
  // the verdict cap above.
  if (avmBandSpread >= 0.40 && property.value_range_low && property.value_range_high) {
    const lowEndPct = Math.round(
      ((property.estimated_value - property.value_range_low) / property.estimated_value) * 100
    )
    warnings.push({
      code: 'avm-extremely-wide',
      message: `Value AVM has an extremely wide confidence band ($${property.value_range_low.toLocaleString()}–$${property.value_range_high.toLocaleString()}, ±${Math.round((avmBandSpread / 2) * 100)}%). The low end is ${lowEndPct}% below the midpoint — every derived metric (cap rate, DSCR, cash flow, IRR) changes materially across this range. Do NOT make an offer based on the midpoint alone. Get an independent CMA or in-person appraisal before trusting these numbers.`,
    })
  } else if (avmBandSpread > 0.30 && property.value_range_low && property.value_range_high) {
    warnings.push({
      code: 'avm-wide-range',
      message: `Value AVM has a wide confidence band ($${property.value_range_low.toLocaleString()}–$${property.value_range_high.toLocaleString()}, ±${Math.round((avmBandSpread / 2) * 100)}%). The midpoint is uncertain; cross-check against Zillow / Redfin / a local agent before trusting.`,
    })
  }

  // Surface the sqft correction to the user so they know the displayed
  // figure was normalized. Keep it separate from the data-provenance-level
  // warnings above — this one says "we fixed a known data vendor bug".
  if (sqftCorrection) {
    warnings.push({
      code: 'sqft-corrected',
      message: `Data provider reported ${sqftCorrection.original.toLocaleString()} sqft for this unit — implausible for a ${property.property_type}. Using ${sqftCorrection.replaced.toLocaleString()} sqft (${sqftCorrection.source === 'comp-median' ? 'median of same-market comps' : 'bedroom heuristic'}) for carrying-cost estimates. Verify actual unit sqft on listing before making an offer.`,
    })
  }

  if (taxLikelyExempted) {
    const countyAnnual = countyRecordTax * 12
    const stateAnnual = stateAverageTax * 12
    warnings.push({
      code: 'property-tax-likely-exempted',
      message: `County records show property tax of $${countyRecordTax.toLocaleString()}/mo ($${countyAnnual.toLocaleString()}/yr) — materially below the state-average estimate of $${stateAverageTax.toLocaleString()}/mo ($${stateAnnual.toLocaleString()}/yr) for this price. The seller likely carries a homestead, senior-freeze, or veteran exemption that resets on sale. Verify the non-exempt tax bill with the county assessor before underwriting — your actual carrying cost could be ~$${(stateAverageTax - countyRecordTax).toLocaleString()}/mo higher.`,
    })
  }

  const monthlyPITI = ltrMetrics.monthlyMortgagePayment + monthlyPropertyTax + monthlyInsurance
  const cashToClose = calculateCashToClose(
    offerPrice,
    downPaymentPct,
    rehabBudget,
    monthlyPITI,
    0.025,
    6,
    stateRules.transferTaxRate
  )

  // Growth clamps. We accept upside caps ≤ 15% (avoids "rent will double")
  // and asymmetric floors: one bad trailing-12-month print shouldn't compound
  // for 5 years. Rent rarely falls >2%/yr sustainedly even in soft cycles;
  // sustained home-price drops >1%/yr are historically rare outside crises.
  // These floors tamed the Old Westbury audit where -5% rent + -1% apprec.
  // quietly compounded a luxury zip into ruin.
  const clampGrowth = (
    x: number | null | undefined,
    fallback: number,
    floor: number
  ): number => {
    if (x == null || !Number.isFinite(x)) return fallback
    return Math.max(floor, Math.min(0.15, x))
  }
  // Honor zip-12mo verbatim on the downside. Previous floors (-2% rent,
  // -3% appreciation) silently softened declining markets: ZIP 21202 condo
  // audit printed -5.41% sale growth / -4.0% rent growth but projections
  // used dampened mid-points with no disclosure. Floors now only guard
  // against historically-implausible freefall (-8% / yr) while preserving
  // the published zip trend otherwise.
  const rentGrowthRate = clampGrowth(marketSnapshot?.rentGrowth12mo, 0.03, -0.08)
  const rawAppreciationRate = clampGrowth(marketSnapshot?.salePriceGrowth12mo, 0.03, -0.08)
  // Cross-signal sanity check: if trailing-12mo rent growth is negative in
  // this zip, a trailing-12mo appreciation print above 3% is almost always
  // a data lag (or a luxury outlier dragging the average) rather than real
  // momentum — a softening rental market doesn't produce 8% condo
  // appreciation. Cap to a 3% base case so the 5-yr wealth projection
  // doesn't compound an implausible value. 20037 DC audit: -2% rent growth
  // alongside +8.18% appreciation flagged exactly this mismatch.
  //
  // Symmetric protection against overly bearish base cases: a trailing
  // -5.5% projected flat for 5 years compounds to a -25% cumulative draw-
  // down — outside the historical range for all but the worst housing
  // crashes, and contradictory when the same zip reports positive rent
  // growth (rents don't grow in markets losing a quarter of their value).
  // When zip sale growth is negative AND rent growth is ≥ 0 OR zip sale
  // growth is more extreme than -3%, blend 70/30 with a long-run US
  // real-home-price mean (~2.5% nominal) to land on a defensible base.
  const LONG_RUN_APPRECIATION_MEAN = 0.025
  const saleFlat = rawAppreciationRate
  let appreciationRate = saleFlat
  if (rentGrowthRate < 0) {
    // bearish rents + bullish prices → cap prices at 3%
    appreciationRate = Math.min(saleFlat, 0.03)
  } else if (saleFlat < 0) {
    // bullish rents + bearish prices → blend 70/30 with long-run baseline,
    // then floor at -2%. This respects local softening without assuming
    // the next 5 years repeat the last 12 months of a bearish tape.
    const blended = 0.7 * saleFlat + 0.3 * LONG_RUN_APPRECIATION_MEAN
    appreciationRate = Math.max(blended, -0.02)
  }
  if (saleFlat < -0.03) {
    // regardless of rent signal, a sustained >3% annual decline is rare;
    // hard floor at -2% on the base case.
    appreciationRate = Math.max(appreciationRate, -0.02)
  }

  // HARD universal upper cap — this is the base-case projected over 5 years.
  // A zip's trailing-12mo print of +15% is not a credible 5-year compounding
  // rate; 15%/yr for 5 years = 2.01× (implies a market top every 5 years).
  // Batch pressure test item #4 (100 E Huron Chicago Gold Coast) caught a
  // 15% zip trend landing unclamped in the wealth projection. The long-run
  // US nominal home-price mean is ~4-5% across the post-WWII era; we use 5%
  // as a generous ceiling and flag the divergence for anything higher.
  const UNIVERSAL_APPRECIATION_CEILING = 0.05
  const appreciationCapped = appreciationRate > UNIVERSAL_APPRECIATION_CEILING
  if (appreciationCapped) {
    console.log(
      `[reportGenerator] base-case appreciation capped from ${(appreciationRate * 100).toFixed(1)}% to ${(UNIVERSAL_APPRECIATION_CEILING * 100).toFixed(0)}% (zip print too hot to compound for 5yr)`
    )
    appreciationRate = UNIVERSAL_APPRECIATION_CEILING
  }

  const stateTaxGrowth = getStatePropertyTaxGrowth(report.state)
  const taxWeight = monthlyPropertyTax / monthlyExpenses
  const insWeight = monthlyInsurance / monthlyExpenses
  const otherWeight = 1 - taxWeight - insWeight
  const blendedExpenseGrowth =
    stateTaxGrowth * taxWeight + 0.06 * insWeight + 0.025 * otherWeight

  const projections = projectWealth({
    offerPrice,
    loanAmount: ltrMetrics.loanAmount,
    annualRate: investorRate,
    amortYears: 30,
    initialMonthlyRent: monthlyRent,
    vacancyRate: 0.05,
    initialMonthlyExpenses: monthlyExpenses,
    annualDepreciation: ltrMetrics.annualDepreciation,
    rentGrowthRate,
    appreciationRate,
    expenseGrowthRate: blendedExpenseGrowth,
    years: 5,
  })
  const year5 = projections[projections.length - 1]
  const irr5yr = calculateHoldPeriodIRR(cashToClose.totalCashToClose, projections)

  const financingAlternatives = calculateFinancingAlternatives({
    offerPrice,
    pmmsRate: rates.mortgage30yr,
    monthlyRent,
    vacancyRate: 0.05,
    monthlyExpenses,
    rehabBudget,
    propertyType: property.property_type,
    transferTaxRate: stateRules.transferTaxRate,
  })

  const sensitivity = calculateSensitivity({
    offerPrice,
    downPaymentPct,
    annualRate: investorRate,
    monthlyRent,
    vacancyRate: 0.05,
    monthlyExpenses,
    rehabBudget,
    annualDepreciation: ltrMetrics.annualDepreciation,
    cashToClose: cashToClose.totalCashToClose,
    // Pass the hero projection's ACTUAL growth rates so the sensitivity's
    // "Base case" row can't disagree with the hero's 5yr IRR number.
    baseAppreciationRate: appreciationRate,
    baseRentGrowthRate: rentGrowthRate,
    baseExpenseGrowthRate: blendedExpenseGrowth,
  })

  let strRevenue = estimateSTRRevenue(report.city, report.state, property.bedrooms)
  let strOccupancyOverride: number | undefined
  const strProhibited = isStrProhibitedForInvestor(report.state, report.city)
  // DC caps non-primary-residence STRs at 90 nights/yr under the Short-Term
  // Rental Regulation Act. estimateSTRRevenue bakes in a 60% occupancy
  // baseline (~219 nights) — illegal for a non-owner-occupied DC unit.
  // Scale revenue + occupancy down to the 90-night ceiling so the fixes
  // card and the monthly gross agree instead of one saying "legal cap: 90
  // nights" while the other assumes 219.
  if (report.state === 'DC' || report.state === 'dc') {
    const legalOccupancy = 90 / 365
    const baselineOccupancy = 0.60
    strRevenue = Math.round((strRevenue * legalOccupancy) / baselineOccupancy)
    strOccupancyOverride = legalOccupancy
  }
  // Baltimore City Code §5A restricts STR hosts to their primary residence;
  // whole-unit non-owner-occupied STR is broadly prohibited. For an investor
  // buyer the revenue is legally moot — zero it so the projection card and
  // AI narration don't treat it as optionality.
  if (strProhibited) {
    strRevenue = 0
    strOccupancyOverride = 0
  }
  const strProjection = calculateSTRProjection({
    monthlyGrossRevenue: strRevenue,
    occupancyOverride: strOccupancyOverride,
    monthlyMortgagePayment: ltrMetrics.monthlyMortgagePayment,
    monthlyPropertyTax,
    monthlyInsuranceLTR: monthlyInsurance,
    monthlyLTRCashFlow: ltrMetrics.monthlyNetCashFlow,
    hotelOccupancyTaxRate: stateRules.hotelOccupancyTaxRate,
    strAnnualRegistrationFee: stateRules.strAnnualRegistrationFee,
  })

  const recommendedOffers = calculateRecommendedOffers({
    monthlyRent,
    vacancyRate: 0.05,
    annualRate: investorRate,
    downPaymentPct,
    rehabBudget,
    propertyTaxRate: stateRules.propertyTaxRate,
    monthlyInsurance,
    monthlyMaintenance,
    monthlyHOA,
    targetCoC: 0.08,
    targetIRR: 0.1,
    offerPrice,
  })

  // Canonical breakeven — single source of truth used by summaryCard,
  // recommendedOffers, and the AI narration. Prefer the teaser's breakeven
  // when present (it locked in at preview time with the caller's expense
  // stack); otherwise fall back to the recommendedOffers solver. Previously
  // the AI narrated `recommendedOffers.breakevenPrice` (e.g. $148k) while
  // the summaryCard showed the teaser value (e.g. $138k) — $10k mismatch in
  // one report. Now all three read from `canonicalBreakEven`.
  const canonicalBreakEven = resolveCanonicalBreakeven(
    report.teaserData,
    recommendedOffers.breakevenPrice
  )
  recommendedOffers.breakevenPrice = canonicalBreakEven

  // ── Invariant hard-gate ─────────────────────────────────────────────
  // Pure-code sanity checks across the math we just computed. Runs ONCE
  // (no retry loop). FAIL severity → throws InvariantGateError and the
  // route returns 504 to the user rather than shipping a report with a
  // known math contradiction. WARN severity → attached to warnings so the
  // UI can surface a soft flag. Sonnet sees none of this — math is code's
  // job.
  const finiteOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null
  const teaserBreakeven = (() => {
    const td = report.teaserData as { breakeven?: number; breakevenPrice?: number } | null
    if (!td) return null
    return finiteOrNull(td.breakeven) ?? finiteOrNull(td.breakevenPrice)
  })()
  const sensitivityBase = (sensitivity as Array<{ scenario: string; fiveYrIRR?: number; monthlyCashFlow?: number }>)?.find?.(
    (r) => String(r.scenario || '').toLowerCase().includes('base')
  )
  // ── Composite score (batch pressure test item #3) ────────────────────
  // The old dealScore was cash-flow / cap-rate / CoC only, so
  // appreciation-driven deals scored 0/100 even with 17.5% IRR and +$630K
  // wealth (Chicago Bucktown audit) AND the label could contradict the
  // verdict (Arlington 100/100 but "Marginal"). Replace with a composite
  // weighting cash flow, DSCR, IRR, value confidence, and breakeven
  // position — computed now that all five inputs are available.
  const compositeScore = computeCompositeScore({
    monthlyNetCashFlow: cappedLtrMetrics.monthlyNetCashFlow,
    dscr: cappedLtrMetrics.dscr,
    irr5yr,
    valueConfidence,
    offerPrice,
    breakevenPrice: canonicalBreakEven,
  })
  const firstPageTrust = evaluateFirstPageTrust({
    bathrooms: property.bathrooms,
    bedrooms: property.bedrooms,
    climateFloodInsuranceRequired: climate?.floodInsuranceRequired,
    dataCompleteness: property.data_completeness,
    hoaSource: hoaFromBuildingDb
      ? 'building-avg'
      : capturedHOA > 0
      ? 'listing'
      : hoaInferred
      ? 'inferred-condo-default'
      : 'not-captured',
    listingPriceSource: property.listing_price_source ?? null,
    listingPriceStatus: property.listing_price_status ?? null,
    listingPriceCheckedAt: property.listing_price_checked_at ?? null,
    listingPriceUserSupplied: property.listing_price_user_supplied ?? false,
    primaryListingPrice: property.primary_listing_price ?? null,
    fallbackListingPrice: property.fallback_listing_price ?? null,
    monthlyNetCashFlow: cappedLtrMetrics.monthlyNetCashFlow,
    propertyTaxSource,
    propertyType: property.property_type,
    rawScore: compositeScore,
    rentWarnings,
    reportWarnings: warnings,
    insuranceSource: insuranceEstimate.insuranceSource,
    squareFeet: property.square_feet,
    sameBuildingRentCompCount,
    taxLikelyExempted,
    totalRentCompCount: rentComps?.length ?? 0,
    valueConfidence,
    yearBuilt: property.year_built,
  })
  Object.assign(cappedLtrMetrics, {
    dealScore: firstPageTrust.adjustedScore,
    rawDealScore: compositeScore,
  })
  Object.assign(ltrMetrics, {
    dealScore: firstPageTrust.adjustedScore,
    rawDealScore: compositeScore,
  })

  // Invariant gate runs AFTER the composite score so the dealScore-vs-wealth
  // contradiction rule sees the final score users will actually see.
  const invariantResult = runInvariantCheck({
    summaryIrr: irr5yr,
    sensitivityBaseIrr: finiteOrNull(sensitivityBase?.fiveYrIRR),
    summaryCashFlow: cappedLtrMetrics.monthlyNetCashFlow,
    sensitivityBaseCashFlow: finiteOrNull(sensitivityBase?.monthlyCashFlow),
    instantCardBreakeven: teaserBreakeven,
    fullReportBreakeven: recommendedOffers.breakevenPrice,
    canonicalBreakeven: canonicalBreakEven,
    wealthYears: projections.map((p: { year: number; cumulativeCashFlow?: number; cumulativeTaxShield?: number; equityFromPaydown?: number; equityFromAppreciation?: number; depreciationRecaptureTax?: number; totalWealthBuilt?: number }) => ({
      year: p.year,
      cumulativeCashFlow: p.cumulativeCashFlow,
      cumulativeTaxShield: p.cumulativeTaxShield,
      equityFromPaydown: p.equityFromPaydown,
      equityFromAppreciation: p.equityFromAppreciation,
      depreciationRecaptureTax: p.depreciationRecaptureTax,
      totalWealthBuilt: p.totalWealthBuilt,
    })),
    dscr: cappedLtrMetrics.dscr,
    monthlyRent,
    avm: property.estimated_value,
    propertyType: property.property_type,
    monthlyHOA,
    dealScore: cappedLtrMetrics.dealScore,
  })
  if (!invariantResult.ok) {
    console.error(
      `[reportGenerator] invariant gate FAILED — ${invariantResult.failures.length} contradiction(s):`,
      invariantResult.failures.map((f: InvariantFailure) => `${f.code}: ${f.message}`).join(' | ')
    )
    throw new InvariantGateError(invariantResult.failures)
  }
  if (invariantResult.warnings.length > 0) {
    console.log(
      `[reportGenerator] invariant gate: ${invariantResult.warnings.length} warning(s) attached:`,
      invariantResult.warnings.map((w: InvariantFailure) => w.code).join(', ')
    )
  }
  const auditCheckedAt = new Date().toISOString()
  const propertyProfileAudit = buildPropertyProfileAudit({
    propertyType: property.property_type,
    estimatedValue: property.estimated_value,
    squareFeet: property.square_feet,
    monthlyRent,
    valueSource: property.value_source,
    checkedAt: auditCheckedAt,
  })
  const authorityAudit = buildAuthorityAudit({
    state: report.state,
    city: report.city,
    stateRulesMissing,
    propertyTaxSource,
    checkedAt: auditCheckedAt,
  })
  let qualityAudit = buildQualityAudit({
    checkedAt: auditCheckedAt,
    propertyProfileAudit,
    mathWarnings: invariantResult.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
    })),
    authorityAudit,
  })
  const validationFlagsForNarrator = [
    ...invariantResult.warnings,
    ...authorityAudit.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
    })),
  ]
  if (qualityAudit.status === 'blocked') {
    throw new QualityAuditError(`Quality audit blocked: ${qualityAudit.summary}`, qualityAudit)
  }

  // Deal Doctor AI narration. If the model fails (rate limit, quota exhausted,
  // network), we still return the rest of the report — the math and climate
  // sections stand on their own. Only the "3 fixes" section goes missing.
  let dealDoctor: DealDoctorOutput | null = null
  let dealDoctorError: string | null = null
  let dealDoctorErrorDetail: string | null = null

  // Closure captures the full positional-arg list so the initial call and
  // any reviewer-triggered rewrite stay in lock-step. Only `reviewCorrections`
  // varies between first-pass and rewrite-pass invocations.
  const runGenerator = (reviewCorrections?: ReviewConcern[]) =>
    aiGenerator(
      report.address,
      report.city,
      report.state,
      strategy as 'LTR' | 'STR' | 'FLIP',
      // Use the capped metrics so the AI narration stays consistent with the
      // UI verdict — no "STRONG DEAL" diagnosis layered on top of a
      // MARGINAL-via-value-uncertainty verdict.
      cappedLtrMetrics,
      offerPrice,
      monthlyRent,
      investorRate,
      climate ?? undefined,
      property.bedrooms,
      // Suppress ARV when value triangulation has LOW confidence. A comp-median
      // ARV built from a contaminated comp set (e.g. SFR comps leaking into a
      // condo analysis, different-building comps dominating a same-building
      // property) becomes an AI anchor for a bogus "flip for value-add" fix
      // and a misleading triangulation spread. Baltimore Harbor East audit:
      // comp-median $440k vs same-building cap ~$250k on a condo unit. When
      // we can't trust the signal, don't hand it to the narrator.
      valueConfidence === 'low' ? undefined : arvEstimate,
      rehabBudget || undefined,
      // Canonical breakeven — same source of truth the hero + Recommended
      // Offers sections use. Stops the AI from re-solving with solver defaults
      // and narrating a third, different breakeven number.
      canonicalBreakEven,
      // Structural facts — without these Claude invents "older urban row
      // home" for DC condos and similar category mistakes.
      property.property_type,
      property.year_built,
      property.square_feet,
      // Jurisdiction-level STR ban flag (Baltimore §5A, NYC LL18). When
      // true, the AI must NOT cite STR as optionality.
      strProhibited,
      // STR net monthly cash flow after opex — the apples-to-apples number
      // the AI needs so it can't cherry-pick STR gross revenue as a "pivot
      // win" when LTR actually nets more (Chicago 1720 S Michigan audit).
      strProjection?.monthlyNetCashFlow ?? null,
      reviewCorrections,
      // Blocking math/authority audit warnings flow in as hard constraints so
      // the narrative cannot talk past known risk signals.
      validationFlagsForNarrator,
    )

  try {
    dealDoctor = await runGenerator()
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status
    const apiError = err?.error ? JSON.stringify(err.error) : null
    const detail = [
      err?.constructor?.name,
      status ? `status=${status}` : null,
      err?.message,
      apiError,
    ]
      .filter(Boolean)
      .join(' · ')
    logger.error('reportGenerator.deal_doctor_ai_failed', {
      uuid: report.id,
      address: report.address,
      detail,
      error: err,
    })
    dealDoctorErrorDetail = detail
    const isRateLimit =
      status === 429 || err?.message?.includes('429') || err?.message?.includes('quota')
    const isAuth = status === 401 || status === 403
    dealDoctorError = isRateLimit
      ? 'AI diagnosis temporarily unavailable — rate limit reached. Numbers below are unaffected.'
      : isAuth
      ? 'AI diagnosis unavailable — API credential issue. Numbers below are unaffected.'
      : 'AI diagnosis could not be generated. Numbers below are unaffected.'
  }

  const result: Record<string, any> = {
    generatedAt: new Date().toISOString(),
    property: {
      address: report.address,
      city: report.city,
      state: report.state,
      askPrice,
      listingPrice: property.listing_price,
      listingPriceSource: property.listing_price_source,
      listingPriceStatus: property.listing_price_status,
      listingPriceCheckedAt: property.listing_price_checked_at,
      listingPriceUserSupplied: property.listing_price_user_supplied,
      offerPrice,
      downPaymentPct,
      rehabBudget,
      strategy: report.strategy ?? 'LTR',
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      sqft: property.square_feet,
      yearBuilt: property.year_built,
      propertyType: property.property_type,
      latitude: property.latitude,
      longitude: property.longitude,
    },
    rates: {
      mortgage30yr: rates.mortgage30yr,
      mortgage30yrInvestor: investorRate,
      investorPremiumBps: Math.round(INVESTOR_PREMIUM[strategy] * 10000),
      mortgage15yr: rates.mortgage15yr,
      fedFunds: rates.fedFundsRate,
    },
    dealDoctorInputs: {
      canonicalBreakEvenPrice: canonicalBreakEven,
      strNetMonthlyCashFlow: strProjection?.monthlyNetCashFlow ?? null,
      strProhibited,
    },
    breakeven: (() => {
      // Canonical breakeven reconciled above (teaser preferred, else the
      // recommendedOffers solver). Read that single source so summaryCard,
      // recommendedOffers, and the AI narration all agree on one number.
      const bePrice = canonicalBreakEven
      // When breakeven ≈ market price, the "Breakeven: $266k / Your offer:
      // $266k" display is tautological. Flag it so the UI can render
      // "Cash-flow neutral at market price" instead, and append a
      // sensitivity strip showing cash flow at -5% / -10% / -15% of offer
      // price so the user has actionable data to negotiate against.
      //
      // Asymmetric rule: only flag "neutral" when the deal actually works at
      // offer (bePrice >= offerPrice). Otherwise offer=BE+1% shows as
      // "Neutral" when the buyer is in fact losing money every month — the
      // 4518 Galesburg audit caught this at -$155/mo. Also tightened from
      // 2% to 0.5% so a $2k gap on a $128k deal no longer qualifies.
      const nearBreakeven =
        bePrice >= offerPrice &&
        (bePrice - offerPrice) / Math.max(offerPrice, 1) < 0.005

      // Monthly CF at an arbitrary offer price, holding the rest of the
      // deal (rate, rent, expense stack) constant. Direct replica of the
      // core math in calculateDealMetrics — kept inline so we don't have to
      // round-trip through calculateDealMetrics for each sensitivity point.
      const monthlyCfAtPrice = (price: number): number => {
        const loan = price * (1 - downPaymentPct)
        const monthlyRate = investorRate / 12
        const n = 30 * 12
        const payment =
          loan * (monthlyRate * Math.pow(1 + monthlyRate, n)) /
          (Math.pow(1 + monthlyRate, n) - 1)
        // Property-tax portion of expenses scales with price; the other
        // fixed-$ components (insurance, HOA, maintenance) don't.
        const taxAtPrice = Math.round((price * stateRules.propertyTaxRate) / 12)
        const fixedOtherExpenses = monthlyInsurance + monthlyHOA + monthlyMaintenance
        const effRent = monthlyRent * 0.95
        return Math.round(effRent - payment - taxAtPrice - fixedOtherExpenses)
      }

      const sensitivity = [-0.05, -0.10, -0.15].map((offsetPct) => {
        const price = Math.round(offerPrice * (1 + offsetPct))
        return {
          offsetPct,
          price,
          monthlyCashFlow: monthlyCfAtPrice(price),
        }
      })

      return {
        price: bePrice,
        yourOffer: offerPrice,
        delta: bePrice - offerPrice,
        nearBreakeven,
        sensitivity,
      }
    })(),
    expenses: {
      monthlyPropertyTax,
      monthlyInsurance,
      insuranceSource: insuranceEstimate.insuranceSource,
      monthlyMaintenance,
      monthlyHOA,
      monthlyTotal: monthlyExpenses,
      // Explicit year-1 monthly net cash flow so downstream audits can
      // verify the AI's "$X/mo negative cash flow" narrative against a
      // single numeric source instead of inferring from rent - expenses.
      monthlyCashFlow: cappedLtrMetrics.monthlyNetCashFlow,
      propertyTaxSource,
      // Single source of truth for HOA provenance. Priority matches the
      // value actually used in monthlyHOA: building-avg wins when the
      // listing was overridden as an outlier (buildingHoaRecordUsed != null),
      // then captured listing, then inferred. hoaInferred / hoaFromBuildingDb
      // are DERIVED from hoaSource so the three flags cannot disagree — the
      // 414 Water St audit saw hoaSource='listing' AND hoaFromBuildingDb=true
      // simultaneously because the two emission sites had inverted priority.
      hoaSource: (hoaFromBuildingDb
        ? 'building-avg'
        : capturedHOA > 0
        ? 'listing'
        : hoaInferred
        ? 'inferred-condo-default'
        : 'not-captured') as 'listing' | 'building-avg' | 'inferred-condo-default' | 'not-captured',
      hoaInferred: hoaInferred && !hoaFromBuildingDb && !(capturedHOA > 0),
      hoaFromBuildingDb,
      hoaBuildingNote: buildingHoaRecordUsed?.includes ?? null,
    },
    rentAdjustment: {
      applied: rentAdjustment.isMultiplied,
      perBedroomRent: rentAdjustment.perBedroomRent,
      bedroomsUsed: rentAdjustment.bedroomsUsed,
      effectiveRent: rentAdjustment.effectiveRent,
      reason: rentAdjustment.reason,
    },
    inputs: {
      monthlyRent,
      vacancyRate: 0.05,
      monthlyExpenses,
      annualRate: investorRate,
      amortYears: 30,
    },
    cashToClose,
    firstPageTrust,
    wealthProjection: {
      years: projections,
      hero: {
        totalWealthBuilt5yr: year5?.totalWealthBuilt ?? 0,
        cumulativeCashFlow5yr: year5?.cumulativeCashFlow ?? 0,
        equityFromPaydown5yr: year5?.equityFromPaydown ?? 0,
        equityFromAppreciation5yr: year5?.equityFromAppreciation ?? 0,
        cumulativeTaxShield5yr: year5?.cumulativeTaxShield ?? 0,
        irr5yr,
        propertyValue5yr: year5?.propertyValue ?? 0,
      },
      assumptions: {
        rentGrowthRate,
        appreciationRate,
        expenseGrowthRate: blendedExpenseGrowth,
        stateTaxGrowth,
        effectiveTaxRate: 0.28,
        saleCostPct: 0.06,
        rentGrowthSource: marketSnapshot?.rentGrowth12mo != null ? 'zip-12mo' : 'default-3pct',
        appreciationSource:
          marketSnapshot?.salePriceGrowth12mo != null ? 'zip-12mo' : 'default-3pct',
      },
    },
    financingAlternatives,
    sensitivity,
    recommendedOffers,
    strProjection: shouldIncludeStrProjection({
      state: report.state,
      city: report.city,
      ownerOccupied: false,
    })
      ? strProjection
      : null,
    marketSnapshot,
    locationSignals,
    rentComps,
    climate,
    valueTriangulation: buildValueTriangulationOutput({
      signals: valueSignals,
      signalPoints,
      primaryValue: property.estimated_value,
      valueSource: property.value_source,
      valueRangeLow: property.value_range_low,
      valueRangeHigh: property.value_range_high,
      spread: valueSpread,
      confidence: valueConfidence,
      askPrice,
      sameBuildingMedian,
    }),
    rentWarnings,
    warnings,
    qualityAudit,
    marketAudit: createPendingMarketAudit(),
    // Invariant-gate WARN flags persisted alongside the report so retry-ai
    // (which rebuilds the generateDealDoctor call from fullReportData
    // rather than re-running the full pipeline) can forward the same
    // constraints into the prompt on retry.
    invariantWarnings: invariantResult.warnings,
    crossCheckLinks: (() => {
      // Prefer direct on-platform URLs so the user doesn't have to tap
      // through a Google interstitial. Zillow accepts the dashed-address
      // slug form; Realtor.com resolves its search page directly; Redfin
      // doesn't expose a clean deep-link without a city/property ID so we
      // send the user to their zipcode browse page as the closest direct
      // anchor.
      const addrSlug = report.address.replace(/[\s,]+/g, '-').replace(/-+/g, '-')
      const encodedSlug = encodeURIComponent(addrSlug)
      const zip = report.zipCode || ''
      return {
        zillow: `https://www.zillow.com/homes/${encodedSlug}_rb/`,
        redfin: zip
          ? `https://www.redfin.com/zipcode/${encodeURIComponent(zip)}`
          : `https://www.redfin.com/city/${encodeURIComponent(report.state)}/${encodeURIComponent(report.city)}`,
        realtor: `https://www.realtor.com/realestateandhomes-search/${encodedSlug}`,
      }
    })(),
    ltr: cappedLtrMetrics,
    dealDoctor,
    dealDoctorError,
    dealDoctorErrorDetail,
    // Expose the SAME comp set used in the triangulation median (`compsForArv`),
    // not the raw saleComps. Otherwise the report can say "Median of 1 recent
    // sold comps" while displaying 2 comps to the user — the ones filtered out
    // of the median were visible in comparableSales. 414 Water St #1501 audit:
    // valueTriangulation signal source "Median of 1 recent sold comps" with
    // comparableSales.length === 2 was an internal inconsistency.
    comparableSales: compsForArv.slice(0, 4),
    stateRules: {
      state: report.state,
      rentControl: stateRules.rentControl,
      landlordFriendly: stateRules.landlordFriendly,
      strNotes: stateRules.strNotes,
      propertyTaxRate: stateRules.propertyTaxRate,
    },
  }

  // ── Reviewer pass ────────────────────────────────────────────────────
  // Second Sonnet call cross-checks the narrative against the structured
  // data it was given. Runs inline (not fire-and-forget) so any correction
  // lands in `result.dealDoctor` before persistence / PDF export.
  //
  // maxRounds: 2 + verifyAfterRewrite: false = exactly ONE rewrite, no
  // verification pass afterwards. Saves ~25-30s per rewritten report vs.
  // the full review-rewrite-review cycle, at the cost of not catching
  // regressions the rewrite itself introduces.
  //
  //   verdict 'clean'   → ship
  //   verdict 'rewrite' (conf ≥ 0.80, concerns non-empty) → ONE regenerate
  //       with `reviewCorrections` forwarded, then ship without re-review
  //   verdict 'block'   → throw (math contradictions fail loudly)
  //   reviewer throws / low confidence / empty concerns → ship original
  if (dealDoctor) {
    let originalDealDoctor: DealDoctorOutput | null = null
    const failClosedReviewer = aiGenerator === generateDealDoctor
    const loopResult = await runReviewLoop(
      result,
      dealDoctor as unknown as Record<string, unknown>,
      async (concerns) => {
        originalDealDoctor = dealDoctor
        const rewritten = await runGenerator(concerns)
        return rewritten as unknown as Record<string, unknown>
      },
      {
        maxRounds: 2,
        confidenceFloor: 0.80,
        verifyAfterRewrite: false,
        reviewerErrorPolicy: failClosedReviewer ? 'block' : 'ship',
      }
    )
    qualityAudit = attachReviewStage(qualityAudit, {
      checkedAt: new Date().toISOString(),
      blocked: loopResult.outcome.blocked,
      summary: loopResult.outcome.finalSummary,
      reviewerErrored: loopResult.outcome.history.some((h) => !!h.error),
      failClosed: failClosedReviewer,
      verdict: loopResult.outcome.finalVerdict,
      confidence: loopResult.outcome.finalConfidence,
      concernCount: loopResult.outcome.finalConcerns.length,
    })
    result.qualityAudit = qualityAudit

    if (loopResult.outcome.blocked) {
      logger.error('reportGenerator.review_blocked', {
        uuid: report.id,
        address: report.address,
        summary: loopResult.outcome.finalSummary,
        concernCount: loopResult.outcome.finalConcerns.length,
      })
      throw new QualityAuditError(
        `Quality audit blocked: ${loopResult.outcome.finalSummary}`,
        qualityAudit
      )
    }

    dealDoctor = loopResult.narrative as unknown as DealDoctorOutput
    result.dealDoctor = dealDoctor
    result.reviewOutcome = {
      rounds: loopResult.outcome.rounds,
      verdict: loopResult.outcome.finalVerdict,
      confidence: loopResult.outcome.finalConfidence,
      concerns: loopResult.outcome.finalConcerns,
      summary: loopResult.outcome.finalSummary,
      rewrote: originalDealDoctor !== null,
      originalDealDoctor,
      history: loopResult.outcome.history,
    }

    logger.info('reportGenerator.review_complete', {
      uuid: report.id,
      rounds: loopResult.outcome.rounds,
      verdict: loopResult.outcome.finalVerdict,
      confidence: loopResult.outcome.finalConfidence,
      concernCount: loopResult.outcome.finalConcerns.length,
      concernsPerRound: loopResult.outcome.history.map((h) => h.concerns.length),
      reviewerErrored: loopResult.outcome.history.some((h) => !!h.error),
      rewrote: originalDealDoctor !== null,
    })
  } else {
    result.reviewOutcome = null
  }

  return result
}

async function persistAsyncMarketAudit(
  uuid: string,
  fullReportData: Record<string, any>
): Promise<void> {
  const marketAudit = buildMarketAudit({
    checkedAt: new Date().toISOString(),
    valueConfidence: fullReportData.valueTriangulation?.confidence ?? null,
    valueSpread:
      typeof fullReportData.valueTriangulation?.spreadPct === 'number'
        ? fullReportData.valueTriangulation.spreadPct / 100
        : null,
    reportWarnings: Array.isArray(fullReportData.warnings) ? fullReportData.warnings : [],
    rentWarnings: Array.isArray(fullReportData.rentWarnings) ? fullReportData.rentWarnings : [],
    crossCheckLinks: fullReportData.crossCheckLinks ?? null,
  })

  await prisma.report.update({
    where: { id: uuid },
    data: {
      fullReportData: JSON.stringify({
        ...fullReportData,
        marketAudit,
      }),
    },
  })
}

/**
 * Orchestrator — reads the report row, fires all external fetches in
 * parallel, calls composeFullReport, and persists the result. This is the
 * function the payment webhook + debug-mode report endpoint call.
 */
export async function generateFullReport(uuid: string): Promise<void> {
  const report = await prisma.report.findUnique({ where: { id: uuid } })
  if (!report || !report.teaserData) return

  // rates and the property record are independent; fetch in parallel to shave
  // ~1-2s off the critical path before the first Rentcast fan-out.
  const [rates, property] = await Promise.all([
    getCurrentRates(),
    searchProperty(report.address, { includeListingPriceFallback: false }),
  ])
  if (!property) return
  const hydratedProperty = applyStoredListingPriceResolution(property, report.teaserData)

  // Normalize "Apartment" → "Condo" for buildings we know are condominiums.
  // Rentcast inconsistently labels unit records inside condo towers as
  // "Apartment" even when the units are individually deeded condos
  // (Jefferson House 922 24th St NW). The distinction matters: an investor
  // buying a unit owns a condo, not a rental apartment, and the label feeds
  // downstream comp narrowing + narrative tone.
  if (
    isKnownCondoBuilding(report.address) &&
    /apartment/i.test(hydratedProperty.property_type || '')
  ) {
    hydratedProperty.property_type = 'Condo'
  }

  const coords =
    typeof hydratedProperty.latitude === 'number' &&
    typeof hydratedProperty.longitude === 'number'
      ? { lat: hydratedProperty.latitude, lng: hydratedProperty.longitude }
      : null

  const offerPriceForTax = report.offerPrice ?? resolveListingPrice(hydratedProperty)

  // All six external fetches run in parallel. Climate/location only need the
  // coords + offerPriceForTax we already have from `property`, so there's no
  // reason to serialize them behind the Rentcast fan-out. Collapsing the two
  // Promise.allSettled blocks shaves the climate/location round-trip (~3-5s)
  // off the critical path.
  const [rentRes, salesRes, rentCompsRes, marketRes, climateRes, locationRes] = await Promise.allSettled([
    getRentEstimate(report.address, hydratedProperty.bedrooms),
    getComparableSales(report.city, report.state, hydratedProperty.bedrooms, coords, 1.0, {
      sqft: hydratedProperty.square_feet,
      value: hydratedProperty.estimated_value,
      propertyType: hydratedProperty.property_type,
      address: report.address,
    }),
    getRentComps(
      report.address,
      hydratedProperty.bedrooms,
      hydratedProperty.property_type,
      hydratedProperty.bathrooms
    ),
    getMarketSnapshot(report.zipCode),
    // Pass the already-known property coords so climate doesn't re-geocode
    // the same address (saves a Mapbox call AND keeps property/climate/
    // locationSignals aligned on identical lat/lng — prior behavior produced
    // ~15m drift between property and climate coordinates).
    getClimateAndInsurance(
      report.address,
      report.state,
      report.zipCode,
      offerPriceForTax,
      coords,
      hydratedProperty.year_built
    ),
    coords ? getLocationSignals(coords.lat, coords.lng) : Promise.resolve(null),
  ])

  for (const [name, result] of [
    ['rentEstimate', rentRes],
    ['saleComps', salesRes],
    ['rentComps', rentCompsRes],
    ['marketSnapshot', marketRes],
    ['climate', climateRes],
    ['locationSignals', locationRes],
  ] as const) {
    if (result.status === 'rejected') {
      console.warn(`[reportGenerator] ${name} failed:`, result.reason?.message ?? result.reason)
    }
  }

  let fullReportData
  try {
    fullReportData = await composeFullReport(report, {
      property: hydratedProperty,
      rates,
      rentEstimate: rentRes,
      saleComps: salesRes,
      rentComps: rentCompsRes,
      marketSnapshot: marketRes,
      climate: climateRes,
      locationSignals: locationRes,
    })
  } catch (err: any) {
    if (err instanceof InvariantGateError) {
      await prisma.report.update({
        where: { id: uuid },
        data: {
          fullReportData: JSON.stringify({
            __error: 'invariant-blocked',
            reason: 'This report failed an internal math sanity check.',
            at: new Date().toISOString(),
            failures: err.failures ?? [],
          }),
        },
      })
    }
    if (err?.name === 'QualityAuditError' && err?.audit) {
      await prisma.report.update({
        where: { id: uuid },
        data: {
          fullReportData: JSON.stringify({
            __error: 'quality-blocked',
            reason: err.audit.summary,
            at: new Date().toISOString(),
            audit: err.audit,
          }),
        },
      })
    }
    // Cache the reviewer's block verdict on the row itself. Without this,
    // the polling frontend kept re-running the full 30-60s pipeline on every
    // refresh (audit: 414 Water St, Baltimore — 6× re-runs at 30-60s each).
    // With the sentinel persisted to fullReportData, the route short-circuits
    // on subsequent reads and returns the cached reason immediately.
    throw err
  }

  await prisma.report.update({
    where: { id: uuid },
    data: { fullReportData: JSON.stringify(fullReportData) },
  })

  void persistAsyncMarketAudit(uuid, fullReportData).catch((err) => {
    logger.warn('reportGenerator.market_audit_failed', {
      uuid,
      address: report.address,
      error: err,
    })
  })
}
