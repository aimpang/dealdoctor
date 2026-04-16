# DealDoctor — Full MVP Build Spec
> Pass this entire file to Claude Code. It contains everything needed to build and run the app.

---

## What We're Building

A Canadian real estate deal analyzer. User pastes a property address → gets 3 free teaser metrics → pays $14.99 CAD via Stripe → receives a full AI-powered investment report at a unique shareable URL.

**No auth. No accounts. No dashboard.** Just address → payment → report.

---

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Database:** SQLite via Prisma (simple, no setup, file-based — upgrade to Postgres later)
- **Payments:** Stripe Checkout
- **Property Data:** Houski API (Canadian properties)
- **Rates:** Bank of Canada API (free, no key needed)
- **AI:** Anthropic Claude API (claude-sonnet-4-20250514)
- **3D Map:** Three.js
- **Deployment:** Vercel-ready

---

## Project Structure

```
C:\Applications\DealDoctor\
├── app/
│   ├── page.tsx                    # Landing page
│   ├── report/
│   │   └── [uuid]/
│   │       └── page.tsx            # Report page
│   ├── api/
│   │   ├── preview/
│   │   │   └── route.ts            # Free teaser endpoint
│   │   ├── checkout/
│   │   │   └── route.ts            # Create Stripe session
│   │   └── webhook/
│   │       └── route.ts            # Stripe webhook → mark paid
│   └── layout.tsx
├── components/
│   ├── AddressInput.tsx             # Address search box
│   ├── TeaserMetrics.tsx            # 3 free metrics shown before pay
│   ├── BlurredReport.tsx            # Blurred report with pay CTA
│   ├── FullReport.tsx               # Full unlocked report
│   ├── DealDoctor.tsx               # Deal Doctor section
│   ├── MapPin3D.tsx                 # Three.js 3D city + pin
│   └── AssumptionSliders.tsx        # Editable inputs that recalculate
├── lib/
│   ├── houski.ts                    # Houski API wrapper
│   ├── bankofcanada.ts              # Live mortgage rate fetch
│   ├── calculations.ts              # Canadian mortgage math engine
│   ├── dealDoctor.ts                # Deal Doctor logic + Claude prompt
│   ├── stripe.ts                    # Stripe helpers
│   └── db.ts                        # Prisma client
├── prisma/
│   └── schema.prisma
├── .env.local                       # Keys (see below)
├── package.json
└── next.config.js
```

---

## Environment Variables

Create `.env.local` with:

```env
# Anthropic
ANTHROPIC_API_KEY=your_key_here

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Houski (Canadian property data — get free key at houski.ca)
HOUSKI_API_KEY=your_key_here

# App
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

---

## Database Schema

**File: `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:./dealdoctor.db"
}

