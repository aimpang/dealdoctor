import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import * as XLSX from 'xlsx'
import { isDebugAccessAuthorized } from '@/lib/debugAccess'
import { verifyShareToken } from '@/lib/shareToken'
import { CUSTOMER_COOKIE } from '@/lib/entitlements'

// Multi-sheet Excel export of the full report. Everything comes from
// fullReportData — no new computations — so this is a pure transformation job.
// Only available on paid reports; unpaid requests get 402.

export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: { uuid: string } }
) {
  try {
    const { uuid } = params
    const report = await prisma.report.findUnique({ where: { id: uuid } })
    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    const { searchParams } = new URL(req.url)
    const isDebug =
      searchParams.get('debug') === '1' &&
      isDebugAccessAuthorized(searchParams.get('debugKey'))

    // Non-owner Excel access requires a signed share token — same policy as
    // the main report endpoint. Paid-but-unauthed requests get 403.
    const tokenValid = verifyShareToken(uuid, searchParams.get('t'))
    const cookieToken = req.cookies.get(CUSTOMER_COOKIE)?.value
    let isOwner = false
    if (cookieToken && (report as any).customerId) {
      const cookieCustomer = await prisma.customer.findUnique({
        where: { accessToken: cookieToken },
        select: { id: true },
      })
      isOwner = cookieCustomer?.id === (report as any).customerId
    }
    const hasAccess = isDebug || isOwner || tokenValid

    if (!report.paid && !isDebug) {
      return NextResponse.json(
        { error: 'Excel export is a paid-report feature' },
        { status: 402 }
      )
    }
    if (report.paid && !hasAccess) {
      return NextResponse.json(
        { error: 'Access denied. Excel export requires the owner cookie or a valid share link.' },
        { status: 403 }
      )
    }
    if (!report.fullReportData) {
      return NextResponse.json(
        { error: 'Report data not yet generated' },
        { status: 425 }
      )
    }

    const data = JSON.parse(report.fullReportData)
    const wb = XLSX.utils.book_new()

    // --- Sheet 1: Summary ---
    const summary = [
      ['DealDoctor Report', ''],
      ['Address', data.property?.address ?? ''],
      ['City, State', `${data.property?.city ?? ''}, ${data.property?.state ?? ''}`],
      ['Property Type', data.property?.propertyType ?? ''],
      ['Bedrooms / Bathrooms', `${data.property?.bedrooms ?? ''} / ${data.property?.bathrooms ?? ''}`],
      ['Square Feet', data.property?.sqft ?? ''],
      ['Year Built', data.property?.yearBuilt ?? ''],
      ['', ''],
      ['Verdict', data.ltr?.verdict ?? ''],
      ['Deal Score (0-100)', data.ltr?.dealScore ?? ''],
      ['', ''],
      ['Listing Price', data.property?.askPrice ?? ''],
      ['Your Offer', data.property?.offerPrice ?? ''],
      ['Breakeven Price', data.breakeven?.price ?? ''],
      ['Offer vs Breakeven', data.breakeven?.delta ?? ''],
      ['', ''],
      ['5-Year Total Wealth Built', data.wealthProjection?.hero?.totalWealthBuilt5yr ?? ''],
      ['5-Year IRR', data.wealthProjection?.hero?.irr5yr ?? ''],
      ['Total Cash to Close', data.cashToClose?.totalCashToClose ?? ''],
      ['', ''],
      ['Generated', data.generatedAt ?? ''],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary')

    // --- Sheet 2: Year-1 Financials ---
    const ltr = data.ltr ?? {}
    const exp = data.expenses ?? {}
    const year1 = [
      ['Metric', 'Value'],
      ['Monthly Mortgage Payment', ltr.monthlyMortgagePayment],
      ['Monthly Property Tax', exp.monthlyPropertyTax],
      ['Monthly Insurance', exp.monthlyInsurance],
      ['Monthly Maintenance', exp.monthlyMaintenance],
      ['Monthly HOA', exp.monthlyHOA],
      ['Total Monthly Expenses', exp.monthlyTotal],
      ['', ''],
      ['Monthly Net Cash Flow', ltr.monthlyNetCashFlow],
      ['Annual Net Cash Flow', ltr.annualNetCashFlow],
      ['Annual NOI', ltr.noiAnnual],
      ['', ''],
      ['Cap Rate (%)', ltr.capRate],
      ['Cash-on-Cash Return (%)', ltr.cashOnCashReturn],
      ['DSCR', ltr.dscr],
      ['LTV', ltr.ltv],
      ['Loan Amount', ltr.loanAmount],
      ['', ''],
      ['Annual Depreciation', ltr.annualDepreciation],
      ['Estimated Tax Saving', ltr.estimatedTaxSaving],
      ['After-Tax Cash Flow (annual)', ltr.afterTaxCashFlow],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(year1), 'Year-1 Financials')

    // --- Sheet 3: 5-Year Projection ---
    const proj = data.wealthProjection?.years ?? []
    const projRows = [
      ['Year', 'Annual Rent', 'Annual Expenses', 'Annual Cash Flow', 'Cumulative CF', 'Property Value', 'Loan Balance', 'Equity (Paydown)', 'Equity (Appreciation)', 'Tax Shield', 'Cumulative Tax Shield', 'Total Wealth Built'],
      ...proj.map((y: any) => [
        y.year, y.annualRent, y.annualExpenses, y.annualCashFlow, y.cumulativeCashFlow,
        y.propertyValue, y.loanBalance, y.equityFromPaydown, y.equityFromAppreciation,
        y.annualTaxShield, y.cumulativeTaxShield, y.totalWealthBuilt,
      ]),
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(projRows), '5yr Projection')

    // --- Sheet 4: Sensitivity ---
    if (Array.isArray(data.sensitivity)) {
      const sens = [
        ['Scenario', 'Description', 'Monthly Cash Flow', 'Δ vs Base', 'DSCR', '5yr Wealth', 'Δ Wealth vs Base', '5yr IRR'],
        ...data.sensitivity.map((s: any) => [
          s.scenario, s.description, s.monthlyCashFlow, s.cashFlowDelta,
          s.dscr, s.fiveYrWealth, s.wealthDelta, s.fiveYrIRR,
        ]),
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sens), 'Sensitivity')
    }

    // --- Sheet 5: Financing Alternatives ---
    if (Array.isArray(data.financingAlternatives)) {
      const fin = [
        ['Loan Type', 'Down %', 'Down $', 'Rate', 'Monthly P&I', 'Cash Flow', 'DSCR', 'Cash to Close', 'Eligibility'],
        ...data.financingAlternatives.map((f: any) => [
          f.name, f.downPaymentPct, f.downPayment, f.annualRate, f.monthlyPayment,
          f.monthlyCashFlow, f.dscr, f.cashToClose, f.eligibilityNote,
        ]),
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fin), 'Financing Options')
    }

    // --- Sheet 6: Recommended Offers ---
    if (data.recommendedOffers) {
      const r = data.recommendedOffers
      const offers = [
        ['Target', 'Max Offer Price'],
        ['Breakeven (CF ≥ 0)', r.breakevenPrice],
        [`Cash-on-Cash ${(r.priceForCashOnCash?.target * 100).toFixed(0)}%`, r.priceForCashOnCash?.maxPrice],
        [`IRR ${(r.priceForIRR?.target * 100).toFixed(0)}%`, r.priceForIRR?.maxPrice],
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(offers), 'Recommended Offers')
    }

    // --- Sheet 7: Comparables ---
    const compsRows: any[][] = [['Type', 'Address', 'Value / Rent', '$/sqft', 'Beds', 'Baths', 'Sqft', 'DOM / Distance']]
    if (Array.isArray(data.comparableSales)) {
      for (const c of data.comparableSales) {
        compsRows.push([
          'Sale', c.address, c.estimated_value, c.price_per_sqft,
          c.bedrooms, c.bathrooms, c.square_feet, c.days_on_market,
        ])
      }
    }
    if (Array.isArray(data.rentComps)) {
      for (const c of data.rentComps) {
        compsRows.push([
          'Rent', c.address, c.rent, '',
          c.bedrooms, c.bathrooms, c.square_feet, c.distance_miles,
        ])
      }
    }
    if (compsRows.length > 1) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(compsRows), 'Comparables')
    }

    // --- Sheet 8: Assumptions ---
    const assumptions = data.wealthProjection?.assumptions ?? {}
    const rates = data.rates ?? {}
    const climate = data.climate ?? {}
    const assm = [
      ['Assumption', 'Value'],
      ['PMMS 30yr Rate', rates.mortgage30yr],
      ['Investor Rate Applied', rates.mortgage30yrInvestor],
      ['Investor Premium (bps)', rates.investorPremiumBps],
      ['', ''],
      ['Down Payment %', data.property?.downPaymentPct],
      ['Amortization (years)', 30],
      ['Vacancy Rate', 0.05],
      ['', ''],
      ['Rent Growth Rate', assumptions.rentGrowthRate],
      ['Appreciation Rate', assumptions.appreciationRate],
      ['Expense Growth Rate', assumptions.expenseGrowthRate],
      ['Effective Tax Rate', assumptions.effectiveTaxRate],
      ['Sale Costs at Exit', assumptions.saleCostPct],
      ['', ''],
      ['Flood Zone', climate.floodZone],
      ['Flood Insurance Required', climate.floodInsuranceRequired],
      ['Estimated Annual Insurance', climate.estimatedAnnualInsurance],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(assm), 'Assumptions')

    // Emit workbook as binary buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    const safeAddress = (report.address || 'property').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    const filename = `dealdoctor-${safeAddress}-${uuid.slice(0, 8)}.xlsx`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    console.error('Excel export error:', err)
    return NextResponse.json(
      { error: 'Export failed', debug: err?.message },
      { status: 500 }
    )
  }
}
