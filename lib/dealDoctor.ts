import Anthropic from '@anthropic-ai/sdk'
import { DealMetrics, calculateBreakEvenPrice, getJurisdictionRules } from './calculations'
import type { ClimateAndInsurance } from './climateRisk'

// Claude Haiku 4.5 — cheap, fast, high-quality narration. See rationale in
// memory/project_positioning_and_ai.md. ~$0.005 per report at typical prompt size.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
// Narrative author. Swapped from claude-haiku-4-5 → claude-sonnet-4-6 after
// pressure-test showed the Haiku+Sonnet-reviewer loop failed to converge on
// 9/10 reports (rewrites introduced new bugs faster than they fixed old
// ones). Sonnet as the direct author writes a one-shot narrative with tighter
// constraint-following, eliminating the noisy review loop. Same Anthropic
// provider, same API key — just a different model string.
const MODEL_ID = 'claude-sonnet-4-6'

export interface DealDoctorOutput {
  diagnosis: string
  fixes: DealFix[]
  bottomLine: string
  tonePositive: boolean
  pros: string[]
  cons: string[]
  negotiationLevers: { lever: string; script: string }[]
  inspectionRedFlags: { area: string; why: string }[]
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
  rehabBudget?: number,
  canonicalBreakEvenPrice?: number,     // when provided, used verbatim — ensures the AI narrates the SAME breakeven number the hero + Recommended Offers sections show
  // Subject property structural facts. Without these, Claude makes up
  // "older urban row home" for any DC / east-coast condo address (audit:
  // The Apolline, a 1963 high-rise condo, was described as a row home).
  // Pass propertyType / yearBuilt / sqft explicitly so the narrative and
  // inspection-red-flag suggestions anchor to the actual structure.
  propertyType?: string | null,
  yearBuilt?: number | null,
  squareFeet?: number | null,
  // True when the jurisdiction broadly prohibits non-owner-occupied STR for
  // an investor buyer (Baltimore §5A, NYC Local Law 18). When set, the AI
  // must NOT cite STR as a pro, feasible strategy, or pivot fix — STR
  // revenue is legally moot for an investor in these markets.
  strProhibited?: boolean,
  // STR projection net monthly cash flow AFTER the 43% variable opex load
  // and STR-specific insurance bump — the apples-to-apples number to
  // compare against LTR's monthly net cash flow. When this is worse than
  // LTR, the AI must NOT recommend STR as a pivot fix. Previous audits
  // (Chicago 1720 S Michigan) caught the narrative citing STR gross of
  // $2,250 as a +$50/mo win when the STR comparison section elsewhere in
  // the report had already shown STR net at -$725/mo with LTR winning by
  // $705/mo.
  strNetMonthlyCashFlow?: number | null,
  // Reviewer corrections for a rewrite pass. When the Sonnet reviewer flags
  // narrative issues (hallucinated figures, rent-control claims contradicting
  // the flag, STR cherry-pick, property-type drift, etc.) this array is
  // injected into the prompt so the second-pass generator knows what NOT to
  // repeat. Empty / undefined on the first pass.
  reviewCorrections?: Array<{ section: string; claim: string; reason: string; correction?: string }>,
  // Invariant-gate WARN flags. Deterministic contradictions caught pre-AI
  // by runInvariantCheck — forwarded here as hard constraints so the
  // narrative doesn't re-assert math the gate already flagged as suspect
  // (e.g. DSCR outside plausible band, implausible GRM, HOA/rent ratio).
  // FAIL-severity flags never reach this function — they throw upstream.
  validationFlags?: Array<{ code: string; message: string; actual?: string; expected?: string }>,
): Promise<DealDoctorOutput> {

  // Use the city-aware jurisdiction rules so Baltimore's 2.248% tax and §5A
  // STR notes reach the prompt instead of the statewide MD defaults (1.0%
  // tax, generic STR notes). Falls back to the state rule when the city
  // has no override entry.
  const stateRules = getJurisdictionRules(state, city)

  // Prefer the caller's canonical breakeven (derived from the full expense
  // stack via calculateRecommendedOffers) over re-solving with solver defaults.
  // Previously the AI narrated its own breakeven number, which drifted from
  // the hero/recommended-offers figure — three different breakevens in one
  // report (Queens, Old Westbury, Blacksburg audits).
  const breakEvenPrice =
    canonicalBreakEvenPrice && canonicalBreakEvenPrice > 0
      ? canonicalBreakEvenPrice
      : calculateBreakEvenPrice(estimatedRent, currentRate)
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

  // Build a reviewer-corrections block when this is a rewrite pass. Sonnet
  // flagged specific narrative problems in the previous draft — surface them
  // at the top of the prompt so Haiku's second attempt directly addresses
  // each one instead of repeating the same mistake.
  const correctionsBlock =
    reviewCorrections && reviewCorrections.length > 0
      ? `\n⚠ REWRITE PASS — prior draft was flagged by the reviewer. Fix ALL of the following in this output. Do NOT repeat the same mistakes.\n${reviewCorrections
          .map(
            (c, i) =>
              `  ${i + 1}. [${c.section}] ${c.claim}\n     ← why wrong: ${c.reason}${
                c.correction ? `\n     ← correct to: ${c.correction}` : ''
              }`
          )
          .join('\n')}\n`
      : ''

  // Pre-AI invariant WARN flags. These are hard constraints, not suggestions:
  // the deterministic gate already found these figures suspect. The narrative
  // must not re-assert them confidently.
  const validationFlagsBlock =
    validationFlags && validationFlags.length > 0
      ? `\nVALIDATION FLAGS (hard constraints — the math gate flagged these before you ran. Do NOT narrate past them, do NOT restate the flagged figure as a strength, and surface the caveat in diagnosis / cons where it materially affects the recommendation):\n${validationFlags
          .map(
            (f, i) =>
              `  ${i + 1}. [${f.code}] ${f.message}${
                f.actual ? ` (actual: ${f.actual}${f.expected ? `, expected: ${f.expected}` : ''})` : ''
              }`
          )
          .join('\n')}\n`
      : ''

  // When breakeven is at or above ask, the deal already works at the listing
  // price — there is no "price reduction to $X" story to tell, and framing
  // breakeven as a lower target actively misleads the buyer (audit: 414 Water
  // St Baltimore, where breakeven $308k was narrated as a target below a
  // $206k ask). Swap in guidance that forbids any "target price" below ask
  // and redirects negotiation energy to concessions / rate buy-downs.
  const dealWorksAtAsk = breakEvenPrice >= askPrice
  const negotiationLock = dealWorksAtAsk
    ? `HARD LOCK — NEGOTIATION / TARGET PRICE:
Breakeven is $${breakEvenPrice.toLocaleString()}, which is AT OR ABOVE the ask of $${askPrice.toLocaleString()}. The deal ALREADY WORKS at the asking price — no price reduction is needed to hit breakeven, and proposing a lower offer target would actively mislead the buyer. Do NOT frame breakeven ($${breakEvenPrice.toLocaleString()}) as a "drop to $X", "price reduction to $X", "target", "ceiling", or "negotiate down to $X" — it is higher than ask, not lower. Do NOT propose any offer figure below $${askPrice.toLocaleString()}. Frame NEG_1/NEG_2/NEG_3 around NON-PRICE concessions only: seller-paid closing costs, inspection-based repair credits, rate buy-downs (1-0 / 2-1 / permanent points), home warranty inclusion, or appliance/furniture inclusion. If you mention dollars, tie them to the concession (e.g. "$6,000 toward rate buy-down") — not to a target purchase price.`
    : `HARD LOCK — NEGOTIATION / TARGET PRICE:
The ONLY valid price-reduction target is the breakeven: $${breakEvenPrice.toLocaleString()}.
Whenever you mention a target price, offer ceiling, "drop to $X", "price reduction to $X",
"if seller will not drop to $X or below", or any comparable construction, the number MUST
be exactly $${breakEvenPrice.toLocaleString()} — NOT rounded up, NOT a friendlier nearby number,
NOT a $5k/$10k cushion above breakeven. Forbidden nearby values include
$${(Math.round(breakEvenPrice * 1.05 / 1000) * 1000).toLocaleString()},
$${(Math.round(breakEvenPrice * 1.03 / 1000) * 1000).toLocaleString()},
$${(Math.round((breakEvenPrice + 5000) / 1000) * 1000).toLocaleString()},
$${(Math.round((breakEvenPrice + 7000) / 1000) * 1000).toLocaleString()}, and
$${(Math.round((breakEvenPrice + 10000) / 1000) * 1000).toLocaleString()}.
If a rule tempts you to write a different target number, delete the target and rephrase
without one — but do NOT invent a substitute number.`

  const prompt = `You are the Deal Doctor for DealDoctor, a US real estate investment analyzer.
${correctionsBlock}${validationFlagsBlock}
${negotiationLock}

PROPERTY (do not change these values — they are pre-calculated):
- Address: ${address}, ${city}, ${state}, USA
- Strategy analyzed: ${strategy}
- Ask price: $${askPrice.toLocaleString()} USD${propertyType ? `\n- Property type: ${propertyType}` : ''}${yearBuilt ? `\n- Year built: ${yearBuilt}` : ''}${squareFeet ? `\n- Square footage: ${squareFeet.toLocaleString()} sqft` : ''}${bedrooms != null ? `\n- Bedroom count: ${bedrooms}${bedrooms === 0 ? ' (studio)' : ''} (this is the ONLY bedroom count you may cite — do NOT describe the unit as a different number of bedrooms)` : ''}
- Verdict: ${metrics.verdict}
- Primary failure mode: ${metrics.primaryFailureMode}
- Monthly cash flow (the ONLY monthly cash-flow figure you may cite — do NOT substitute a nearby number like "$544/mo" or "$600/mo"): ${metrics.monthlyNetCashFlow >= 0 ? '+' : ''}$${metrics.monthlyNetCashFlow}/mo
- Cap rate: ${metrics.capRate}%
- Cash-on-cash return: ${metrics.cashOnCashReturn}%
- DSCR: ${metrics.dscr} (lenders want >= 1.25)
- LTV: ${(metrics.ltv * 100).toFixed(0)}%
- Deal score: ${metrics.dealScore}/100
- Refi survival rate: up to ${(metrics.renewalSurvivalRate * 100).toFixed(1)}%
- Breakeven price: $${breakEvenPrice.toLocaleString()} USD
- Estimated monthly rent (use this exact value — do NOT substitute a different rent): $${Math.round(estimatedRent).toLocaleString()}/mo
- Estimated STR revenue: $${strRevenue.toLocaleString()}/mo${bedrooms ? ` (${bedrooms}-bed assumption)` : ''}${
    arvEstimate && arvEstimate > 0
      ? `\n- ARV (from sale comps): $${arv.toLocaleString()} USD\n- Max flip offer (70% rule, ARV-based): $${maxFlipOffer.toLocaleString()} USD`
      : `\n- ARV / resale value: NOT AVAILABLE (comp set unreliable — do NOT cite a specific resale or after-repair dollar figure)`
  }
${stateRules.rentControl ? `- Rent-controlled jurisdiction: ${stateRules.name} (use the word "jurisdiction" — DC is a federal district, several others are cities not states)` : '- Rent control: NONE in this jurisdiction — do NOT mention rent control in the narrative'}
- Landlord-friendly: ${stateRules.landlordFriendly ? 'Yes' : 'No'}
- STR rules: ${stateRules.strNotes}${strProhibited ? '\n- STR feasibility: PROHIBITED for this investor buyer (whole-unit non-owner-occupied STR is broadly banned in this jurisdiction). Do NOT list STR as a pro, do NOT frame STR as optionality, do NOT propose STR as a pivot strategy in any fix, and do NOT cite any STR revenue figure. If you want to mention STR at all, frame it as "not permitted for investor owners here."' : ''}${
    typeof strNetMonthlyCashFlow === 'number' && !strProhibited
      ? `\n- STR net monthly cash flow (after jurisdiction-specific variable opex + STR insurance bump, HOT tax included where applicable): ${
          strNetMonthlyCashFlow >= 0 ? '+' : ''
        }$${strNetMonthlyCashFlow.toLocaleString()}/mo${
          strNetMonthlyCashFlow < metrics.monthlyNetCashFlow
            ? ` — LOWER than LTR's ${metrics.monthlyNetCashFlow >= 0 ? '+' : ''}$${metrics.monthlyNetCashFlow}/mo. LTR wins by $${(metrics.monthlyNetCashFlow - strNetMonthlyCashFlow).toLocaleString()}/mo after all opex. You MUST NOT recommend STR as a strategic pivot fix; do NOT frame STR as upside; do NOT cite STR gross revenue as a "boost" without naming the net loss. If a strategy fix involves STR at all, it must explicitly acknowledge STR nets $${Math.abs(strNetMonthlyCashFlow).toLocaleString()}/mo ${strNetMonthlyCashFlow < 0 ? 'NEGATIVE' : 'below LTR'}.`
            : ` — HIGHER than LTR's ${metrics.monthlyNetCashFlow >= 0 ? '+' : ''}$${metrics.monthlyNetCashFlow}/mo by $${(strNetMonthlyCashFlow - metrics.monthlyNetCashFlow).toLocaleString()}/mo. STR is a legitimate pivot candidate.`
        }`
      : ''
  }
- Property tax rate for this jurisdiction: ${(stateRules.propertyTaxRate * 100).toFixed(2)}% (the ONLY valid tax-rate number you may cite; do NOT round to "1.0%" or any other figure — quote ${(stateRules.propertyTaxRate * 100).toFixed(2)}% verbatim when referencing tax)
${climateBlock}

WRITE exactly this structure (no markdown, plain text only, ONE value per line):

DIAGNOSIS: [2-3 sentences. Plain English. Name the specific problem. Use the exact numbers above. No jargon. Tone: honest friend who knows real estate.]

PROS: [SEMICOLON-separated list of 3-5 genuine positives about this specific deal. Reference actual numbers or location facts. No fluff. Use semicolons (;) between items, NEVER commas — dollar amounts like $2,110 contain commas and must not be split.]

CONS: [SEMICOLON-separated list of 3-5 specific concerns. Reference actual numbers or location facts. No generic advice. Use semicolons (;) between items, NEVER commas.]

NEG_1_LEVER: [Short concession to ask the seller for — e.g. "Closing costs credit", "Inspection repairs credit", "Price reduction for rehab"]
NEG_1_SCRIPT: [One sentence the buyer can actually say — specific dollar amount tied to a real issue]
NEG_2_LEVER: [Different negotiation angle]
NEG_2_SCRIPT: [Specific script]
NEG_3_LEVER: [Third angle]
NEG_3_SCRIPT: [Specific script]

INSPECT_1_AREA: [Short area name — e.g. "Foundation", "Roof", "HVAC", "Plumbing", "Windows", "Electrical"]
INSPECT_1_WHY: [One sentence on WHY this property specifically is at risk — tie to year built, location climate, or property type]
INSPECT_2_AREA: [Different area]
INSPECT_2_WHY: [Property-specific reason]

FIX_1_TITLE: [Short action title]
FIX_1_SUBTITLE: [Effort level and one-line context]
FIX_1_DIFFICULTY: [easy|medium|hard]
FIX_1_RESULT_VALUE: [e.g. "+$280/mo" or "$418,000"]
FIX_1_RESULT_LABEL: [e.g. "cash flow at breakeven price"]
FIX_1_DETAILS: [up to 5 label|value pairs separated by SEMICOLONS — never commas, because dollar values contain commas. Example: Target price|$270,000; Estimated rent|$700/mo; Annual tax savings|$2,100]

FIX_2_TITLE: [Short action title]
FIX_2_SUBTITLE: [Effort level and one-line context]
FIX_2_DIFFICULTY: [easy|medium|hard]
FIX_2_RESULT_VALUE: [result]
FIX_2_RESULT_LABEL: [label]
FIX_2_DETAILS: [semicolon-separated label|value pairs]

FIX_3_TITLE: [Short action title]
FIX_3_SUBTITLE: [Effort level and one-line context]
FIX_3_DIFFICULTY: [easy|medium|hard]
FIX_3_RESULT_VALUE: [result]
FIX_3_RESULT_LABEL: [label]
FIX_3_DETAILS: [semicolon-separated label|value pairs]

BOTTOM_LINE: [Single sentence starting with "Bottom line:" — what should they actually do?]

Rules:
- Never invent numbers. Use only the values provided above.
- PROS and CONS must reference the actual provided data (cash flow, DSCR, rate, climate, state rules). Do NOT list generic "good property" or "be careful" items.
- Negotiation scripts must name a SPECIFIC dollar amount when possible (tied to a real issue). Generic "negotiate hard" is worthless.
- Inspection red flags must be property-specific. A 1950s home in FL has different risks than a 2015 home in AZ. Tie to year built + climate + property type. IF property type is a Condo / Apartment / High-Rise, focus on building-level concerns (HOA reserves, elevator / shared-systems age, garage membrane, window-seal failures, flood at lobby/garage level) — NEVER suggest "row home" / "SFR roof" / "foundation settling" red flags for a condo unit.
- Fix 1: lowest effort path to a working deal
- Fix 2: value-add or structural change
- Fix 3: strategic pivot (different strategy or market redirect)
- If insurance > $300/mo OR flood insurance is mandatory: one of the fixes MUST address insurance cost directly (shop carriers, raise deductible, appeal flood zone via elevation certificate).
- If a climate risk is listed as top concern: the diagnosis OR one fix must acknowledge it (e.g. hurricane → windstorm deductible reality, wildfire → defensible-space insurability, heat → HVAC cost, tornado → structural upgrades for insurability).
- If verdict is DEAL: shift tone to protective — "here's what could go wrong"
- Keep diagnosis under 60 words
- Keep each fix detail row under 8 words per cell
- Rent consistency: the only monthly rent figure you may reference is $${Math.round(estimatedRent).toLocaleString()}/mo (the Estimated monthly rent above). Do NOT pick a different rent for fixes. If a fix is "raise the rent", phrase it as "raise rent to $X/mo" where $X is your target — never contradict the model by listing a rent BELOW $${Math.round(estimatedRent).toLocaleString()}/mo as the current rent.
- Dollar figures in scripts must be derivable from the numbers above. Do NOT invent ask prices, counter-offers, or rehab credits that aren't tied to a value listed above. The legitimate anchors are: ask price $${askPrice.toLocaleString()}, breakeven $${breakEvenPrice.toLocaleString()}, the delta between them ($${(askPrice - breakEvenPrice).toLocaleString()} if ask > breakeven, otherwise $${(breakEvenPrice - askPrice).toLocaleString()}), and rehab budget $${(rehabBudget ?? 0).toLocaleString()}. If breakeven is below ask and a script demands a price reduction, the TARGET PRICE must be EXACTLY $${breakEvenPrice.toLocaleString()} — the breakeven, verbatim. Do NOT round up, buffer, or pick a "friendlier" nearby number. Anything like "$${(Math.round(breakEvenPrice * 1.05 / 1000) * 1000).toLocaleString()}" or "$${(Math.round(breakEvenPrice * 1.03 / 1000) * 1000).toLocaleString()}" is forbidden — the only valid price-reduction target is $${breakEvenPrice.toLocaleString()}. The delta $${Math.max(0, askPrice - breakEvenPrice).toLocaleString()} is the SIZE of the price cut to ask for; the resulting price floor is the breakeven itself.
- STR revenue: the ONLY monthly STR figure you may cite is $${strRevenue.toLocaleString()}/mo (the Estimated STR revenue above). Do NOT invent a revenue target like "push revenue above $2,500/mo" or "$3,000/mo". If a fix is "boost STR revenue", frame the upside as a percent lift above the $${strRevenue.toLocaleString()}/mo baseline, not as an invented dollar threshold.
- Do NOT cite cumulative, annual, or multi-year loss totals ("$43,200 in 5-year losses", "$12k/yr cash bleed") unless derivable by simple multiplication of the monthly cash flow ${metrics.monthlyNetCashFlow}/mo. If you must quantify ongoing loss, express it as "$${Math.abs(metrics.monthlyNetCashFlow)}/mo negative cash flow" — do NOT annualize or project it across an invented hold period.
- Do NOT state or imply a specific hold period or flip horizon ("5-year flip", "treat it as a 3-year hold", "sell in 7 years"). No hold-period / horizon assumption is provided. If you need to describe strategy timing, use relative phrases ("near-term exit", "medium-term hold") — never a number of years.${arvEstimate && arvEstimate > 0 ? '' : `\n- Do NOT cite a specific ARV / after-repair value / "resale value" dollar figure in diagnosis, fixes, or bottom line. No reliable comp-based ARV is available for this property. A "flip for value-add" fix must describe the upside qualitatively (e.g. "cosmetic rehab lifts value") without naming a target resale number.`}
- Rent control: only assert rent control if the line above says "Rent-controlled jurisdiction". Otherwise never claim the property is subject to rent control.
- State vs jurisdiction: Washington DC (state code "DC") is a federal DISTRICT, not a state. Never refer to DC as a "state" — use "the District of Columbia", "DC", or "federal district".
- Neighborhood / sub-neighborhood naming: NO specific neighborhood, sub-neighborhood, corridor, district, quarter, or named area (e.g. "Fells Point", "Inner Harbor", "Harbor East", "Williamsburg", "SoHo", "Dupont Circle", "the Inner Harbor corridor") may be cited anywhere in the narrative unless it appears verbatim in the PROPERTY block above. If you want to reference location, use only the city and state/district from the PROPERTY block (e.g. "downtown Baltimore"). Audit failure: 414 Water St was repeatedly described as "Fells Point / Inner Harbor corridor" when it is in Harbor East / Inner Harbor East — the model was guessing the neighborhood from the street name.
${(propertyType || '').toLowerCase().match(/condo|apartment|co-?op/) ? `- Condo/apartment inspection rules (subject is "${propertyType}"): tenant-level HVAC and in-wall electrical are usually building-managed — do NOT recommend inspecting "HVAC", "electrical", or "roof" as if the buyer controls them. Instead focus on: HOA financial statements + reserve-study age, last 3 years of special assessments, master insurance certificate + building deductible, garage / elevator / lobby membrane age, window-seal condition (unit-level), pending litigation / Fannie-Mae-warrantability for the HOA. If you must pick a "systems" red flag, frame it as "building-wide HVAC/electrical infrastructure and how reserves fund replacement" — not as something the unit owner inspects independently.` : ''}`

  const result = await anthropic.messages.create({
    model: MODEL_ID,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = result.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((b) => b.text)
    .join('\n')
  const parsed = parseDealDoctorResponse(addCommasToNumbers(text))
  // Fail-closed guard: if the AI hallucinated a bedroom count in the diagnosis
  // prose that disagrees with structured data, strip the offending phrase so
  // it doesn't render rather than surface a confidently-wrong headline.
  if (bedrooms != null && !validateDiagnosisBedroomPhrase(parsed.diagnosis, bedrooms)) {
    parsed.diagnosis = parsed.diagnosis
      .replace(/\b\d+\s*[-\s]\s*(?:bed|bedroom|br)(?:room)?\b/gi, `${bedrooms}-bed`)
      .replace(/\b(?:zero|one|two|three|four|five|six)[\s-]?(?:bed|bedroom|br)\b/gi, `${bedrooms}-bed`)
      .replace(/\bstudio\b/gi, bedrooms === 0 ? 'studio' : `${bedrooms}-bed unit`)
  }
  // Defense-in-depth: scrub neighborhood names the model invents. The prompt
  // forbids unprovided neighborhood names, but when the model ignores the
  // rule we overwrite the offending phrase with the city-level description
  // so the user never sees a wrong-neighborhood claim. Audit: 414 Water St
  // (Harbor East / Inner Harbor East) was repeatedly described as
  // "Fells Point / Inner Harbor corridor" — Fells Point starts ~0.8 mi east
  // past President St. Extend the scrub table as more false-neighborhood
  // hallucinations surface.
  scrubHallucinatedNeighborhood(parsed, address, city, state)
  return parsed
}

// Overwrites known wrong-neighborhood phrases across diagnosis / pros / cons /
// negotiations / fixes / bottom line. Each entry is triggered by a simple
// address or zip gate so we don't scrub cases where the name is genuinely
// correct.
export function scrubHallucinatedNeighborhood(
  parsed: DealDoctorOutput,
  address: string,
  city: string,
  state: string,
): void {
  const addrLower = (address || '').toLowerCase()
  const cityLower = (city || '').toLowerCase()
  const stateUpper = (state || '').toUpperCase()
  // 414 Water St / Harbor East (21202) — NOT Fells Point, NOT Inner Harbor
  // proper (both are adjacent but distinct). Replace with the correct
  // neighborhood when the address matches; otherwise fall back to the city.
  const isHarborEastBalt =
    stateUpper === 'MD' &&
    cityLower === 'baltimore' &&
    /\b414\s+water\s+st\b/.test(addrLower)
  const FELLS_POINT_RE =
    /\b(?:in\s+|the\s+)?fells?\s+point(?:\s*(?:\/|,|\s+and|\s+or|\s+&)\s*inner\s+harbor)?(?:\s+(?:corridor|district|neighborhood|area))?\b/gi
  const INNER_HARBOR_RE =
    /\b(?:in\s+|the\s+)?inner\s+harbor(?:\s+(?:corridor|district|neighborhood|area))?\b(?!\s+east)/gi
  const replacement = isHarborEastBalt
    ? 'Inner Harbor East / Harbor East'
    : `${city || ''}${state ? `, ${state}` : ''}`.trim() || 'the local market'
  const scrub = (s: string | undefined): string | undefined => {
    if (!s) return s
    if (isHarborEastBalt) {
      return s.replace(FELLS_POINT_RE, replacement).replace(INNER_HARBOR_RE, replacement)
    }
    return s
  }
  parsed.diagnosis = scrub(parsed.diagnosis) ?? parsed.diagnosis
  parsed.pros = parsed.pros?.map((p) => scrub(p) ?? p) ?? parsed.pros
  parsed.cons = parsed.cons?.map((c) => scrub(c) ?? c) ?? parsed.cons
  parsed.bottomLine = scrub(parsed.bottomLine) ?? parsed.bottomLine
  if (parsed.negotiationLevers) {
    parsed.negotiationLevers = parsed.negotiationLevers.map((n) => ({
      ...n,
      lever: scrub(n.lever) ?? n.lever,
      script: scrub(n.script) ?? n.script,
    }))
  }
  if (parsed.inspectionRedFlags) {
    parsed.inspectionRedFlags = parsed.inspectionRedFlags.map((r) => ({
      ...r,
      why: scrub(r.why) ?? r.why,
    }))
  }
  if (parsed.fixes) {
    parsed.fixes = parsed.fixes.map((f) => ({
      ...f,
      title: scrub(f.title) ?? f.title,
      subtitle: scrub(f.subtitle) ?? f.subtitle,
    }))
  }
}

// 414 Water St audit: AI diagnosis said "This 1-bed condo is asking..." on a
// 2BR unit. Gate on structured bedrooms and fail closed when the prose's
// bedroom phrase disagrees. Returns true when the text is consistent (or
// contains no bedroom phrase at all).
export function validateDiagnosisBedroomPhrase(text: string, bedrooms: number): boolean {
  if (!text || !Number.isFinite(bedrooms)) return true
  const lower = text.toLowerCase()
  const WORDS: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  }
  const numeric = lower.match(/(\d+)\s*[-\s]\s*(?:bed|bedroom|br)\b/)
  if (numeric) return Number(numeric[1]) === bedrooms
  const word = lower.match(/\b(zero|one|two|three|four|five|six)[\s-]?(?:bed|bedroom|br)\b/)
  if (word) return WORDS[word[1]] === bedrooms
  if (/\bstudio\b/.test(lower)) return bedrooms === 0
  return true
}

// Claude occasionally writes dollar amounts without thousands separators
// ("$284000" instead of "$284,000"). Post-process the raw response before
// parsing so every downstream field — diagnosis, pros, cons, scripts, fix
// detail rows — renders with properly-formatted numbers.
export function addCommasToNumbers(text: string): string {
  if (!text) return text
  return text.replace(/\$(\d{4,})(\.\d+)?/g, (_match, intPart: string, decPart = '') => {
    return `$${Number(intPart).toLocaleString('en-US')}${decPart}`
  })
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
    // Prefer semicolons as pair separators (safe against dollar-comma values
    // like "$270,000"). Fall back to commas that are followed by a label
    // character — that preserves "$270,000" while still splitting "price|X, rent|Y".
    const pairs = detailLine.includes(';')
      ? detailLine.split(';')
      : detailLine.split(/,(?=\s*[A-Za-z])/)
    return pairs.map(pair => {
      const [label, value] = pair.split('|').map(s => s.trim())
      return { label: label || '', value: value || '' }
    }).filter(d => d.label && d.value)
  }

  // Prefer semicolons as the item separator — protects dollar amounts
  // that contain commas ("$2,110 achievable rent" shredded into
  // ["$2", "110 achievable rent"] when we split on bare commas). Fall
  // back to commas followed by a letter, which preserves "$235,000"
  // (digit after the comma) while still splitting "item A, Item B".
  const splitCommaList = (raw: string): string[] => {
    if (!raw) return []
    const pieces = raw.includes(';')
      ? raw.split(';')
      : raw.split(/,(?=\s*[A-Za-z])/)
    return pieces.map((s) => s.trim()).filter(Boolean)
  }

  return {
    diagnosis: get('DIAGNOSIS'),
    tonePositive: text.includes('STRONG_DEAL') || get('DIAGNOSIS').toLowerCase().includes('strong'),
    bottomLine: get('BOTTOM_LINE'),
    pros: splitCommaList(get('PROS')),
    cons: splitCommaList(get('CONS')),
    negotiationLevers: [1, 2, 3]
      .map((n) => ({
        lever: get(`NEG_${n}_LEVER`),
        script: get(`NEG_${n}_SCRIPT`),
      }))
      .filter((x) => x.lever && x.script),
    inspectionRedFlags: [1, 2]
      .map((n) => ({
        area: get(`INSPECT_${n}_AREA`),
        why: get(`INSPECT_${n}_WHY`),
      }))
      .filter((x) => x.area && x.why),
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
export function estimateSTRRevenue(city: string, state: string, bedrooms?: number): number {
  const cityLower = city.toLowerCase()

  // Legal-restriction short-circuit: NYC Local Law 18 (effective Sept 2023) bans
  // most <30-day STR operation — a listed revenue figure would be unrealizable
  // and misleading. Return 0 so the UI can render "STR not viable in this
  // jurisdiction" instead of a baseline × bedroom multiplier.
  const isNycBorough =
    state === 'NY' &&
    /\b(new york|manhattan|brooklyn|queens|bronx|staten island)\b/.test(cityLower)
  if (isNycBorough) return 0

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