model Report {
  id              String   @id @default(uuid())
  address         String
  city            String
  province        String
  postalCode      String
  country         String   @default("CA")
  
  // Teaser data (generated free)
  teaserData      String?  // JSON: {estimatedValue, estimatedRent, neighbourhoodScore}
  
  // Full report (generated on payment)
  fullReportData  String?  // JSON: full analysis
  
  // Payment
  paid            Boolean  @default(false)
  stripeSessionId String?
  customerEmail   String?
  paidAt          DateTime?
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

---

## Canadian Calculation Engine

**File: `lib/calculations.ts`**

```typescript
// IMPORTANT: Canadian mortgages use SEMI-ANNUAL compounding, not monthly.
// This is legally mandated in Canada. Getting this wrong = wrong numbers.

export interface MortgageInputs {
  purchasePrice: number      // CAD
  downPaymentPct: number     // e.g. 0.20 for 20%
  annualRate: number         // e.g. 0.0444 for 4.44%
  amortizationYears: number  // typically 25 in Canada
  province: string
}

export interface RentalInputs {
  estimatedMonthlyRent: number
  vacancyRate: number        // e.g. 0.05 for 5%
  monthlyExpenses: number    // property tax + insurance + maintenance
  monthlyCondoFee?: number
}

export interface DealMetrics {
  // Mortgage
  monthlyMortgagePayment: number
  loanAmount: number
  
  // Cash flow
  monthlyNetCashFlow: number
  annualNetCashFlow: number
  
  // Returns
  capRate: number            // NOI / purchase price
  cashOnCashReturn: number   // annual cash flow / down payment
  noiAnnual: number
  
  // Stress test
  stressTestRate: number     // contract rate + 2%
  stressTestPayment: number
  stressTestGDS: number      // needs to be ≤ 0.39 to pass
  passesStressTest: boolean
  requiredIncomeToQualify: number
  
  // Renewal risk
  renewalSurvivalRate: number  // max rate at renewal where deal still works
  renewalScenarios: RenewalScenario[]
  
  // CCA (Canadian Capital Cost Allowance)
  annualCCADeduction: number   // 4% declining balance on building value
  estimatedTaxSaving: number   // at 33% marginal rate
  afterTaxCashFlow: number
  
  // Verdict
  verdict: 'DEAL' | 'MARGINAL' | 'PASS'
  primaryFailureMode: string
  dealScore: number            // 0-100
}

export interface RenewalScenario {
  rate: number
  monthlyPayment: number
  monthlyCashFlow: number
  viable: boolean
}

// ─── CORE MORTGAGE CALCULATION ───────────────────────────────────
// Canadian mortgage: semi-annual compounding (Bank Act requirement)
export function calculateCanadianMortgage(
  principal: number,
  annualRate: number,
  amortizationYears: number
): number {
  // Step 1: Convert nominal rate (semi-annual) to effective annual rate
  const effectiveAnnualRate = Math.pow(1 + annualRate / 2, 2) - 1
  
  // Step 2: Convert to monthly rate
  const monthlyRate = Math.pow(1 + effectiveAnnualRate, 1 / 12) - 1
  
  // Step 3: Standard mortgage payment formula
  const n = amortizationYears * 12
  const payment = principal * (monthlyRate * Math.pow(1 + monthlyRate, n)) / 
                  (Math.pow(1 + monthlyRate, n) - 1)
  
  return Math.round(payment * 100) / 100
}

// ─── STRESS TEST ─────────────────────────────────────────────────
// Must qualify at: max(contract_rate + 2%, 5.25%)
export function calculateStressTest(
  loanAmount: number,
  contractRate: number,
  amortizationYears: number,
  propertyTax: number,     // monthly
  heat: number,            // monthly, ~$150 default
  condoFee: number,        // monthly, 0 if not condo
  grossMonthlyIncome: number
): {
  stressTestRate: number
  stressPayment: number
  GDS: number
  passes: boolean
  requiredIncome: number
} {
  const stressTestRate = Math.max(contractRate + 0.02, 0.0525)
  const stressPayment = calculateCanadianMortgage(loanAmount, stressTestRate, amortizationYears)
  
  // GDS = (mortgage + tax + heat + 50% condo fee) / gross monthly income
  const GDS = (stressPayment + propertyTax + heat + condoFee * 0.5) / grossMonthlyIncome
  
  // Required income for GDS ≤ 0.39
  const requiredIncome = (stressPayment + propertyTax + heat + condoFee * 0.5) / 0.39
  
  return {
    stressTestRate,
    stressPayment: Math.round(stressPayment),
    GDS: Math.round(GDS * 1000) / 1000,
    passes: GDS <= 0.39,
    requiredIncome: Math.round(requiredIncome)
  }
}

// ─── RENEWAL SCENARIOS ───────────────────────────────────────────
export function calculateRenewalScenarios(
  originalLoanAmount: number,
  contractRate: number,
  amortizationYears: number,
  termYears: number = 5,
  monthlyRent: number,
  vacancy: number,
  expenses: number
): RenewalScenario[] {
  // Calculate remaining balance after term
  const monthlyRate = Math.pow(Math.pow(1 + contractRate / 2, 2), 1/12) - 1
  const n = amortizationYears * 12
  const termMonths = termYears * 12
  const originalPayment = calculateCanadianMortgage(originalLoanAmount, contractRate, amortizationYears)
  
  // Remaining balance at renewal
  let balance = originalLoanAmount
  for (let i = 0; i < termMonths; i++) {
    const interestPayment = balance * monthlyRate
    const principalPayment = originalPayment - interestPayment
    balance -= principalPayment
  }
  
  const renewalRates = [0.035, 0.045, 0.055, 0.065, 0.075]
  const remainingAmort = amortizationYears - termYears
  const effectiveRent = monthlyRent * (1 - vacancy)
  
  return renewalRates.map(rate => {
    const payment = calculateCanadianMortgage(balance, rate, remainingAmort)
    const cashFlow = effectiveRent - payment - expenses
    return {
      rate,
      monthlyPayment: Math.round(payment),
      monthlyCashFlow: Math.round(cashFlow),
      viable: cashFlow >= -100 // allow up to $100/mo negative
    }
  })
}

// ─── CCA CALCULATION ─────────────────────────────────────────────
// Capital Cost Allowance: 4% declining balance on BUILDING value only
// Land is not depreciable. Roughly 80% of property value = building.
// CANNOT be used to create or increase a rental loss.
export function calculateCCA(
  purchasePrice: number,
  annualRentalIncome: number,
  annualExpenses: number
): {
  buildingValue: number
  year1CCA: number
  estimatedTaxSaving: number
  afterTaxCashFlow: number
} {
  const buildingValue = purchasePrice * 0.80  // 80% building, 20% land
  const halfYearRule = buildingValue * 0.04 * 0.5  // first year: half-year rule
  const year1CCA = halfYearRule
  
  // CCA cannot exceed net rental income (cannot create a loss)
  const netRentalIncome = annualRentalIncome - annualExpenses
  const claimableCCA = Math.min(year1CCA, Math.max(0, netRentalIncome))
  
  const taxSaving = claimableCCA * 0.33  // ~33% marginal rate estimate
  
  return {
    buildingValue: Math.round(buildingValue),
    year1CCA: Math.round(year1CCA),
    estimatedTaxSaving: Math.round(taxSaving),
    afterTaxCashFlow: Math.round(netRentalIncome - (annualExpenses - taxSaving))
  }
}

// ─── PROVINCE RULES ──────────────────────────────────────────────
export const PROVINCE_RULES: Record<string, {
  name: string
  nrst: number              // Non-resident speculation tax rate
  specTax: number           // Speculation/vacancy tax (BC)
  rentControl: boolean
  rentIncreaseCapPct: number // 0 if no cap
  strRestrictedCities: string[]
  strNotes: string
}> = {
  ON: {
    name: 'Ontario',
    nrst: 0.25,             // 25% for non-residents/non-citizens
    specTax: 0,
    rentControl: true,      // for units built before 2018
    rentIncreaseCapPct: 0,  // varies by year, check LCBO guidelines
    strRestrictedCities: ['Toronto', 'Ottawa'],
    strNotes: 'Toronto: STR limited to principal residence only since 2023. Permit required.'
  },
  BC: {
    name: 'British Columbia',
    nrst: 0.20,             // 20% foreign buyer tax
    specTax: 0.02,          // 2% speculation & vacancy tax in designated areas
    rentControl: true,
    rentIncreaseCapPct: 3.0, // 2026 allowable increase
    strRestrictedCities: ['Vancouver', 'Victoria'],
    strNotes: 'Vancouver: STR limited to principal residence. Provincial STR rules apply province-wide since 2024.'
  },
  AB: {
    name: 'Alberta',
    nrst: 0,
    specTax: 0,
    rentControl: false,     // No rent control in Alberta
    rentIncreaseCapPct: 0,
    strRestrictedCities: [],
    strNotes: 'No provincial STR restrictions. Check municipal rules.'
  },
  QC: {
    name: 'Quebec',
    nrst: 0,
    specTax: 0,
    rentControl: true,      // TAL (Tribunal administratif du logement)
    rentIncreaseCapPct: 3.1, // 2026 TAL guideline
    strRestrictedCities: ['Montreal'],
    strNotes: 'Montreal: STR permit required. Short-term rental rules tightened 2023-2024.'
  },
  NS: {
    name: 'Nova Scotia',
    nrst: 0,
    specTax: 0,
    rentControl: false,
    rentIncreaseCapPct: 0,
    strRestrictedCities: [],
    strNotes: 'No major STR restrictions. Halifax permit required for commercial STR.'
  },
  MB: { name: 'Manitoba', nrst: 0, specTax: 0, rentControl: false, rentIncreaseCapPct: 0, strRestrictedCities: [], strNotes: '' },
  SK: { name: 'Saskatchewan', nrst: 0, specTax: 0, rentControl: false, rentIncreaseCapPct: 0, strRestrictedCities: [], strNotes: '' },
  NB: { name: 'New Brunswick', nrst: 0, specTax: 0, rentControl: false, rentIncreaseCapPct: 0, strRestrictedCities: [], strNotes: '' },
  NL: { name: 'Newfoundland', nrst: 0, specTax: 0, rentControl: false, rentIncreaseCapPct: 0, strRestrictedCities: [], strNotes: '' },
  PE: { name: 'PEI', nrst: 0, specTax: 0, rentControl: true, rentIncreaseCapPct: 3.0, strRestrictedCities: [], strNotes: '' },
}

// Extract province code from Canadian postal code
// First letter of postal code maps to province
export function getProvinceFromPostalCode(postalCode: string): string {
  const firstLetter = postalCode.trim().toUpperCase()[0]
  const map: Record<string, string> = {
    'A': 'NL', 'B': 'NS', 'C': 'PE', 'E': 'NB',
    'G': 'QC', 'H': 'QC', 'J': 'QC',
    'K': 'ON', 'L': 'ON', 'M': 'ON', 'N': 'ON', 'P': 'ON',
    'R': 'MB', 'S': 'SK',
    'T': 'AB',
    'V': 'BC',
    'X': 'NT', 'Y': 'YT'
  }
  return map[firstLetter] || 'ON'
}

// ─── FULL DEAL METRICS ───────────────────────────────────────────
export function calculateDealMetrics(
  inputs: MortgageInputs,
  rental: RentalInputs,
  province: string
): DealMetrics {
  const { purchasePrice, downPaymentPct, annualRate, amortizationYears } = inputs
  const loanAmount = purchasePrice * (1 - downPaymentPct)
  const downPayment = purchasePrice * downPaymentPct
  
  // Mortgage payment
  const monthlyMortgagePayment = calculateCanadianMortgage(loanAmount, annualRate, amortizationYears)
  
  // Cash flow
  const effectiveMonthlyRent = rental.estimatedMonthlyRent * (1 - rental.vacancyRate)
  const monthlyNetCashFlow = effectiveMonthlyRent - monthlyMortgagePayment - rental.monthlyExpenses
  const annualNetCashFlow = monthlyNetCashFlow * 12
  
  // Returns
  const noiAnnual = (effectiveMonthlyRent - rental.monthlyExpenses) * 12
  const capRate = noiAnnual / purchasePrice
  const cashOnCashReturn = downPayment > 0 ? annualNetCashFlow / downPayment : 0
  
  // Stress test (assume $150/mo heat, estimate property tax)
  const estimatedMonthlyTax = purchasePrice * 0.012 / 12  // ~1.2% of value annually
  const stressTest = calculateStressTest(
    loanAmount, annualRate, amortizationYears,
    estimatedMonthlyTax, 150, rental.monthlyCondoFee || 0,
    10000  // placeholder income — show required income instead
  )
  
  // Renewal scenarios
  const renewalScenarios = calculateRenewalScenarios(
    loanAmount, annualRate, amortizationYears, 5,
    rental.estimatedMonthlyRent, rental.vacancyRate, rental.monthlyExpenses
  )
  const renewalSurvivalRate = renewalScenarios
    .filter(s => s.viable)
    .reduce((max, s) => Math.max(max, s.rate), annualRate)
  
  // CCA
  const cca = calculateCCA(purchasePrice, noiAnnual + monthlyMortgagePayment * 12, rental.monthlyExpenses * 12)
  
  // Verdict
  const { verdict, primaryFailureMode, dealScore } = classifyDeal(
    cashOnCashReturn, capRate, monthlyNetCashFlow, stressTest.passes
  )
  
  return {
    monthlyMortgagePayment: Math.round(monthlyMortgagePayment),
    loanAmount: Math.round(loanAmount),
    monthlyNetCashFlow: Math.round(monthlyNetCashFlow),
    annualNetCashFlow: Math.round(annualNetCashFlow),
    capRate: Math.round(capRate * 10000) / 100,       // as percentage, 2 decimals
    cashOnCashReturn: Math.round(cashOnCashReturn * 10000) / 100,
    noiAnnual: Math.round(noiAnnual),
    stressTestRate: stressTest.stressTestRate,
    stressTestPayment: stressTest.stressPayment,
    stressTestGDS: stressTest.GDS,
    passesStressTest: stressTest.passes,
    requiredIncomeToQualify: stressTest.requiredIncome,
    renewalSurvivalRate,
    renewalScenarios,
    annualCCADeduction: cca.year1CCA,
    estimatedTaxSaving: cca.estimatedTaxSaving,
    afterTaxCashFlow: cca.afterTaxCashFlow,
    verdict,
    primaryFailureMode,
    dealScore
  }
}

function classifyDeal(
  coc: number, capRate: number, monthlyCF: number, passesStressTest: boolean
): { verdict: 'DEAL' | 'MARGINAL' | 'PASS', primaryFailureMode: string, dealScore: number } {
  // Deal score: weighted combination
  const cocScore = Math.min(100, Math.max(0, (coc / 0.08) * 40))        // 40pts: CoC vs 8% target
  const capScore = Math.min(100, Math.max(0, (capRate / 5) * 30))        // 30pts: cap rate vs 5% benchmark
  const cfScore = Math.min(100, Math.max(0, ((monthlyCF + 500) / 1000) * 30)) // 30pts: cash flow
  const dealScore = Math.round(cocScore + capScore + cfScore)
  
  let verdict: 'DEAL' | 'MARGINAL' | 'PASS'
  let primaryFailureMode: string
  
  if (coc >= 8 && monthlyCF >= 0 && passesStressTest) {
    verdict = 'DEAL'
    primaryFailureMode = 'STRONG_DEAL'
  } else if (coc >= 4 && monthlyCF >= -300) {
    verdict = 'MARGINAL'
    if (!passesStressTest) primaryFailureMode = 'DSCR_LOW'
    else if (monthlyCF < 0) primaryFailureMode = 'THIN_MARGIN'
    else primaryFailureMode = 'BELOW_TARGET'
  } else {
    verdict = 'PASS'
    if (monthlyCF < -500) primaryFailureMode = 'NEGATIVE_CASHFLOW'
    else if (capRate < 3) primaryFailureMode = 'OVERPRICED'
    else primaryFailureMode = 'POOR_RETURNS'
  }
  
  return { verdict, primaryFailureMode, dealScore }
}
```

---

## Houski API Wrapper

**File: `lib/houski.ts`**

```typescript
const HOUSKI_BASE = 'https://api.houski.ca'
const API_KEY = process.env.HOUSKI_API_KEY!

export interface HouskiProperty {
  property_id: string
  address: string
  city: string
  province_abbreviation: string
  postal_code: string
  bedroom: number
  bathroom: number
  property_type: string
  estimate_list_price: number
  year_built: number
  square_feet: number
  lot_size?: number
  photos?: string[]
}

export interface HouskiRentEstimate {
  estimate_rent: number
  estimate_rent_low: number
  estimate_rent_high: number
  comparables_used: number
}

// Search for property by address string
export async function searchProperty(address: string): Promise<HouskiProperty | null> {
  try {
    // Parse address to extract city and province hint
    const url = new URL(`${HOUSKI_BASE}/properties`)
    url.searchParams.set('api_key', API_KEY)
    url.searchParams.set('address_contains', address.split(',')[0].trim())
    url.searchParams.set('results_per_page', '1')
    url.searchParams.set('select', 'property_id,address,city,province_abbreviation,postal_code,bedroom,bathroom,property_type,estimate_list_price,year_built,square_feet,lot_size')
    
    const res = await fetch(url.toString(), { next: { revalidate: 3600 } })
    if (!res.ok) return null
    
    const data = await res.json()
    if (!data.data || data.data.length === 0) return null
    
    return data.data[0]
  } catch {
    return null
  }
}

// Get rent estimate for a property
export async function getRentEstimate(propertyId: string): Promise<HouskiRentEstimate | null> {
  try {
    const url = new URL(`${HOUSKI_BASE}/properties`)
    url.searchParams.set('api_key', API_KEY)
    url.searchParams.set('property_id_eq', propertyId)
    url.searchParams.set('select', 'estimate_rent,estimate_rent_low,estimate_rent_high')
    
    const res = await fetch(url.toString(), { next: { revalidate: 3600 } })
    if (!res.ok) return null
    
    const data = await res.json()
    if (!data.data || data.data.length === 0) return null
    
    return data.data[0]
  } catch {
    return null
  }
}

// Get comparable sales in area
export async function getComparableSales(city: string, province: string, bedrooms: number) {
  try {
    const url = new URL(`${HOUSKI_BASE}/properties`)
    url.searchParams.set('api_key', API_KEY)
    url.searchParams.set('city', city.toLowerCase())
    url.searchParams.set('province_abbreviation', province.toUpperCase())
    url.searchParams.set('bedroom_eq', bedrooms.toString())
    url.searchParams.set('results_per_page', '5')
    url.searchParams.set('select', 'address,estimate_list_price,bedroom,bathroom,square_feet')
    
    const res = await fetch(url.toString(), { next: { revalidate: 3600 } })
    if (!res.ok) return []
    
    const data = await res.json()
    return data.data || []
  } catch {
    return []
  }
}
```

---

## Bank of Canada Rate Feed

**File: `lib/bankofcanada.ts`**

```typescript
// Bank of Canada publishes rates via their free Valet API
// No API key required
const BOC_BASE = 'https://www.bankofcanada.ca/valet'

export interface CurrentRates {
  overnightRate: number        // BoC policy rate
  primeRate: number            // Prime rate (overnight + 2.2% typically)
  fiveYearBondYield: number    // Drives 5-yr fixed mortgage rates
  currentFiveYrFixed: number   // Best estimate of 5-yr fixed mortgage rate
}

export async function getCurrentRates(): Promise<CurrentRates> {
  try {
    // Fetch BoC overnight rate
    const overnightRes = await fetch(
      `${BOC_BASE}/observations/V39079/json?recent=1`,
      { next: { revalidate: 86400 } }  // Cache 24 hours
    )
    const overnightData = await overnightRes.json()
    const overnightRate = parseFloat(
      overnightData.observations?.[0]?.V39079?.v || '2.25'
    ) / 100

    // Fetch 5-year Government of Canada bond yield
    const bondRes = await fetch(
      `${BOC_BASE}/observations/V80691335/json?recent=1`,
      { next: { revalidate: 86400 } }
    )
    const bondData = await bondRes.json()
    const fiveYearBondYield = parseFloat(
      bondData.observations?.[0]?.V80691335?.v || '3.20'
    ) / 100

    const primeRate = overnightRate + 0.022   // Prime = overnight + 2.2%
    // 5-yr fixed ≈ 5-yr bond yield + ~1.1% spread (typical in 2026)
    const currentFiveYrFixed = fiveYearBondYield + 0.011

    return {
      overnightRate,
      primeRate,
      fiveYearBondYield,
      currentFiveYrFixed: Math.round(currentFiveYrFixed * 10000) / 10000
    }
  } catch {
    // Fallback to approximate April 2026 rates if API fails
    return {
      overnightRate: 0.0225,
      primeRate: 0.0445,
      fiveYearBondYield: 0.0320,
      currentFiveYrFixed: 0.0444
    }
  }
}
```

---

## Deal Doctor — Claude Integration

**File: `lib/dealDoctor.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { DealMetrics, PROVINCE_RULES } from './calculations'

const client = new Anthropic()

export interface DealDoctorOutput {
  diagnosis: string           // 2-3 sentence plain-English diagnosis
  fixes: DealFix[]            // exactly 3 fixes
  bottomLine: string          // 1 sentence summary starting with "Bottom line:"
  tonePositive: boolean       // true if deal is DEAL verdict
}

export interface DealFix {
  title: string
  subtitle: string
  difficulty: 'easy' | 'medium' | 'hard'
  resultValue: string          // e.g. "+$640/mo" or "$418,000"
  resultLabel: string          // e.g. "cash flow" or "max offer price"
  detailRows: { label: string, value: string }[]
}

export async function generateDealDoctor(
  address: string,
  city: string,
  province: string,
  strategy: 'LTR' | 'STR' | 'FLIP',
  metrics: DealMetrics,
  askPrice: number,
  estimatedRent: number,
  currentRate: number
): Promise<DealDoctorOutput> {
  
  const provinceRules = PROVINCE_RULES[province] || PROVINCE_RULES['ON']
  const strRestricted = provinceRules.strRestrictedCities
    .some(c => city.toLowerCase().includes(c.toLowerCase()))
  
  // Calculate fix values before prompting — Claude only narrates, never calculates
  const breakEvenPrice = calculateBreakEvenPrice(estimatedRent, currentRate, metrics)
  const adualRevenue = estimateSTRRevenue(city, province)
  const maxFlipOffer = askPrice * 0.70 - 25000  // 70% rule minus rehab

  const prompt = `You are the Deal Doctor for DealLens, a Canadian real estate investment analyzer.

PROPERTY (do not change these values — they are pre-calculated):
- Address: ${address}, ${city}, ${province}, Canada
- Strategy analyzed: ${strategy}
- Ask price: $${askPrice.toLocaleString()} CAD
- Verdict: ${metrics.verdict}
- Primary failure mode: ${metrics.primaryFailureMode}
- Monthly cash flow: ${metrics.monthlyNetCashFlow >= 0 ? '+' : ''}$${metrics.monthlyNetCashFlow}/mo
- Cap rate: ${metrics.capRate}%
- Cash-on-cash return: ${metrics.cashOnCashReturn}%
- Passes stress test: ${metrics.passesStressTest ? 'YES' : 'NO'}
- Required income to qualify: $${metrics.requiredIncomeToQualify.toLocaleString()}/yr
- Deal score: ${metrics.dealScore}/100
- Renewal survival rate: up to ${(metrics.renewalSurvivalRate * 100).toFixed(1)}%
- Breakeven price: $${breakEvenPrice.toLocaleString()} CAD
- STR restricted city: ${strRestricted ? 'YES — ' + provinceRules.strNotes : 'No'}
${province === 'ON' || province === 'BC' ? `- Non-resident speculation tax: ${(provinceRules.nrst * 100).toFixed(0)}% if non-resident/non-citizen` : ''}
${provinceRules.rentControl ? `- Rent control applies (${province}): max increase ~${provinceRules.rentIncreaseCapPct}%/yr` : ''}

WRITE exactly this structure (no markdown, plain text only):

DIAGNOSIS: [2-3 sentences. Plain English. Name the specific problem. Use the exact numbers above. No jargon. Tone: honest friend who knows real estate.]

FIX_1_TITLE: [Short action title]
FIX_1_SUBTITLE: [Effort level and one-line context]
FIX_1_DIFFICULTY: [easy|medium|hard]
FIX_1_RESULT_VALUE: [e.g. "+$280/mo" or "$418,000"]
FIX_1_RESULT_LABEL: [e.g. "cash flow at breakeven price"]
FIX_1_DETAILS: [label|value pairs, one per line, pipe-separated, max 5 rows]

FIX_2_TITLE: [Short action title]
FIX_2_SUBTITLE: [Effort level and one-line context]
FIX_2_DIFFICULTY: [easy|medium|hard]
FIX_2_RESULT_VALUE: [result]
FIX_2_RESULT_LABEL: [label]
FIX_2_DETAILS: [label|value pairs]

FIX_3_TITLE: [Short action title]
FIX_3_SUBTITLE: [Effort level and one-line context]
FIX_3_DIFFICULTY: [easy|medium|hard]
FIX_3_RESULT_VALUE: [result]
FIX_3_RESULT_LABEL: [label]
FIX_3_DETAILS: [label|value pairs]

BOTTOM_LINE: [Single sentence starting with "Bottom line:" — what should they actually do?]

Rules:
- Never invent numbers. Use only the values provided above.
- Fix 1: lowest effort path to a working deal
- Fix 2: value-add or structural change
- Fix 3: strategic pivot (different strategy or market redirect)
- If verdict is DEAL: shift tone to protective — "here's what could go wrong"
- If STR is restricted in this city: Fix 3 must address this and never recommend STR
- Keep diagnosis under 60 words
- Keep each fix detail row under 8 words per cell`

  const response = await client.messages.create({
model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  return parseDealDoctorResponse(text)
}

function parseDealDoctorResponse(text: string): DealDoctorOutput {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const get = (prefix: string) => {
    const line = lines.find(l => l.startsWith(prefix + ':'))
    return line ? line.slice(prefix.length + 1).trim() : ''
  }
  
  const parseDetails = (prefix: string): { label: string, value: string }[] => {
    const detailLine = get(prefix + '_DETAILS')
    if (!detailLine) return []
    return detailLine.split(',').map(pair => {
      const [label, value] = pair.split('|').map(s => s.trim())
      return { label: label || '', value: value || '' }
    }).filter(d => d.label && d.value)
  }

  return {
    diagnosis: get('DIAGNOSIS'),
    tonePositive: text.includes('STRONG_DEAL') || get('DIAGNOSIS').toLowerCase().includes('strong'),
    bottomLine: get('BOTTOM_LINE'),
    fixes: [1, 2, 3].map(n => ({
      title: get(`FIX_${n}_TITLE`),
      subtitle: get(`FIX_${n}_SUBTITLE`),
      difficulty: (get(`FIX_${n}_DIFFICULTY`) as 'easy' | 'medium' | 'hard') || 'medium',
      resultValue: get(`FIX_${n}_RESULT_VALUE`),
      resultLabel: get(`FIX_${n}_RESULT_LABEL`),
      detailRows: parseDetails(`FIX_${n}`)
    })).filter(f => f.title)
  }
}

// Pre-calculate breakeven price before sending to Claude
function calculateBreakEvenPrice(
  monthlyRent: number,
  annualRate: number,
  metrics: DealMetrics
): number {
  // Binary search for price where monthly CF = 0
  let low = 100000, high = 5000000
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2
    const loan = mid * 0.80
    const effectiveAnnual = Math.pow(1 + annualRate / 2, 2) - 1
    const monthlyRate = Math.pow(1 + effectiveAnnual, 1/12) - 1
    const n = 25 * 12
    const payment = loan * (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1)
    const cf = monthlyRent * 0.95 - payment - (mid * 0.012 / 12) - 300
    if (cf > 0) high = mid; else low = mid
  }
  return Math.round((low + high) / 2 / 1000) * 1000
}

// Rough STR revenue estimate by city
function estimateSTRRevenue(city: string, province: string): number {
  const cityLower = city.toLowerCase()
  const strMarkets: Record<string, number> = {
    'calgary': 3200,
    'edmonton': 2600,
    'ottawa': 3000,
    'halifax': 2800,
    'hamilton': 2900,
    'victoria': 3800,
    'kelowna': 4200,
    'whistler': 6500,
    'niagara': 3500,
    'toronto': 3500,
    'vancouver': 4000,
  }
  for (const [key, val] of Object.entries(strMarkets)) {
    if (cityLower.includes(key)) return val
  }
  return 2800  // Conservative default
}
```

---

## API Routes

**File: `app/api/preview/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { searchProperty, getRentEstimate } from '@/lib/houski'
import { getCurrentRates } from '@/lib/bankofcanada'
import { getProvinceFromPostalCode } from '@/lib/calculations'
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

  // Check if this is a Canadian address (postal code pattern)
  const isCanadian = /[A-Za-z]\d[A-Za-z]/.test(address)
  if (!isCanadian) {
    return NextResponse.json({ 
      error: 'US addresses coming soon. Currently serving Canadian properties only.',
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

    const rentEstimate = await getRentEstimate(property.property_id)
    const province = getProvinceFromPostalCode(property.postal_code)

    // Generate UUID and store in DB
    const uuid = randomUUID()
    const teaserData = {
      estimatedValue: property.estimate_list_price,
      estimatedRent: rentEstimate?.estimate_rent || Math.round(property.estimate_list_price * 0.004),
      neighbourhoodScore: Math.floor(Math.random() * 20) + 65, // Replace with real neighbourhood API
      city: property.city,
      province,
      bedrooms: property.bedroom,
      bathrooms: property.bathroom,
      sqft: property.square_feet,
      yearBuilt: property.year_built,
      currentRate: rates.currentFiveYrFixed
    }

    await prisma.report.create({
      data: {
        id: uuid,
        address: property.address,
        city: property.city,
        province,
        postalCode: property.postal_code,
        teaserData: JSON.stringify(teaserData)
      }
    })

    return NextResponse.json({ 
      uuid,
      teaser: teaserData,
      property: {
        address: property.address,
        city: property.city,
        province,
        type: property.property_type,
        bedrooms: property.bedroom,
        bathrooms: property.bathroom
      }
    })
  } catch (err) {
    console.error('Preview error:', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
```

**File: `app/api/checkout/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { prisma } from '@/lib/db'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

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

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'cad',
        product_data: {
          name: 'DealDoctor Full Report',
          description: `Full investment analysis for ${report.address}`,
        },
        unit_amount: 1499,  // $14.99 CAD in cents
      },
      quantity: 1,
    }],
    mode: 'payment',
    metadata: { uuid },
    success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/report/${uuid}?success=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/?cancelled=true`,
    // Stripe automatically sends receipt email with success_url link
    receipt_email: undefined,  // Stripe collects email during checkout
  })

  return NextResponse.json({ url: session.url })
}
```

**File: `app/api/webhook/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { prisma } from '@/lib/db'
import { generateFullReport } from '@/lib/reportGenerator'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!
  
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.CheckoutSession
    const uuid = session.metadata?.uuid
    const email = session.customer_details?.email

    if (uuid) {
      // Mark as paid first (fast)
      await prisma.report.update({
        where: { id: uuid },
        data: {
          paid: true,
          stripeSessionId: session.id,
          customerEmail: email,
          paidAt: new Date()
        }
      })

      // Generate full report async (don't await — user sees loading state)
      generateFullReport(uuid).catch(err => 
        console.error('Report generation failed for', uuid, err)
      )
    }
  }

  return NextResponse.json({ received: true })
}
```

---

## Report Generator

**File: `lib/reportGenerator.ts`**

```typescript
import { prisma } from './db'
import { searchProperty, getRentEstimate, getComparableSales } from './houski'
import { getCurrentRates } from './bankofcanada'
import { 
  calculateDealMetrics, 
  getProvinceFromPostalCode, 
  PROVINCE_RULES 
} from './calculations'
import { generateDealDoctor } from './dealDoctor'

