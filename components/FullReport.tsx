'use client'

import { cn } from '@/lib/utils'
import { DealDoctorSection } from './DealDoctor'
import {
  HomeIcon,
  TrendingUpIcon,
  ShieldCheckIcon,
  AlertTriangleIcon,
  DollarSignIcon,
  BarChart3Icon,
  CalendarIcon,
  CheckCircle2Icon,
  XCircleIcon,
  MinusCircleIcon,
  TargetIcon,
  DropletsIcon,
  FlameIcon,
  ThermometerIcon,
  WindIcon,
  CloudRainIcon,
  UmbrellaIcon,
  BanknoteIcon,
  LineChartIcon,
  LandmarkIcon,
  UsersIcon,
} from 'lucide-react'

interface FullReportProps {
  data: any
}

export function FullReport({ data }: FullReportProps) {
  const {
    property,
    rates,
    ltr,
    dealDoctor,
    dealDoctorError,
    comparableSales,
    stateRules,
    breakeven,
    climate,
    expenses,
    cashToClose,
    wealthProjection,
    financingAlternatives,
    rentComps,
  } = data

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

  const verdictConfig = {
    DEAL: { label: 'Strong Deal', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: CheckCircle2Icon },
    MARGINAL: { label: 'Marginal', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: MinusCircleIcon },
    PASS: { label: 'Pass', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', icon: XCircleIcon },
  }

  const v = verdictConfig[ltr.verdict as keyof typeof verdictConfig] || verdictConfig.PASS
  const VerdictIcon = v.icon

  return (
    <div className="w-full space-y-6">
      {/* Print button — hidden in print output itself */}
      <div className="no-print flex justify-end">
        <button
          onClick={() => (typeof window !== 'undefined' ? window.print() : null)}
          className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          Print or save as PDF
        </button>
      </div>

      {/* Property Header */}
      <div className="rounded-xl border bg-card p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="font-[family-name:var(--font-playfair)] text-2xl font-bold text-foreground sm:text-3xl">
              {property.address}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {property.city}, {property.state} &middot; {property.propertyType} &middot;
              {property.bedrooms}bd / {property.bathrooms}ba &middot; {property.sqft?.toLocaleString()} sqft &middot;
              Built {property.yearBuilt}
            </p>
          </div>

          {/* Verdict Badge */}
          <div className={cn("flex items-center gap-2 rounded-lg border px-4 py-2", v.bg, v.border)}>
            <VerdictIcon className={cn("h-5 w-5", v.color)} />
            <div>
              <p className={cn("text-lg font-bold", v.color)}>{v.label}</p>
              <p className="text-xs text-muted-foreground">Score: {ltr.dealScore}/100</p>
            </div>
          </div>
        </div>
      </div>

      {/* Breakeven vs Your Offer — DealDoctor's flagship insight */}
      {breakeven && (
        <div
          className={cn(
            'rounded-xl border-2 p-6 sm:p-8',
            breakeven.delta >= 0
              ? 'border-emerald-500/40 bg-emerald-500/5'
              : 'border-red-500/40 bg-red-500/5'
          )}
        >
          <div className="mb-3 flex items-center gap-2">
            <TargetIcon className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Your Offer vs Breakeven
            </h3>
          </div>
          <p className="text-2xl font-bold text-foreground sm:text-4xl">
            {breakeven.delta >= 0 ? (
              <>
                Your offer is{' '}
                <span className="text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(breakeven.delta)} below breakeven
                </span>
              </>
            ) : (
              <>
                Your offer is{' '}
                <span className="text-red-600 dark:text-red-400">
                  {formatCurrency(-breakeven.delta)} above breakeven
                </span>
              </>
            )}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Your offer</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(breakeven.yourOffer)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Breakeven price</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(breakeven.price)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Listing ask</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(property.askPrice)}</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Breakeven is the purchase price at which this property cash-flows ~$0/month given
            current rent ({formatCurrency(Math.round(ltr.noiAnnual / 12))}/mo NOI)
            and the investor rate ({((rates.mortgage30yrInvestor ?? rates.mortgage30yr) * 100).toFixed(2)}%). Use it as your walk-away number.
          </p>
        </div>
      )}

      {/* 5-Year Wealth Projection — the "why this deal matters over time" hero */}
      {wealthProjection && (
        <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-6 sm:p-8">
          <div className="mb-3 flex items-center gap-2">
            <LineChartIcon className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              5-Year Wealth Projection
            </h3>
          </div>
          <p className="text-2xl font-bold text-foreground sm:text-4xl">
            Builds{' '}
            <span className="text-primary">
              {formatCurrency(wealthProjection.hero.totalWealthBuilt5yr)}
            </span>{' '}
            of wealth over 5 years
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            5-year IRR:{' '}
            <span className="font-bold text-foreground">
              {(wealthProjection.hero.irr5yr * 100).toFixed(1)}%
            </span>
            {' · '}Sum of cash flow + principal paydown + appreciation + depreciation tax shield
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SubMetric label="Cash Flow" value={formatCurrency(wealthProjection.hero.cumulativeCashFlow5yr)} />
            <SubMetric label="Principal Paydown" value={formatCurrency(wealthProjection.hero.equityFromPaydown5yr)} />
            <SubMetric label="Appreciation" value={formatCurrency(wealthProjection.hero.equityFromAppreciation5yr)} />
            <SubMetric label="Tax Shield" value={formatCurrency(wealthProjection.hero.cumulativeTaxShield5yr)} />
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="pb-2 text-left font-medium">Year</th>
                  <th className="pb-2 text-right font-medium">Cash Flow</th>
                  <th className="pb-2 text-right font-medium">Value</th>
                  <th className="pb-2 text-right font-medium">Loan Balance</th>
                  <th className="pb-2 text-right font-medium">Wealth Built</th>
                </tr>
              </thead>
              <tbody>
                {wealthProjection.years.map((y: any) => (
                  <tr key={y.year} className="border-b border-border/50">
                    <td className="py-2 font-medium">Y{y.year}</td>
                    <td className={cn('py-2 text-right font-medium', y.annualCashFlow >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                      {y.annualCashFlow >= 0 ? '+' : ''}{formatCurrency(y.annualCashFlow)}
                    </td>
                    <td className="py-2 text-right">{formatCurrency(y.propertyValue)}</td>
                    <td className="py-2 text-right">{formatCurrency(y.loanBalance)}</td>
                    <td className="py-2 text-right font-bold text-primary">
                      {formatCurrency(y.totalWealthBuilt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-[11px] text-muted-foreground">
            Assumes {(wealthProjection.assumptions.rentGrowthRate * 100).toFixed(1)}% rent growth,{' '}
            {(wealthProjection.assumptions.appreciationRate * 100).toFixed(1)}% appreciation,{' '}
            {(wealthProjection.assumptions.expenseGrowthRate * 100).toFixed(1)}% expense growth,
            {' '}{(wealthProjection.assumptions.effectiveTaxRate * 100).toFixed(0)}% effective tax rate.
            IRR includes sale at year 5 with {(wealthProjection.assumptions.saleCostPct * 100).toFixed(0)}% selling costs.
          </p>
        </div>
      )}

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { icon: DollarSignIcon, label: 'Your Offer', value: formatCurrency(property.offerPrice ?? property.askPrice) },
          { icon: HomeIcon, label: 'Monthly Payment', value: formatCurrency(ltr.monthlyMortgagePayment) },
          { icon: TrendingUpIcon, label: 'Cash Flow', value: `${ltr.monthlyNetCashFlow >= 0 ? '+' : ''}${formatCurrency(ltr.monthlyNetCashFlow)}/mo`, positive: ltr.monthlyNetCashFlow >= 0 },
          { icon: BarChart3Icon, label: 'Cap Rate', value: `${ltr.capRate}%` },
          { icon: DollarSignIcon, label: 'Cash-on-Cash', value: `${ltr.cashOnCashReturn}%` },
          { icon: ShieldCheckIcon, label: 'DSCR', value: `${ltr.dscr}x`, positive: ltr.dscr >= 1.25 },
        ].map((m) => (
          <div key={m.label} className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <m.icon className="h-3.5 w-3.5" />
              <span className="text-[10px] font-medium uppercase tracking-wider">{m.label}</span>
            </div>
            <p className={cn(
              "mt-1.5 text-xl font-bold",
              m.positive === true ? 'text-emerald-600 dark:text-emerald-400' :
              m.positive === false ? 'text-red-600 dark:text-red-400' :
              'text-foreground'
            )}>
              {m.value}
            </p>
          </div>
        ))}
      </div>

      {/* Total Cash to Close — answers "how much do I need in the bank?" */}
      {cashToClose && (
        <div className="rounded-xl border bg-card p-6">
          <div className="mb-3 flex items-center gap-2">
            <BanknoteIcon className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Total Cash to Close</h3>
          </div>
          <p className="text-3xl font-bold text-foreground sm:text-4xl">
            {formatCurrency(cashToClose.totalCashToClose)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            What you need liquid to walk into closing — includes the 6-month PITI reserve most lenders require.
          </p>
          <div className="mt-4 space-y-1.5">
            <LineItem label="Down payment" value={formatCurrency(cashToClose.downPayment)} />
            <LineItem label="Closing costs (~2.5%)" value={formatCurrency(cashToClose.closingCosts)} />
            <LineItem label="Inspection + appraisal" value={formatCurrency(cashToClose.inspectionAndAppraisal)} />
            <LineItem label="Reserves (6mo PITI)" value={formatCurrency(cashToClose.reserves)} />
            {cashToClose.rehabBudget > 0 && (
              <LineItem label="Rehab budget" value={formatCurrency(cashToClose.rehabBudget)} />
            )}
            <div className="border-t pt-1.5">
              <LineItem label="Total" value={formatCurrency(cashToClose.totalCashToClose)} bold />
            </div>
          </div>
        </div>
      )}

      {/* Rates Used */}
      <div className="rounded-xl border bg-card p-6">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Rates Used</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">PMMS 30yr (owner-occ)</p>
            <p className="text-lg font-bold text-muted-foreground line-through decoration-muted-foreground/50">
              {(rates.mortgage30yr * 100).toFixed(2)}%
            </p>
            <p className="text-[10px] text-muted-foreground">Freddie Mac reference</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Investor rate applied</p>
            <p className="text-lg font-bold text-primary">
              {rates.mortgage30yrInvestor
                ? (rates.mortgage30yrInvestor * 100).toFixed(2)
                : (rates.mortgage30yr * 100).toFixed(2)}%
            </p>
            <p className="text-[10px] text-muted-foreground">
              {rates.investorPremiumBps
                ? `PMMS +${rates.investorPremiumBps} bps (${property.strategy ?? 'LTR'})`
                : 'No premium'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">PMMS 15yr</p>
            <p className="text-lg font-bold text-foreground">{(rates.mortgage15yr * 100).toFixed(2)}%</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fed Funds</p>
            <p className="text-lg font-bold text-foreground">{(rates.fedFunds * 100).toFixed(2)}%</p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          PMMS is for owner-occupied mortgages. Investor loans (DSCR / non-owner-occupied) price
          higher — we apply the premium so all downstream math (cash flow, DSCR, breakeven, refi)
          reflects what you&apos;ll actually pay.
        </p>
      </div>

      {/* DSCR Details */}
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheckIcon className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">DSCR Analysis</h3>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">DSCR</p>
            <p className={cn("text-lg font-bold", ltr.dscr >= 1.25 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
              {ltr.dscr}x
            </p>
            <p className="text-[10px] text-muted-foreground">Lenders want 1.25+</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">LTV Ratio</p>
            <p className="text-lg font-bold text-foreground">{(ltr.ltv * 100).toFixed(0)}%</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Annual NOI</p>
            <p className="text-lg font-bold text-foreground">{formatCurrency(ltr.noiAnnual)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Loan Amount</p>
            <p className="text-lg font-bold text-foreground">{formatCurrency(ltr.loanAmount)}</p>
          </div>
        </div>
      </div>

      {/* Financing Alternatives — same deal, three capital structures side-by-side */}
      {financingAlternatives && financingAlternatives.length > 0 && (
        <div className="rounded-xl border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <LandmarkIcon className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Financing Alternatives</h3>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            Same property, different loan structures. Down payment, rate, and requirements differ.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="pb-2 text-left font-medium">Loan Type</th>
                  <th className="pb-2 text-right font-medium">Down</th>
                  <th className="pb-2 text-right font-medium">Rate</th>
                  <th className="pb-2 text-right font-medium">Monthly P&amp;I</th>
                  <th className="pb-2 text-right font-medium">Cash Flow</th>
                  <th className="pb-2 text-right font-medium">DSCR</th>
                  <th className="pb-2 text-right font-medium">Cash to Close</th>
                </tr>
              </thead>
              <tbody>
                {financingAlternatives.map((f: any) => (
                  <tr key={f.id} className="border-b border-border/50 align-top">
                    <td className="py-3 pr-3">
                      <p className="font-medium text-foreground">{f.name}</p>
                      <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                        {f.eligibilityNote}
                      </p>
                    </td>
                    <td className="py-3 text-right">
                      <div className="font-medium">{(f.downPaymentPct * 100).toFixed(1)}%</div>
                      <div className="text-[10px] text-muted-foreground">{formatCurrency(f.downPayment)}</div>
                    </td>
                    <td className="py-3 text-right font-medium">{(f.annualRate * 100).toFixed(2)}%</td>
                    <td className="py-3 text-right">{formatCurrency(f.monthlyPayment)}</td>
                    <td
                      className={cn(
                        'py-3 text-right font-medium',
                        f.monthlyCashFlow >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      )}
                    >
                      {f.monthlyCashFlow >= 0 ? '+' : ''}{formatCurrency(f.monthlyCashFlow)}
                    </td>
                    <td
                      className={cn(
                        'py-3 text-right',
                        f.dscr >= 1.25
                          ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                          : 'text-foreground'
                      )}
                    >
                      {f.dscr}x
                    </td>
                    <td className="py-3 text-right font-bold">{formatCurrency(f.cashToClose)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Refi Scenarios */}
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <CalendarIcon className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">5-Year Refi Scenarios</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="pb-2 text-left font-medium">Refi Rate</th>
                <th className="pb-2 text-right font-medium">Monthly Payment</th>
                <th className="pb-2 text-right font-medium">Cash Flow</th>
                <th className="pb-2 text-right font-medium">Viable?</th>
              </tr>
            </thead>
            <tbody>
              {ltr.renewalScenarios?.map((s: any) => (
                <tr key={s.rate} className="border-b border-border/50">
                  <td className="py-2.5 font-medium">{(s.rate * 100).toFixed(1)}%</td>
                  <td className="py-2.5 text-right">{formatCurrency(s.monthlyPayment)}</td>
                  <td className={cn("py-2.5 text-right font-medium", s.monthlyCashFlow >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                    {s.monthlyCashFlow >= 0 ? '+' : ''}{formatCurrency(s.monthlyCashFlow)}
                  </td>
                  <td className="py-2.5 text-right">
                    {s.viable ? (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">Yes</span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400 font-medium">No</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Depreciation Benefits */}
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <DollarSignIcon className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Depreciation Benefits (Year 1)</h3>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xs text-muted-foreground">Annual Depreciation</p>
            <p className="text-lg font-bold text-foreground">{formatCurrency(ltr.annualDepreciation)}</p>
            <p className="text-[10px] text-muted-foreground">27.5-year straight-line</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Est. Tax Saving</p>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(ltr.estimatedTaxSaving)}</p>
            <p className="text-[10px] text-muted-foreground">At ~28% effective rate</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">After-Tax Cash Flow</p>
            <p className="text-lg font-bold text-foreground">{formatCurrency(ltr.afterTaxCashFlow)}/yr</p>
          </div>
        </div>
      </div>

      {/* Rent Comparables — closes the trust gap on the rent estimate */}
      {rentComps && rentComps.length > 0 && (
        <div className="rounded-xl border bg-card p-6">
          <div className="mb-3 flex items-center gap-2">
            <UsersIcon className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Rent Comparables</h3>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            Nearby rentals used to estimate this property&apos;s rent. If these don&apos;t look
            comparable (wrong neighborhood, wildly different unit), the rent estimate may
            be off — verify with a local property manager before relying on these numbers.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rentComps.map((c: any, i: number) => (
              <div key={i} className="rounded-lg border p-4">
                <p className="text-sm font-medium text-foreground">{c.address}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="text-base font-bold text-foreground">
                    {formatCurrency(c.rent)}/mo
                  </span>
                  {c.bedrooms != null && (
                    <span>
                      {c.bedrooms}bd{c.bathrooms != null ? ` / ${c.bathrooms}ba` : ''}
                    </span>
                  )}
                  {c.square_feet && <span>{c.square_feet.toLocaleString()} sqft</span>}
                  {typeof c.distance_miles === 'number' && (
                    <span>· {c.distance_miles.toFixed(1)}mi</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Climate & Insurance */}
      {climate && (
        <div className="rounded-xl border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <UmbrellaIcon className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Climate &amp; Insurance</h3>
          </div>

          {/* Insurance + flood + monthly expense breakdown */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border bg-background/50 p-4">
              <p className="text-xs text-muted-foreground">Est. Annual Insurance</p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {formatCurrency(climate.estimatedAnnualInsurance)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                State base {formatCurrency(climate.insuranceBreakdown.baseStatePremium)}
                {climate.insuranceBreakdown.floodZoneAddOn > 0 && (
                  <> · +{formatCurrency(climate.insuranceBreakdown.floodZoneAddOn)} flood</>
                )}
              </p>
            </div>

            <div
              className={cn(
                'rounded-lg border p-4',
                climate.floodRisk === 'high-coastal' || climate.floodRisk === 'high'
                  ? 'border-red-500/40 bg-red-500/5'
                  : 'bg-background/50'
              )}
            >
              <div className="flex items-center gap-1.5">
                <DropletsIcon className="h-3.5 w-3.5 text-blue-500" />
                <p className="text-xs text-muted-foreground">Flood Zone</p>
              </div>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {climate.floodZone || 'Unknown'}
              </p>
              <p className={cn(
                'mt-1 text-[11px] font-medium',
                climate.floodInsuranceRequired ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
              )}>
                {climate.floodRisk === 'high-coastal' && 'Coastal high-risk · NFIP required'}
                {climate.floodRisk === 'high' && 'High-risk · NFIP required'}
                {climate.floodRisk === 'moderate' && 'Moderate risk'}
                {climate.floodRisk === 'minimal' && 'Minimal risk'}
                {climate.floodRisk === 'unknown' && 'Not mapped / unknown'}
              </p>
            </div>

            {expenses && (
              <div className="rounded-lg border bg-background/50 p-4">
                <p className="text-xs text-muted-foreground">Monthly Expenses</p>
                <p className="mt-1 text-2xl font-bold text-foreground">
                  {formatCurrency(expenses.monthlyTotal)}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Tax {formatCurrency(expenses.monthlyPropertyTax)}
                  {expenses.propertyTaxSource === 'county-record' && (
                    <span className="ml-1 rounded bg-emerald-500/10 px-1 text-[9px] font-semibold text-emerald-700 dark:text-emerald-400">
                      county record
                    </span>
                  )}
                  {' · '}Ins {formatCurrency(expenses.monthlyInsurance)}
                  {' · '}Maint {formatCurrency(expenses.monthlyMaintenance)}
                  {expenses.monthlyHOA > 0 && (
                    <> · HOA {formatCurrency(expenses.monthlyHOA)}</>
                  )}
                </p>
                {expenses.monthlyHOA === 0 &&
                  (property.propertyType || '').toLowerCase().includes('condo') && (
                    <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-400">
                      ⚠ HOA not captured from listing — condos/townhomes often have dues
                      ($150–$500/mo). Verify and add manually when underwriting.
                    </p>
                  )}
              </div>
            )}
          </div>

          {/* Climate risk bars */}
          {climate.climateScores && (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <RiskBar icon={WindIcon} label="Hurricane" score={climate.climateScores.hurricane} />
              <RiskBar icon={FlameIcon} label="Wildfire" score={climate.climateScores.wildfire} />
              <RiskBar icon={ThermometerIcon} label="Heat" score={climate.climateScores.heat} />
              <RiskBar icon={CloudRainIcon} label="Drought" score={climate.climateScores.drought} />
              <RiskBar icon={WindIcon} label="Tornado" score={climate.climateScores.tornado} />
            </div>
          )}

          {climate.summary && (
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{climate.summary}</p>
          )}
        </div>
      )}

      {/* State Rules */}
      {stateRules && (
        <div className="rounded-xl border bg-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangleIcon className="h-5 w-5 text-amber-500" />
            <h3 className="text-sm font-semibold text-foreground">State Rules ({stateRules.state})</h3>
          </div>
          <div className="space-y-2 text-sm">
            {stateRules.rentControl && (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Rent Control:</span> This state has rent control laws. Check local ordinances.
              </p>
            )}
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Landlord-Friendly:</span> {stateRules.landlordFriendly ? 'Yes' : 'No'}
            </p>
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Property Tax Rate:</span> ~{(stateRules.propertyTaxRate * 100).toFixed(1)}%
            </p>
            {stateRules.strNotes && (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">STR Rules:</span> {stateRules.strNotes}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Deal Doctor — or graceful fallback if the AI step failed */}
      {dealDoctor ? (
        <DealDoctorSection dealDoctor={dealDoctor} verdict={ltr.verdict} />
      ) : dealDoctorError ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="flex items-start gap-2">
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-semibold text-foreground">AI diagnosis unavailable</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{dealDoctorError}</p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Comparable Sales */}
      {comparableSales && comparableSales.length > 0 && (
        <div className="rounded-xl border bg-card p-6">
          <h3 className="mb-4 text-sm font-semibold text-foreground">Comparable Properties</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {comparableSales.map((comp: any, i: number) => (
              <div key={i} className="rounded-lg border p-4">
                <p className="font-medium text-foreground text-sm">{comp.address}</p>
                <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="font-bold text-foreground text-base">{formatCurrency(comp.estimated_value)}</span>
                  <span>{comp.bedrooms}bd / {comp.bathrooms}ba</span>
                  {comp.square_feet && <span>{comp.square_feet.toLocaleString()} sqft</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data Sources — transparent provenance */}
      <div className="rounded-xl border border-dashed bg-background/40 p-5 text-xs leading-relaxed text-muted-foreground">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground">
          Data Sources
        </p>
        <ul className="space-y-1">
          <li>• Property details, rent &amp; value estimates, sale &amp; rent comps — Rentcast AVM</li>
          <li>• Flood zone — FEMA National Flood Hazard Layer REST API</li>
          <li>• Geocoding — Mapbox</li>
          <li>
            • Mortgage rates — Freddie Mac PMMS (30yr / 15yr); investor premium applied for LTR/STR/FLIP
          </li>
          <li>• Insurance baseline — NAIC state averages, scaled by dwelling value</li>
          <li>• Climate risk scores, STR revenue, breakeven math — DealDoctor&apos;s own models</li>
          <li>• Deal Doctor narrative and photo review — Anthropic Claude Haiku 4.5</li>
        </ul>
        <p className="mt-3">
          Full methodology at{' '}
          <a
            href="/methodology"
            className="underline underline-offset-2 hover:text-foreground"
          >
            /methodology
          </a>
          . Not an appraisal or home inspection — always verify with licensed professionals before closing.
        </p>
      </div>
    </div>
  )
}

function SubMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background/50 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold text-foreground">{value}</p>
    </div>
  )
}

function LineItem({
  label,
  value,
  bold,
}: {
  label: string
  value: string
  bold?: boolean
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={cn('text-muted-foreground', bold && 'font-semibold text-foreground')}>
        {label}
      </span>
      <span className={cn('tabular-nums', bold ? 'text-lg font-bold text-foreground' : 'font-medium text-foreground')}>
        {value}
      </span>
    </div>
  )
}

function RiskBar({
  icon: Icon,
  label,
  score,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  score: number
}) {
  const pct = Math.min(100, Math.max(0, (score / 5) * 100))
  const tone =
    score >= 4 ? 'bg-red-500' :
    score >= 3 ? 'bg-amber-500' :
    score >= 1 ? 'bg-emerald-500' :
    'bg-muted-foreground/30'
  const toneText =
    score >= 4 ? 'text-red-600 dark:text-red-400' :
    score >= 3 ? 'text-amber-600 dark:text-amber-400' :
    score >= 1 ? 'text-emerald-600 dark:text-emerald-400' :
    'text-muted-foreground'
  const label2 =
    score >= 4 ? 'High' :
    score >= 3 ? 'Elevated' :
    score >= 1 ? 'Low' :
    'None'
  return (
    <div className="rounded-lg border bg-background/50 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className={cn('mt-1 text-sm font-bold', toneText)}>{label2}</p>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
