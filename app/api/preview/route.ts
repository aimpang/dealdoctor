import { NextRequest, NextResponse } from 'next/server'
import {
  searchProperty,
  getRentEstimate,
  getRentComps,
  RentcastQuotaError,
  classifyAddressMatch,
  isUnitLikeAddress,
} from '@/lib/propertyApi'
import { getCurrentRates, applyInvestorPremium } from '@/lib/rates'
import { getStateFromZipCode, calculateBreakEvenPrice, STATE_RULES } from '@/lib/calculations'
import {
  applyStudentHousingHeuristic,
  collegeTownForZip,
  crossCheckRentAgainstComps,
} from '@/lib/studentHousing'
import { lookupBuildingHoa } from '@/lib/buildingHoa'
import { prisma } from '@/lib/db'
import { randomUUID } from 'crypto'
import { rateLimit } from '@/lib/rateLimit'
import { getClientIp } from '@/lib/clientIp'
import { logger } from '@/lib/logger'
import {
  getCurrentCustomer,
  hasActiveEntitlement,
  enforceEntitlementExpiry,
  debitForNewReport,
} from '@/lib/entitlements'
import { generateFullReport } from '@/lib/reportGenerator'

export async function POST(req: NextRequest) {
  // Rate limit: 3 previews per IP per day. IP resolution uses
  // platform-trusted headers — trusting the raw X-Forwarded-For chain would
  // let any caller rotate a spoofed value per request to create fresh
  // buckets and drain Rentcast / Anthropic budget.
  const ip = getClientIp(req)
  const limited = await rateLimit(ip, 15, { bucket: 'preview' })
  if (limited) {
    return NextResponse.json({ error: 'Too many requests. Try again tomorrow.' }, { status: 429 })
  }

  const { address, confirmedResolvedAddress } = await req.json()
  if (!address || address.length < 10) {
    return NextResponse.json({ error: 'Please enter a full address' }, { status: 400 })
  }

  // Check if this looks like a Canadian address (postal code pattern like A1A 1A1)
  const isCanadian = /[A-Za-z]\d[A-Za-z]\s*\d[A-Za-z]\d/.test(address)
  if (isCanadian) {
    return NextResponse.json({
      error: 'Canadian addresses coming soon. Currently serving US properties only.',
      comingSoon: true
    }, { status: 400 })
  }

  try {
    // Fetch property data
    const [property, rates] = await Promise.all([
      searchProperty(address),
      getCurrentRates()
    ])

    if (!property) {
      return NextResponse.json({
        error: 'Property not found. Please check the address and try again.',
        notFound: true
      }, { status: 404 })
    }

    // Silent-address-substitution guard. Rentcast sometimes returns a nearby
    // but DIFFERENT property — "408 S 8th St" → "408 N 8th St" is a real
    // example. If Rentcast's resolved address diverges materially from what
    // the user typed, block once and ask them to confirm.
    //
    // Any non-empty `confirmedResolvedAddress` is treated as "user already saw
    // the mismatch and clicked Yes — proceed, don't re-prompt." We deliberately
    // don't require strict equality because Rentcast sometimes re-resolves the
    // confirmed address to YET ANOTHER record (Saginaw case: confirming
    // "408 N 8th St" returned "408 New St, Clio, MI"). Strict equality would
    // trap the user in a re-prompt loop. Users still see the actual resolved
    // address in the teaser property card + map pin.
    const userSaidProceed =
      typeof confirmedResolvedAddress === 'string' &&
      confirmedResolvedAddress.trim().length > 0
    if (!userSaidProceed) {
      const match = classifyAddressMatch(address, property.address)
      if (match.kind === 'hard-mismatch') {
        return NextResponse.json(
          {
            error: 'Address mismatch',
            addressMismatch: true,
            userAddress: address,
            resolvedAddress: property.address,
            mismatches: match.mismatches,
            message: `We couldn't find "${address}" in our data source. The closest record we have is "${property.address}". Did you mean that address?`,
          },
          { status: 409 }
        )
      }
    }

    // Multi-unit input gate. If the user typed a bare street address but the
    // property is a condo / apartment building OR Rentcast returned a
    // resolved address that contains a unit marker we didn't supply, we're
    // analyzing an arbitrary unit picked by the data source — the 54 Rainey
    // St / 1847 N California class of failure. Force the user to add a unit
    // number so the subsequent lookup pins to one specific floor plan.
    const userAddressHasUnit = isUnitLikeAddress(address)
    if (!userAddressHasUnit) {
      const looksMultiUnit =
        /^(condo|apartment)$/i.test((property.property_type || '').trim()) ||
        isUnitLikeAddress(property.address)
      if (looksMultiUnit) {
        return NextResponse.json(
          {
            error: 'Unit number required',
            needsUnitNumber: true,
            userAddress: address,
            resolvedAddress: property.address,
            propertyType: property.property_type,
            message: `"${address}" looks like a multi-unit building. Please include the unit number (e.g., "${address} Unit 804") so we analyze the right floor plan — otherwise our data source returns an arbitrary unit, which cascades into wrong square footage, HOA, and rent numbers.`,
          },
          { status: 409 }
        )
      }
    }

    const rentEstimate = await getRentEstimate(address, property.bedrooms)
    const state = property.state || getStateFromZipCode(property.zip_code)
    const rawRentAvm = rentEstimate?.estimated_rent || Math.round(property.estimated_value * 0.005)

    // Student-housing heuristic: if this looks like a per-bedroom AVM, multiply
    // by bedroom count to get whole-property rent for all math. Applied BEFORE
    // breakeven / warnings so the downstream numbers use the corrected rent.
    let rentAdjustment = applyStudentHousingHeuristic({
      rentAvm: rawRentAvm,
      propertyValue: property.estimated_value,
      bedrooms: property.bedrooms,
      subdivision: property.subdivision,
      zipCode: property.zip_code,
    })

    // When the heuristic multiplied, cross-check against actual rent comps —
    // otherwise the teaser shows a number the paid report will later revert
    // (Blacksburg: teaser $5,100 / report $1,700). Only fetch rent comps when
    // we actually multiplied to keep the normal preview path single-API-call.
    let rentMultiplierRevertedDueToComps = false
    if (rentAdjustment.isMultiplied) {
      const rentComps = await getRentComps(
        address,
        property.bedrooms,
        property.property_type
      ).catch(() => [])
      const check = crossCheckRentAgainstComps({
        adjustment: rentAdjustment,
        rawRentAvm,
        rentCompRents: (rentComps || [])
          .map((c: any) => Number(c?.rent))
          .filter((v: number) => Number.isFinite(v) && v > 0),
      })
      rentAdjustment = check.adjustment
      rentMultiplierRevertedDueToComps = check.revertedDueToComps
    }

    const estimatedRent = rentAdjustment.effectiveRent

    // Data-quality warnings — shown in the teaser so buyers don't pay for a
    // report based on bad data. The two common failure modes:
    //   (a) value comes from tax assessment or grown sale price (less precise
    //       than live AVM — e.g. remote markets where Rentcast has thin data)
    //   (b) rent / value ratio is implausibly low: typical US rentals clear
    //       4-12% gross annual yield. <4% usually means the rent AVM picked
    //       up per-room student-rental comps, or the property is in a
    //       distressed market. Either way, verify before trusting.
    const annualYield = (estimatedRent * 12) / property.estimated_value
    const warnings: Array<{ code: string; message: string }> = []

    // If the user bypassed a mismatch prompt AND Rentcast's actual resolved
    // address still differs from what they confirmed, surface it prominently
    // in the teaser so they don't underwrite a property they never agreed to.
    if (
      userSaidProceed &&
      typeof confirmedResolvedAddress === 'string' &&
      confirmedResolvedAddress.trim().toLowerCase() !== property.address.trim().toLowerCase()
    ) {
      const postBypassMatch = classifyAddressMatch(confirmedResolvedAddress, property.address)
      if (postBypassMatch.kind === 'hard-mismatch') {
        warnings.push({
          code: 'address-substitution',
          message: `You confirmed "${confirmedResolvedAddress}", but our data source actually returned "${property.address}" — a different property. Every number below is for "${property.address}". If that's not what you meant, retype the address.`,
        })
      }
    }
    if (property.value_source === 'tax-assessment') {
      warnings.push({
        code: 'value-from-tax',
        message:
          "Value derived from county tax assessment × 1.15 (no live AVM available). Less precise than a market estimate — verify with a local agent.",
      })
    } else if (property.value_source === 'last-sale-grown') {
      warnings.push({
        code: 'value-from-sale',
        message:
          "Value derived from the last sale price grown at 3%/yr (no live AVM or recent assessment). Treat as a rough anchor only.",
      })
    }
    // If we auto-multiplied rent (student housing), emit an INFO note instead
    // of the "rent-suspect" warning — the heuristic is the correction.
    if (rentAdjustment.isMultiplied) {
      warnings.push({
        code: 'rent-multiplied',
        message: `Rent AVM ($${rentAdjustment.perBedroomRent?.toLocaleString()}/bed) looked like a per-bedroom rate${rentAdjustment.reason === 'subdivision-match' ? ` (property is in a known student-rental complex)` : ' (implausibly low yield suggested it)'}. Math below uses $${rentAdjustment.effectiveRent.toLocaleString()}/mo total (${rentAdjustment.bedroomsUsed} beds × per-bedroom rate). Verify against actual signed leases.`,
      })
    } else if (rentMultiplierRevertedDueToComps) {
      // Heuristic tried to multiply but actual rent comps suggested the AVM
      // was already a whole-unit figure — we reverted. Surface this at teaser
      // time so the user sees the same rent / breakeven the paid report
      // will show (no Blacksburg-style teaser/report mismatch).
      warnings.push({
        code: 'rent-multiplier-reverted',
        message: `The student-rental multiplier would have pushed rent above 2× the highest nearby rent comp, so we kept the raw AVM ($${Math.round(rawRentAvm).toLocaleString()}/mo). The AVM appears to already be a whole-unit figure. Verify with a local property manager before relying on this number.`,
      })
    } else if (annualYield < 0.04) {
      const college = collegeTownForZip(property.zip_code)
      warnings.push({
        code: 'rent-suspect',
        message: college
          ? `This property is in a known college-town ZIP (${college}). The rent estimate is likely a per-bedroom figure — if this is a student rental, true whole-unit rent may be 3–4× higher. Verify with a local property manager before trusting any cash flow numbers.`
          : "Rent estimate is unusually low vs property value — may be a per-room / student-rental figure or stale data. Verify with a local property manager.",
      })
    } else if (annualYield > 0.18) {
      warnings.push({
        code: 'rent-high',
        message:
          'Rent estimate is unusually high vs value — verify with local comps before relying on it.',
      })
    }
    if (
      property.zoning &&
      /MULTI|APT|APARTMENT/i.test(property.zoning) &&
      property.property_type !== 'Single Family'
    ) {
      warnings.push({
        code: 'multi-unit-zoning',
        message:
          "Zoning indicates multi-unit residential. Whole-property economics may differ from per-unit comps Rentcast picks up.",
      })
    }

    // Duplex / triplex / quadruplex / multi-family: Rentcast often returns
    // one side's bedroom/bathroom counts but whole-property value. The math
    // misaligns. We can't split the data programmatically — but we can tell
    // the buyer to verify unit configuration against the listing.
    if (/duplex|triplex|quadruplex|multi[\s-]?family/i.test(property.property_type || '')) {
      warnings.push({
        code: 'multi-unit-property',
        message: `Property type is "${property.property_type}". Rentcast often returns one unit's bed/bath count combined with whole-property value, producing an inconsistent picture. Verify the listing's unit configuration and split the rent/value between units before relying on these numbers.`,
      })
    }

    // Wide AVM confidence range: Rentcast's /avm/value returns price_low
    // and price_high. When the range spans more than 30% of the midpoint,
    // the AVM itself is uncertain. Grok caught this on 216 W Escalones
    // where the range was $1.97M-$3.25M (49% spread) but we showed $2.61M
    // as if it were precise.
    if (
      property.value_range_low &&
      property.value_range_high &&
      property.estimated_value > 0
    ) {
      const rangeSpread =
        (property.value_range_high - property.value_range_low) / property.estimated_value
      if (rangeSpread > 0.30) {
        const n = property.avm_comparables_count
        // Include comp count when available so users can tell a 4-comp
        // wide-band apart from a 20-comp one. Also flag low coverage (<5).
        const compNote = typeof n === 'number'
          ? n < 5
            ? ` Based on only ${n} comparable${n === 1 ? '' : 's'} — low comp coverage.`
            : ` Based on ${n} comparables.`
          : ''
        warnings.push({
          code: 'avm-wide-range',
          message: `Value AVM has a wide confidence band ($${property.value_range_low.toLocaleString()}-$${property.value_range_high.toLocaleString()}, ±${Math.round((rangeSpread / 2) * 100)}%).${compNote} The midpoint is uncertain; cross-check against Zillow / Redfin / a local agent before trusting.`,
        })
      }
    }

    // Known-bad subdivision / student-housing patterns. Small curated list —
    // add more as we find cases. AVMs for these almost always pull per-bedroom
    // rents, so flagging pre-paywall is important.
    const KNOWN_STUDENT_COMPLEXES = [
      'HUNTERS RIDGE',
      'ASHBY CROSSING',
      'SUNCHASE',
      'COPPER BEECH',
      'UNIVERSITY',
      'CAMPUS',
    ]
    const subdivisionUpper = (property.subdivision || '').toUpperCase()
    if (KNOWN_STUDENT_COMPLEXES.some((p) => subdivisionUpper.includes(p))) {
      warnings.push({
        code: 'student-housing',
        message: `Property is in "${property.subdivision}" — a known student-rental complex. Rent AVMs usually return per-bedroom rates here; whole-property rent is typically 3-5× the reported figure. Verify with a local property manager before trusting any cash-flow numbers.`,
      })
    }

    // Breakeven hook uses the investor rate (PMMS + LTR premium). DealDoctor's
    // audience is investors, so the pre-paywall walk-away number must reflect
    // what they'll actually pay to finance the deal — not an owner-occupied rate.
    const investorRate = applyInvestorPremium(rates.mortgage30yr, 'LTR')
    // Match the full-report expense stack so the teaser and full-report
    // breakeven numbers agree. Previously the teaser used the solver's
    // defaults (1% tax, $125 ins, $0 HOA, $150 maint) while the full
    // report passed the real state tax rate + captured HOA + actual
    // climate-derived insurance — producing two different breakeven
    // numbers on the same address (DC studio audit: $275k card vs $287k
    // full). We can't fetch climate pre-paywall, but state tax rate and
    // the condo-HOA default are derivable here.
    const stateRulesForBE = STATE_RULES[state] || STATE_RULES['TX']
    const previewPropertyTypeLower = (property.property_type || '').toLowerCase()
    const previewIsCondoLike = /condo|apartment|co-?op|coop/.test(previewPropertyTypeLower)
    const previewCapturedHOA = property.hoa_fee_monthly ?? 0
    // Building-level HOA override — mirrors the full-report path so the
    // teaser breakeven + the full-report breakeven agree. Jefferson House
    // (DC) audit: sqft formula said $499, real building average is $717.
    const previewBuildingHoa =
      previewCapturedHOA === 0 && previewIsCondoLike
        ? lookupBuildingHoa(property.address)
        : null
    const previewInferredCondoHOA =
      previewCapturedHOA === 0 && previewIsCondoLike
        ? Math.min(1500, Math.max(300, Math.round((property.square_feet || 500) * 1.0)))
        : 0
    const previewMonthlyHOA =
      previewCapturedHOA > 0
        ? previewCapturedHOA
        : previewBuildingHoa
          ? previewBuildingHoa.monthlyHoa
          : previewInferredCondoHOA
    const previewMonthlyMaintenance = Math.max(
      150,
      property.square_feet ? Math.round(property.square_feet * 0.04) : 150
    )
    const breakevenPrice = calculateBreakEvenPrice(estimatedRent, investorRate, {
      propertyTaxRate: stateRulesForBE.propertyTaxRate,
      monthlyHOA: previewMonthlyHOA,
      monthlyMaintenance: previewMonthlyMaintenance,
      offerPrice: property.estimated_value,
    })
    const listingVsBreakeven = breakevenPrice - property.estimated_value

    // Generate UUID and store in DB
    const uuid = randomUUID()
    const teaserData = {
      estimatedValue: property.estimated_value,
      estimatedRent,
      breakevenPrice,
      listingVsBreakeven, // positive = listing below breakeven (good); negative = above (bad)
      city: property.city,
      state,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      sqft: property.square_feet,
      yearBuilt: property.year_built,
      currentRate: investorRate, // display the rate our math actually used
      pmmsRate: rates.mortgage30yr, // reference: owner-occupied PMMS
      valueSource: property.value_source,
      valueRangeLow: property.value_range_low,
      valueRangeHigh: property.value_range_high,
      rentRangeLow: rentEstimate?.rent_low,
      rentRangeHigh: rentEstimate?.rent_high,
      // Student-housing heuristic metadata — UI shows both figures so users
      // can see the transformation and judge whether to trust it.
      perBedroomRent: rentAdjustment.perBedroomRent,
      rentMultiplied: rentAdjustment.isMultiplied,
      rentMultipliedBy: rentAdjustment.bedroomsUsed,
      rentMultiplierReason: rentAdjustment.reason,
      warnings, // data-quality flags — shown BEFORE paywall
    }

    // If the user has an active customer cookie with remaining quota, auto-pay
    // this new report. Solves the "I bought a 5-pack; why am I hitting the paywall
    // on my second search?" bug. Fires the full-report generator in the background.
    let customer = await getCurrentCustomer()
    // Lazy sweep: if the customer's unlimited subscription expired and the
    // `subscription_expired` webhook never arrived, zero it out now.
    if (customer) customer = await enforceEntitlementExpiry(customer)
    const entitlement = customer ? hasActiveEntitlement(customer) : { active: false }

    // Double-click dedup: if the same address was submitted (by anyone) in
    // the last 30 seconds and is still unpaid + waiting for checkout, return
    // that existing report instead of creating a duplicate. This protects
    // against a user mashing the button and ending up with 2+ report rows
    // in the DB for the same address.
    const recentMatch = await prisma.report.findFirst({
      where: {
        address: property.address,
        zipCode: property.zip_code,
        paid: false,
        createdAt: { gt: new Date(Date.now() - 30_000) },
        // If the current request has a logged-in customer, only dedup
        // against rows that customer already created — don't let user A
        // steal user B's just-created row.
        ...(customer ? { customerId: customer.id } : { customerId: null }),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    const reusedExisting = !!recentMatch
    const finalUuid = recentMatch?.id ?? uuid

    // Debit BEFORE marking the report paid. A concurrent pair of previews on
    // a 5-pack customer's last credit used to race: both reads saw
    // reportsRemaining=1, both created paid reports, and only one debit
    // succeeded — user got 2 reports for 1 credit. debitForNewReport now
    // uses an atomic conditional update; paid status follows the debit.
    let debitResult: { debited: boolean; newRemaining?: number } = { debited: false }
    if (!reusedExisting && customer && entitlement.active) {
      debitResult = await debitForNewReport(customer)
    }
    const effectivelyPaid = debitResult.debited

    if (!reusedExisting) {
      await prisma.report.create({
        data: {
          id: uuid,
          address: property.address,
          city: property.city,
          state,
          zipCode: property.zip_code,
          teaserData: JSON.stringify(teaserData),
          ...(effectivelyPaid && customer
            ? {
                paid: true,
                customerId: customer.id,
                customerEmail: customer.email,
                paidAt: new Date(),
              }
            : {}),
        },
      })
    }

    let autopaid: null | {
      entitlement: 'unlimited' | '5pack'
      remaining?: number
      until?: string
    } = null

    if (effectivelyPaid && customer && !reusedExisting) {
      autopaid = {
        entitlement: entitlement.type!,
        remaining: debitResult.newRemaining,
        until: entitlement.until?.toISOString(),
      }
      // Generate full report async — don't block preview response
      generateFullReport(finalUuid).catch((err) =>
        console.error('[preview] auto-pay report generation failed for', finalUuid, err)
      )
    }

    return NextResponse.json({
      uuid: finalUuid,
      deduped: reusedExisting,
      teaser: teaserData,
      property: {
        address: property.address,
        city: property.city,
        state,
        type: property.property_type,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
      },
      autopaid, // null when no entitlement; present when auto-unlocked
    })
  } catch (err: any) {
    // Distinguish data-provider quota / rate-limit from other failures so we
    // don't silently 500 when Rentcast is just over budget.
    if (err instanceof RentcastQuotaError) {
      console.error('[preview] Rentcast quota/auth failure', err.status)
      return NextResponse.json(
        {
          error:
            "Our property data provider is temporarily over quota. Try again in a few minutes, or contact support if this persists.",
          code: 'data-provider-quota',
          ...(process.env.NODE_ENV !== 'production' ? { debug: `Rentcast ${err.status}` } : {}),
        },
        { status: 503 }
      )
    }
    logger.error('preview.failed', { error: err })
    return NextResponse.json({
      error: 'Something went wrong. Please try again.',
      ...(process.env.NODE_ENV !== 'production' ? { debug: err?.message } : {}),
    }, { status: 500 })
  }
}