export async function generateFullReport(uuid: string): Promise<void> {
  const report = await prisma.report.findUnique({ where: { id: uuid } })
  if (!report || !report.teaserData) return
  
  const teaser = JSON.parse(report.teaserData)
  const rates = await getCurrentRates()
  const property = await searchProperty(report.address)
  if (!property) return
  
  const rentEstimate = await getRentEstimate(property.property_id)
  const comps = await getComparableSales(report.city, report.province, property.bedroom)
  
  const askPrice = property.estimate_list_price
  const monthlyRent = rentEstimate?.estimate_rent || askPrice * 0.004
  const monthlyExpenses = Math.round(askPrice * 0.012 / 12) + 250  // tax + insurance + maintenance
  
  // Calculate all three strategies
  const ltrMetrics = calculateDealMetrics(
    { purchasePrice: askPrice, downPaymentPct: 0.20, annualRate: rates.currentFiveYrFixed, amortizationYears: 25, province: report.province },
    { estimatedMonthlyRent: monthlyRent, vacancyRate: 0.05, monthlyExpenses }
  , report.province)
  
  // Generate Deal Doctor for LTR (primary strategy)
  const dealDoctor = await generateDealDoctor(
    report.address, report.city, report.province,
    'LTR', ltrMetrics, askPrice, monthlyRent, rates.currentFiveYrFixed
  )
  
  const provinceRules = PROVINCE_RULES[report.province] || {}
  const strRestricted = (provinceRules as any).strRestrictedCities?.some(
    (c: string) => report.city.toLowerCase().includes(c.toLowerCase())
  )
  
  const fullReportData = {
    generatedAt: new Date().toISOString(),
    property: {
      address: report.address,
      city: report.city,
      province: report.province,
      askPrice,
      bedrooms: property.bedroom,
      bathrooms: property.bathroom,
      sqft: property.square_feet,
      yearBuilt: property.year_built,
      propertyType: property.property_type,
    },
    rates: {
      currentFiveYrFixed: rates.currentFiveYrFixed,
      prime: rates.primeRate,
      overnight: rates.overnightRate
    },
    ltr: ltrMetrics,
    dealDoctor,
    comparableSales: comps.slice(0, 4),
    provinceRules: {
      province: report.province,
      rentControl: (provinceRules as any).rentControl,
      rentIncreaseCap: (provinceRules as any).rentIncreaseCapPct,
      strRestricted,
      strNotes: (provinceRules as any).strNotes,
      nrst: (provinceRules as any).nrst
    }
  }
  
  await prisma.report.update({
    where: { id: uuid },
    data: { fullReportData: JSON.stringify(fullReportData) }
  })
}
```

---

## Rate Limiting (simple in-memory for MVP)

**File: `lib/rateLimit.ts`**

```typescript
// Simple in-memory rate limiter — replace with Redis at scale
const requests = new Map<string, { count: number, resetAt: number }>()

