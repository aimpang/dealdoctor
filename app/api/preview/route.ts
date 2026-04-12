import { NextRequest, NextResponse } from 'next/server'
import { searchProperty, getRentEstimate } from '@/lib/propertyApi'
import { getCurrentRates, applyInvestorPremium } from '@/lib/rates'
import { getStateFromZipCode, calculateBreakEvenPrice } from '@/lib/calculations'
import { prisma } from '@/lib/db'
import { randomUUID } from 'crypto'
import { rateLimit } from '@/lib/rateLimit'

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
    }

    await prisma.report.create({
      data: {
        id: uuid,
        address: property.address,
        city: property.city,
        state,
        zipCode: property.zip_code,
        teaserData: JSON.stringify(teaserData)
      }
    })

    return NextResponse.json({
      uuid,
      teaser: teaserData,
      property: {
        address: property.address,
        city: property.city,
        state,
        type: property.property_type,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms
      }
    })
  } catch (err: any) {
    console.error('Preview error:', err)
    return NextResponse.json({
      error: 'Something went wrong. Please try again.',
      debug: err?.message
    }, { status: 500 })
  }
}
