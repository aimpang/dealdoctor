import { NextRequest, NextResponse } from 'next/server'
import { lemonSqueezySetup, createCheckout } from '@lemonsqueezy/lemonsqueezy.js'
import { prisma } from '@/lib/db'

lemonSqueezySetup({
  apiKey: process.env.LEMONSQUEEZY_API_KEY!,
  onError: (error) => console.error('LemonSqueezy error:', error),
})

export async function POST(req: NextRequest) {
  const { uuid } = await req.json()

  if (!uuid) return NextResponse.json({ error: 'Missing report ID' }, { status: 400 })

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
    Number(process.env.LEMONSQUEEZY_VARIANT_ID!),
    {
      checkoutData: {
        custom: {
          uuid: uuid,
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