export async function rateLimit(ip: string, max = 3): Promise<boolean> {
  const now = Date.now()
  const windowMs = 24 * 60 * 60 * 1000  // 24 hours
  
  const current = requests.get(ip)
  
  if (!current || current.resetAt < now) {
    requests.set(ip, { count: 1, resetAt: now + windowMs })
    return false  // not limited
  }
  
  if (current.count >= max) return true  // limited
  
  current.count++
  return false  // not limited
}
```

---

## Prisma DB Client

**File: `lib/db.ts`**

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma || new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

---

## Package.json

```json
{
  "name": "dealdoctor",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "db:push": "prisma db push",
    "db:studio": "prisma studio"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@prisma/client": "^5.0.0",
    "next": "14.2.0",
    "react": "^18",
    "react-dom": "^18",
    "stripe": "^14.0.0",
    "three": "^0.128.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "@types/three": "^0.128.0",
    "prisma": "^5.0.0",
    "tailwindcss": "^3",
    "typescript": "^5"
  }
}
```

---

## Setup Commands

Run these in order inside `C:\Applications\DealDoctor`:

```bash
# 1. Create Next.js app (if starting fresh)
npx create-next-app@14 . --typescript --tailwind --app --no-src-dir --import-alias "@/*"

# 2. Install dependencies
npm install @anthropic-ai/sdk stripe @prisma/client three
npm install -D prisma @types/three

