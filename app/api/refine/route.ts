import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  calculateDealMetrics,
  calculateBreakEvenPrice,
  STATE_RULES,
} from '@/lib/calculations'
import { estimateInsuranceFast } from '@/lib/climateRisk'
import { logger } from '@/lib/logger'

const STRATEGIES = ['LTR', 'STR', 'FLIP'] as const
type Strategy = typeof STRATEGIES[number]

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { uuid, offerPrice, downPaymentPct, rehabBudget, strategy } = body

    if (!uuid) {
      return NextResponse.json({ error: 'Missing report id' }, { status: 400 })
    }

    const price = Number(offerPrice)
    const downPct = Number(downPaymentPct)
    const rehab = Number(rehabBudget ?? 0)

    // Sanity ranges — reject numbers that don't make sense for US residential
    if (!isFinite(price) || price < 30_000 || price > 10_000_000) {
      return NextResponse.json({ error: 'Offer price must be between $30,000 and $10,000,000' }, { status: 400 })
    }
    if (!isFinite(downPct) || downPct < 0.035 || downPct > 0.5) {
      return NextResponse.json({ error: 'Down payment must be between 3.5% and 50%' }, { status: 400 })
    }
    if (!isFinite(rehab) || rehab < 0 || rehab > 2_000_000) {
      return NextResponse.json({ error: 'Rehab budget must be between $0 and $2,000,000' }, { status: 400 })
    }
    if (strategy && !STRATEGIES.includes(strategy as Strategy)) {
      return NextResponse.json({ error: 'Invalid strategy' }, { status: 400 })
    }

    const report = await prisma.report.findUnique({ where: { id: uuid } })
    if (!report || !report.teaserData) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }
    if (report.paid) {
      return NextResponse.json({ error: 'Cannot refine a paid report' }, { status: 409 })
    }

    const teaser = JSON.parse(report.teaserData) as {
      estimatedRent: number
      currentRate: number
    }

    const stateRules = STATE_RULES[report.state] || STATE_RULES['TX']
    const monthlyPropertyTax = Math.round((price * stateRules.propertyTaxRate) / 12)
    const monthlyInsurance = Math.round(estimateInsuranceFast(report.state, price) / 12)
    const monthlyMaintenance = 150
    const monthlyExpenses = monthlyPropertyTax + monthlyInsurance + monthlyMaintenance

    const metrics = calculateDealMetrics(
      {
        purchasePrice: price,
        downPaymentPct: downPct,
        annualRate: teaser.currentRate,
        amortizationYears: 30,
        state: report.state,
        rehabBudget: rehab,
      },
      {
        estimatedMonthlyRent: teaser.estimatedRent,
        vacancyRate: 0.05,
        monthlyExpenses,
      },
      report.state
    )

    const breakevenPrice = calculateBreakEvenPrice(
      teaser.estimatedRent,
      teaser.currentRate,
      {
        downPaymentPct: downPct,
        propertyTaxRate: stateRules.propertyTaxRate,
        monthlyInsurance,
        monthlyMaintenance,
        offerPrice: price,
      }
    )
    const deltaVsBreakeven = breakevenPrice - price // positive = headroom, negative = above breakeven

    await prisma.report.update({
      where: { id: uuid },
      data: {
        offerPrice: price,
        downPaymentPct: downPct,
        rehabBudget: rehab,
        strategy: (strategy as Strategy) || 'LTR',
        refinedAt: new Date(),
      },
    })

    return NextResponse.json({
      breakevenPrice,
      yourOffer: price,
      deltaVsBreakeven,
      monthlyPayment: metrics.monthlyMortgagePayment,
      monthlyCashFlow: metrics.monthlyNetCashFlow,
      dscr: metrics.dscr,
      capRate: metrics.capRate,
      cashOnCashReturn: metrics.cashOnCashReturn,
      verdict: metrics.verdict,
      dealScore: metrics.dealScore,
    })
  } catch (err: any) {
    logger.error('refine.failed', { error: err })
    return NextResponse.json(
      {
        error: 'Something went wrong',
        ...(process.env.NODE_ENV !== 'production' ? { debug: err?.message } : {}),
      },
      { status: 500 }
    )
  }
}
