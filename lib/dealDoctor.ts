import Anthropic from '@anthropic-ai/sdk'
import { DealMetrics, STATE_RULES, calculateBreakEvenPrice } from './calculations'
import type { ClimateAndInsurance } from './climateRisk'

// Claude Haiku 4.5 — cheap, fast, high-quality narration. See rationale in
// memory/project_positioning_and_ai.md. ~$0.005 per report at typical prompt size.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL_ID = 'claude-haiku-4-5-20251001'

export interface DealDoctorOutput {
  diagnosis: string
  fixes: DealFix[]
  bottomLine: string
  tonePositive: boolean
}

export interface DealFix {
  title: string
  subtitle: string
  difficulty: 'easy' | 'medium' | 'hard'
  resultValue: string
  resultLabel: string
  detailRows: { label: string, value: string }[]
}

export async function generateDealDoctor(
  address: string,
  city: string,
  state: string,
  strategy: 'LTR' | 'STR' | 'FLIP',
  metrics: DealMetrics,
  askPrice: number,
  estimatedRent: number,
  currentRate: number,
  climate?: ClimateAndInsurance,
  bedrooms?: number,
  arvEstimate?: number,
  rehabBudget?: number
): Promise<DealDoctorOutput> {

  const stateRules = STATE_RULES[state] || STATE_RULES['TX']

  // Calculate fix values before prompting — the model only narrates, never calculates
  const breakEvenPrice = calculateBreakEvenPrice(estimatedRent, currentRate)
  const strRevenue = estimateSTRRevenue(city, state, bedrooms)
  // 70% rule: max offer = (ARV × 0.70) − rehab. ARV should come from sale comps,
  // not from listing price (avoids circular "this deal pencils at its own ask").
  const arv = arvEstimate && arvEstimate > 0 ? arvEstimate : askPrice
  const rehab = rehabBudget && rehabBudget > 0 ? rehabBudget : 25000
  const maxFlipOffer = Math.round(arv * 0.70 - rehab)

  // Climate & insurance facts — pass as plain strings to the prompt so the model
  // can anchor fixes in property-specific reality (e.g. "your $6k/yr FL insurance...")
  const climateFacts: string[] = []
  if (climate) {
    climateFacts.push(`- Estimated annual insurance: $${climate.estimatedAnnualInsurance.toLocaleString()}/yr (~$${Math.round(climate.estimatedAnnualInsurance / 12).toLocaleString()}/mo)`)
    if (climate.floodZone) {
      climateFacts.push(`- FEMA flood zone: ${climate.floodZone}${climate.floodInsuranceRequired ? ' — NFIP flood insurance MANDATORY (separate policy)' : ''}`)
    }
    if (climate.topConcerns.length > 0) {
      climateFacts.push(`- Top climate risks: ${climate.topConcerns.join(', ')}`)
    }
  }
  const climateBlock = climateFacts.length > 0
    ? `\nCLIMATE & INSURANCE (material to this deal — reference specifically if it affects cash flow or risk):\n${climateFacts.join('\n')}`
    : ''

  const prompt = `You are the Deal Doctor for DealDoctor, a US real estate investment analyzer.

PROPERTY (do not change these values — they are pre-calculated):
- Address: ${address}, ${city}, ${state}, USA
- Strategy analyzed: ${strategy}
- Ask price: $${askPrice.toLocaleString()} USD
- Verdict: ${metrics.verdict}
- Primary failure mode: ${metrics.primaryFailureMode}
- Monthly cash flow: ${metrics.monthlyNetCashFlow >= 0 ? '+' : ''}$${metrics.monthlyNetCashFlow}/mo
- Cap rate: ${metrics.capRate}%
- Cash-on-cash return: ${metrics.cashOnCashReturn}%
- DSCR: ${metrics.dscr} (lenders want >= 1.25)
- LTV: ${(metrics.ltv * 100).toFixed(0)}%
- Deal score: ${metrics.dealScore}/100
- Refi survival rate: up to ${(metrics.renewalSurvivalRate * 100).toFixed(1)}%
- Breakeven price: $${breakEvenPrice.toLocaleString()} USD
- Estimated STR revenue: $${strRevenue.toLocaleString()}/mo${bedrooms ? ` (${bedrooms}-bed assumption)` : ''}
- ARV (from sale comps): $${arv.toLocaleString()} USD
- Max flip offer (70% rule, ARV-based): $${maxFlipOffer.toLocaleString()} USD
${stateRules.rentControl ? `- Rent control state: ${stateRules.name}` : ''}
- Landlord-friendly: ${stateRules.landlordFriendly ? 'Yes' : 'No'}
- STR rules: ${stateRules.strNotes}
- Approx property tax rate: ${(stateRules.propertyTaxRate * 100).toFixed(1)}%
${climateBlock}

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
- If insurance > $300/mo OR flood insurance is mandatory: one of the fixes MUST address insurance cost directly (shop carriers, raise deductible, appeal flood zone via elevation certificate).
- If a climate risk is listed as top concern: the diagnosis OR one fix must acknowledge it (e.g. hurricane → windstorm deductible reality, wildfire → defensible-space insurability, heat → HVAC cost, tornado → structural upgrades for insurability).
- If verdict is DEAL: shift tone to protective — "here's what could go wrong"
- Keep diagnosis under 60 words
- Keep each fix detail row under 8 words per cell`

  const result = await anthropic.messages.create({
    model: MODEL_ID,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = result.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((b) => b.text)
    .join('\n')
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

// STR revenue estimate — city baseline is for a 2BR; we scale by bedroom count
// because a 1BR/studio rents for much less than a 4BR family rental in the same city.
// Multipliers roughly track AirDNA market medians: ~+30% per bedroom above 2BR,
// ~-25% per bedroom below 2BR. Not an appraisal — gives the AI a defensible anchor.
// Exported for unit testing; still called internally by generateDealDoctor.
export function estimateSTRRevenue(city: string, _state: string, bedrooms?: number): number {
  const cityLower = city.toLowerCase()
  const strMarkets: Record<string, number> = {
    'austin': 3500,
    'nashville': 3800,
    'miami': 4500,
    'orlando': 3200,
    'phoenix': 3000,
    'denver': 3600,
    'las vegas': 3400,
    'san diego': 4200,
    'los angeles': 4800,
    'new york': 5500,
    'chicago': 3000,
    'dallas': 3200,
    'houston': 2800,
    'atlanta': 3000,
    'tampa': 3100,
    'charlotte': 2900,
    'seattle': 4000,
    'portland': 3200,
    'columbus': 2400,
    'indianapolis': 2200,
    'jacksonville': 2600,
    'san antonio': 2500,
  }
  let baseline = 2500
  for (const [key, val] of Object.entries(strMarkets)) {
    if (cityLower.includes(key)) { baseline = val; break }
  }
  // Only skip the multiplier when bedroom count is truly unspecified.
  // 0 = studio and should apply the 0.55× multiplier, not short-circuit.
  if (bedrooms == null || bedrooms < 0) return baseline

  // Baseline assumes 2BR. Scale from there.
  const BEDROOM_MULTIPLIERS: Record<number, number> = {
    0: 0.55, // studio
    1: 0.75,
    2: 1.0,
    3: 1.3,
    4: 1.6,
    5: 1.9,
    6: 2.2,
  }
  const clamped = Math.max(0, Math.min(6, bedrooms))
  const multiplier = BEDROOM_MULTIPLIERS[clamped] ?? 1.0
  return Math.round(baseline * multiplier)
}