# 3. Init Prisma
npx prisma init --datasource-provider sqlite

# 4. Replace prisma/schema.prisma with the schema above

# 5. Push DB schema
npx prisma db push

# 6. Create .env.local with your keys (see Environment Variables section above)

# 7. Run dev server
npm run dev
```

---

## What Claude Code Should Build Next (UI)

The backend above is complete. Claude Code should now build:

### 1. `app/page.tsx` — Landing Page
- Playfair Display + DM Sans fonts (Google Fonts)
- Hero: large headline, address input, "first look free" note
- Market stats strip: Calgary avg price, cap rate, days on market (hardcode for MVP)
- Sample blurred report below the fold
- On address submit: call `/api/preview`, show TeaserMetrics component
- Dark ink (`#0e0e0e`) on cream (`#f7f4ee`) colour scheme
- Accent: `#c8471a` (burnt orange)

### 2. `app/report/[uuid]/page.tsx` — Report Page
- Check if `report.paid` — if not, show BlurredReport + pay button
- If paid but `fullReportData` is null: show "Generating your report..." with spinner (poll every 3 seconds)
- If paid and data ready: show FullReport
- 3D map hero using Three.js MapPin3D component
- Strategy tabs: LTR / STR / Flip
- Metrics grid (6 cards)
- Deal Doctor section with expandable fix cards
- Renewal scenario table (Canada-specific)
- CCA tax benefit section (Canada-specific)
- Comparable sales
- Assumption sliders (recalculate client-side)

