import { GoogleGenerativeAI } from '@google/generative-ai'
import { DealMetrics, STATE_RULES } from './calculations'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

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
  currentRate: number
): Promise<DealDoctorOutput> {

  const stateRules = STATE_RULES[state] || STATE_RULES['TX']

  // Calculate fix values before prompting — Claude only narrates, never calculates
  const breakEvenPrice = calculateBreakEvenPrice(estimatedRent, currentRate)
  const strRevenue = estimateSTRRevenue(city, state)
  const maxFlipOffer = askPrice * 0.70 - 25000  // 70% rule minus rehab

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
- Estimated STR revenue: $${strRevenue.toLocaleString()}/mo
- Max flip offer (70% rule): $${maxFlipOffer.toLocaleString()} USD
${stateRules.rentControl ? `- Rent control state: ${stateRules.name}` : ''}
- Landlord-friendly: ${stateRules.landlordFriendly ? 'Yes' : 'No'}
- STR rules: ${stateRules.strNotes}
- Approx property tax rate: ${(stateRules.propertyTaxRate * 100).toFixed(1)}%

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
- Keep diagnosis under 60 words
- Keep each fix detail row under 8 words per cell`

  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
  const result = await model.generateContent(prompt)
  const text = result.response.text()
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

function calculateBreakEvenPrice(
  monthlyRent: number,
  annualRate: number,
): number {
  let low = 50000, high = 3000000
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2
    const loan = mid * 0.80
    const monthlyRate = annualRate / 12
    const n = 30 * 12
    const payment = loan * (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1)
    const cf = monthlyRent * 0.95 - payment - (mid * 0.015 / 12) - 250
    if (cf > 0) high = mid; else low = mid
  }
  return Math.round((low + high) / 2 / 1000) * 1000
}

function estimateSTRRevenue(city: string, _state: string): number {
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
  for (const [key, val] of Object.entries(strMarkets)) {
    if (cityLower.includes(key)) return val
  }
  return 2500
}
