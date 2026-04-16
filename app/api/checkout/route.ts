import { NextRequest, NextResponse } from 'next/server'
import { lemonSqueezySetup, createCheckout } from '@lemonsqueezy/lemonsqueezy.js'
import { prisma } from '@/lib/db'
import { absoluteUrl } from '@/lib/seo'
import {
  hasResolvedListingPrice,
  isManualListingPriceConfirmationStale,
  parseListingPriceResolution,
} from '@/lib/listing-price-resolution'

lemonSqueezySetup({
  apiKey: process.env.LEMONSQUEEZY_API_KEY!,
  onError: (error) => console.error('LemonSqueezy error:', error),
})

const VARIANT_MAP: Record<string, string | undefined> = {
  single: process.env.LEMONSQUEEZY_VARIANT_SINGLE,
  '5pack': process.env.LEMONSQUEEZY_VARIANT_5PACK,
  unlimited: process.env.LEMONSQUEEZY_VARIANT_UNLIMITED,
}

export async function POST(req: NextRequest) {
  const { uuid, plan } = await req.json()

  if (!uuid) return NextResponse.json({ error: 'Missing report ID' }, { status: 400 })

  const variantId = VARIANT_MAP[plan || 'single']
  if (!variantId) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

  // Check report exists and isn't already paid
  const report = await prisma.report.findUnique({ where: { id: uuid } })
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  if (report.paid) {
    return NextResponse.json({
      alreadyPaid: true,
      url: absoluteUrl(`/report/${uuid}`)
    })
  }

  const listingPriceResolution = parseListingPriceResolution(report.teaserData)
  if (!hasResolvedListingPrice(listingPriceResolution)) {
    return NextResponse.json(
      {
        error:
          "We couldn't verify the current listing price for this property, so checkout is blocked until the ask price is resolved.",
        code: 'listing-price-unresolved',
        retryable: true,
        supportContact: 'support@dealdoctor.app',
      },
      { status: 409 }
    )
  }

  if (isManualListingPriceConfirmationStale(listingPriceResolution)) {
    return NextResponse.json(
      {
        error:
          'The confirmed ask price is stale. Refresh the address and reconfirm the current listing price before checkout.',
        code: 'listing-price-stale',
        retryable: true,
        supportContact: 'support@dealdoctor.app',
      },
      { status: 409 }
    )
  }

  // Wrap the LemonSqueezy SDK call. A network blip or LS 5xx used to surface
  // as a raw 500 with no context — now we return a structured error the UI
  // can render a retry CTA against (see BlurredReport / retry button).
  try {
    const checkout = await createCheckout(
      process.env.LEMONSQUEEZY_STORE_ID!,
      Number(variantId),
      {
        checkoutData: {
          custom: {
            uuid: uuid,
            plan: plan || 'single',
          },
        },
        productOptions: {
          redirectUrl: absoluteUrl(`/report/${uuid}?success=true`),
          receiptButtonText: 'View Your Report',
          receiptThankYouNote: 'Your DealDoctor report is being generated now.',
        },
      }
    )

    const checkoutUrl = checkout.data?.data.attributes.url

    if (!checkoutUrl) {
      return NextResponse.json(
        {
          error: 'Checkout provider did not return a URL',
          code: 'checkout_no_url',
          retryable: true,
          supportContact: 'support@dealdoctor.app',
        },
        { status: 502 }
      )
    }

    return NextResponse.json({ url: checkoutUrl })
  } catch (err: any) {
    console.error('[checkout] LemonSqueezy call failed:', err?.message)
    return NextResponse.json(
      {
        error: 'We couldn\'t reach our payment processor. Try again in a moment, or contact support if this keeps happening.',
        code: 'checkout_unreachable',
        retryable: true,
        supportContact: 'support@dealdoctor.app',
        detail: process.env.NODE_ENV !== 'production' ? String(err?.message ?? err) : undefined,
      },
      { status: 502 }
    )
  }
}
