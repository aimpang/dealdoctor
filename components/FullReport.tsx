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
} from 'lucide-react'

interface FullReportProps {
  data: any
}

export function FullReport({ data }: FullReportProps) {
  const { property, rates, ltr, dealDoctor, comparableSales, stateRules, breakeven, climate, expenses } = data

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
            current rent ({formatCurrency(ltr.noiAnnual / 12 + (ltr.noiAnnual > 0 ? 0 : 0))}/mo NOI implied)
            and today&apos;s rate ({(rates.mortgage30yr * 100).toFixed(2)}%). Use it as your walk-away number.
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

      {/* Rates Used */}
      <div className="rounded-xl border bg-card p-6">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Rates Used (Freddie Mac Survey)</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xs text-muted-foreground">30yr Fixed</p>
            <p className="text-lg font-bold text-foreground">{(rates.mortgage30yr * 100).toFixed(2)}%</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">15yr Fixed</p>
            <p className="text-lg font-bold text-foreground">{(rates.mortgage15yr * 100).toFixed(2)}%</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fed Funds</p>
            <p className="text-lg font-bold text-foreground">{(rates.fedFunds * 100).toFixed(2)}%</p>
          </div>
        </div>
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
                  Tax {formatCurrency(expenses.monthlyPropertyTax)} · Ins {formatCurrency(expenses.monthlyInsurance)} · Maint {formatCurrency(expenses.monthlyMaintenance)}
                </p>
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

      {/* Deal Doctor */}
      {dealDoctor && (
        <DealDoctorSection dealDoctor={dealDoctor} verdict={ltr.verdict} />
      )}

      {/* Comparable Sales */}
      {/* (see RiskBar helper at end of file) */}
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
