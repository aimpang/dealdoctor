import { NextRequest, NextResponse } from 'next/server'
import { lemonSqueezySetup, createCheckout } from '@lemonsqueezy/lemonsqueezy.js'
import { prisma } from '@/lib/db'

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
      url: `${process.env.NEXT_PUBLIC_BASE_URL}/report/${uuid}`
    })
  }

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
        redirectUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/report/${uuid}?success=true`,
        receiptButtonText: 'View Your Report',
        receiptThankYouNote: 'Your DealDoctor report is being generated now.',
      },
    }
  )

  const checkoutUrl = checkout.data?.data.attributes.url

  if (!checkoutUrl) {
    return NextResponse.json({ error: 'Failed to create checkout' }, { status: 500 })
  }

  return NextResponse.json({ url: checkoutUrl })
}
