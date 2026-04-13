import { NextRequest, NextResponse } from 'next/server'
import { searchProperty, getRentEstimate } from '@/lib/propertyApi'
import { getCurrentRates, applyInvestorPremium } from '@/lib/rates'
import { getStateFromZipCode, calculateBreakEvenPrice } from '@/lib/calculations'
import { prisma } from '@/lib/db'
import { randomUUID } from 'crypto'
import { rateLimit } from '@/lib/rateLimit'
import {
  getCurrentCustomer,
  hasActiveEntitlement,
  debitForNewReport,
} from '@/lib/entitlements'
import { generateFullReport } from '@/lib/reportGenerator'

export async function POST(req: NextRequest) {
  // Rate limit: 3 previews per IP per day
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  const limited = await rateLimit(ip)
  if (limited) {
    return NextResponse.json({ error: 'Too many requests. Try again tomorrow.' }, { status: 429 })
  }

  const { address } = await req.json()
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

    const rentEstimate = await getRentEstimate(address, property.bedrooms)
    const state = property.state || getStateFromZipCode(property.zip_code)
    const estimatedRent = rentEstimate?.estimated_rent || Math.round(property.estimated_value * 0.005)

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
    if (annualYield < 0.04) {
      warnings.push({
        code: 'rent-suspect',
        message:
          "Rent estimate is unusually low vs property value — may be a per-room / student-rental figure or stale data. Verify with a local property manager.",
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
    const breakevenPrice = calculateBreakEvenPrice(estimatedRent, investorRate)
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
      warnings, // data-quality flags — shown BEFORE paywall
    }

    // If the user has an active customer cookie with remaining quota, auto-pay
    // this new report. Solves the "I bought a 5-pack; why am I hitting the paywall
    // on my second search?" bug. Fires the full-report generator in the background.
    const customer = await getCurrentCustomer()
    const entitlement = customer ? hasActiveEntitlement(customer) : { active: false }

    await prisma.report.create({
      data: {
        id: uuid,
        address: property.address,
        city: property.city,
        state,
        zipCode: property.zip_code,
        teaserData: JSON.stringify(teaserData),
        ...(entitlement.active && customer
          ? {
              paid: true,
              customerId: customer.id,
              customerEmail: customer.email,
              paidAt: new Date(),
            }
          : {}),
      },
    })

    let autopaid: null | {
      entitlement: 'unlimited' | '5pack'
      remaining?: number
      until?: string
    } = null

    if (entitlement.active && customer) {
      const debit = await debitForNewReport(customer)
      autopaid = {
        entitlement: entitlement.type!,
        remaining: debit.newRemaining,
        until: entitlement.until?.toISOString(),
      }
      // Generate full report async — don't block preview response
      generateFullReport(uuid).catch((err) =>
        console.error('[preview] auto-pay report generation failed for', uuid, err)
      )
    }

    return NextResponse.json({
      uuid,
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
    console.error('Preview error:', err)
    return NextResponse.json({
      error: 'Something went wrong. Please try again.',
      debug: err?.message
    }, { status: 500 })
  }
}