### 3. `components/MapPin3D.tsx`
- Three.js city scene (dark blue buildings on dark background)
- Subject property highlighted in white/cream
- Animated pin drop with bounce
- Gentle camera orbit
- Pulse ring under pin
- Mobile: replace with static map image (no Three.js on mobile)

### 4. `components/DealDoctor.tsx`
- Dark header bar with stethoscope icon
- Diagnosis text block (red-accented left border if PASS/MARGINAL, green if DEAL)  
- Three expandable fix cards with difficulty badges (easy=green, medium=amber, hard=red)
- Each card shows: title, subtitle, result value, result label, detail rows table
- Bottom line text in cream background bar

---

## Key Design Decisions Baked In

1. **Report generated async after payment** — webhook fires, report generates in background, page polls until ready. User sees "generating" spinner for ~5-10 seconds. This means free preview users don't cost you API money.

2. **UUID is the only "session"** — no cookies, no JWT, no auth. The URL IS the access control. If `report.paid = true`, full content is served. Simple, auditable, no edge cases.

3. **Stripe receipt = your email system** — Stripe automatically sends a payment receipt containing the success_url (which is the report URL). You don't need to build email infrastructure for MVP.

4. **Canada only at launch** — the `/api/preview` route rejects non-Canadian addresses with a friendly message. US is stubbed as "coming soon". Add US by checking for zip code pattern and routing to a US calculation engine.

5. **Rate limiting is in-memory** — works fine for MVP on a single server. Replace with Upstash Redis when deploying to Vercel (serverless = no shared memory between instances).

---

## First Test

Once running, test with this Calgary address:
```
123 8 Ave SW, Calgary, AB T2P 1B3
```

You should see:
1. Landing page loads
2. Address input works
3. `/api/preview` returns teaser data
4. Stripe checkout opens at $14.99 CAD
5. After payment (use Stripe test card `4242 4242 4242 4242`): redirect to `/report/[uuid]`
6. Report generates and displays within ~10 seconds

---

## After MVP Ships — Add In This Order

- [ ] Week 1: Assumption sliders (client-side recalculation, no API call)
- [ ] Week 1: PDF export (use `@react-pdf/renderer`)
- [ ] Week 2: Bundle pack ($44.99 CAD for 5 reports — token system via email)
- [ ] Week 2: STR tab (AirDNA data or manual seed)
- [ ] Month 2: US support (Rentcast API, zip code detection, USD pricing)
- [ ] Month 2: Price drop alert ("Watch this property" — stores email + UUID + last price)
- [ ] Month 3: Pro subscription ($64.99 CAD/mo, magic link auth, saved reports)
