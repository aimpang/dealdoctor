import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { CUSTOMER_COOKIE } from '@/lib/entitlements'
import { logger } from '@/lib/logger'

// Post-payment photo analysis. Users can drop 1-5 listing photos and Gemini Vision
// flags observable condition concerns. We never claim this replaces a licensed
// inspection — the UI surfaces that disclaimer alongside the findings.
const MAX_IMAGES = 5
const MAX_BYTES = 10 * 1024 * 1024 // 10MB per image

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { uuid, images } = body as {
      uuid: string
      images: Array<{ mimeType: string; data: string }>
    }

    if (!uuid) {
      return NextResponse.json({ error: 'Missing report id' }, { status: 400 })
    }
    if (!Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: 'At least one image is required' }, { status: 400 })
    }
    if (images.length > MAX_IMAGES) {
      return NextResponse.json({ error: `Max ${MAX_IMAGES} images per analysis` }, { status: 400 })
    }

    // Auth-first: resolve owner from cookie BEFORE report lookup so an
    // unauthenticated caller can't distinguish "UUID exists" from "UUID
    // unknown" and can't burn Anthropic vision quota by pointing at a
    // leaked paid UUID. Share-token recipients are read-only — only the
    // buyer themselves can mutate photoFindings.
    const cookieToken = req.cookies.get(CUSTOMER_COOKIE)?.value
    const cookieCustomer = cookieToken
      ? await prisma.customer.findUnique({
          where: { accessToken: cookieToken },
          select: { id: true },
        })
      : null

    const report = await prisma.report.findUnique({ where: { id: uuid } })
    const isOwner = !!(
      cookieCustomer && report?.customerId && cookieCustomer.id === report.customerId
    )
    if (!isOwner || !report) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!report.paid) {
      return NextResponse.json({ error: 'Photo analysis is a paid-report feature' }, { status: 402 })
    }

    // Cap photo-analysis cost per report: 20/hour. Photos call Gemini Vision
    // on every image; a paid customer running a loop could rack up real
    // bills on a single $24.99 entitlement. 20/hr is comfortably above any
    // legitimate use.
    if (await rateLimit(uuid, 20, { bucket: 'photos', windowMs: 60 * 60 * 1000 })) {
      return NextResponse.json(
        { error: 'Too many photo analyses for this report. Try again in an hour.' },
        { status: 429 }
      )
    }

    // Validate each image
    for (let i = 0; i < images.length; i++) {
      const img = images[i]
      if (!img || typeof img.data !== 'string' || !img.mimeType) {
        return NextResponse.json({ error: `Image ${i + 1} is malformed` }, { status: 400 })
      }
      if (!ALLOWED_MIME.has(img.mimeType)) {
        return NextResponse.json(
          { error: `Image ${i + 1}: only JPEG, PNG, WebP accepted` },
          { status: 400 }
        )
      }
      // base64 expands ~33% — cap the raw base64 string accordingly
      const approxBytes = Math.ceil((img.data.length * 3) / 4)
      if (approxBytes > MAX_BYTES) {
        return NextResponse.json(
          { error: `Image ${i + 1}: exceeds 10MB limit` },
          { status: 400 }
        )
      }
    }

    // Structured Gemini prompt — model returns JSON only, no prose.
    const prompt = `You are a home-inspection assistant reviewing real-estate listing photos.
For each photo (indexed 0, 1, 2, ... in the order received), list any OBSERVABLE condition concerns.

Only flag what is directly visible in the photo. NEVER speculate about:
- things behind walls (plumbing, electrical, framing)
- age or remaining life of unseen systems
- soil, foundation below grade, termites
- anything requiring measurement or testing

Categories to consider: foundation/structural, roof, exterior, interior, plumbing-visible, electrical-visible, hvac-visible, water-damage, safety, cosmetic.

For each finding return:
- severity: "low" (cosmetic/deferred maintenance), "medium" (functional concern, budget for it), or "high" (safety or major system, investigate before closing)
- category: one of the categories above
- observation: ONE specific sentence referencing what you see (e.g. "Missing shingles on the front slope, roughly 4-6 units.")

If a photo shows no visible concerns, return an empty findings array for that photo.

Return STRICT JSON with no markdown fences, no prose outside the JSON:
{
  "photos": [
    { "index": 0, "findings": [ { "severity": "medium", "category": "roof", "observation": "..." } ] }
  ]
}`

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'AI not configured' }, { status: 500 })
    }

    const anthropic = new Anthropic({ apiKey })

    // Build Claude multimodal message: text prompt + N image blocks.
    const content: Anthropic.ContentBlockParam[] = [
      { type: 'text', text: prompt + '\n\nIMPORTANT: Return only valid JSON. No markdown fences, no preamble, no explanation.' },
      ...images.map((img): Anthropic.ImageBlockParam => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
          data: img.data,
        },
      })),
    ]

    const result = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content }],
    })
    const text = result.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()

    // Claude doesn't have a strict JSON mode — strip any accidental fence and parse.
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '')

    let parsed: { photos: Array<{ index: number; findings: any[] }> }
    try {
      parsed = JSON.parse(stripped)
    } catch {
      return NextResponse.json(
        { error: 'AI returned unparseable output' },
        { status: 502 }
      )
    }

    if (!parsed || !Array.isArray(parsed.photos)) {
      return NextResponse.json({ error: 'AI returned unexpected shape' }, { status: 502 })
    }

    // Persist — cast until `prisma generate` picks up the new fields
    await prisma.report.update({
      where: { id: uuid },
      data: {
        photoFindings: JSON.stringify(parsed),
        photosAnalyzedAt: new Date(),
      } as any,
    })

    return NextResponse.json(parsed)
  } catch (err: any) {
    logger.error('photos.analyze_failed', { error: err })
    return NextResponse.json(
      {
        error: 'Something went wrong',
        ...(process.env.NODE_ENV !== 'production' ? { debug: err?.message } : {}),
      },
      { status: 500 }
    )
  }
}
