/**
 * Narrative reviewer. Sonnet 4.6 reads the structured report data + the
 * Haiku-generated narrative and returns a critique. The caller rewrites the
 * narrative if the reviewer flags issues with confidence < 0.9, up to a hard
 * cap of 3 review rounds per report.
 *
 * Division of responsibility:
 *   - Deterministic math (IRR, breakeven, wealth, DSCR, sensitivity) is the
 *     code's job. Clamps + invariants gate bad numbers before the narrator
 *     sees them.
 *   - Narrative sanity (factual claims match the data, no hallucinated
 *     figures, no internal contradictions, rules from dealDoctor.ts respected)
 *     is the reviewer's job.
 *   - The reviewer does NOT fact-check against external reality (Rentcast,
 *     Zillow, legal statutes). That would need web search — different system.
 */

import Anthropic from '@anthropic-ai/sdk'

const REVIEWER_MODEL_ID = 'claude-sonnet-4-6'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Section values intentionally match DealDoctorOutput's JSON keys so a
// future partial-rewrite path can look up `result[concern.section]`
// directly without a translation layer. Previously these were kebab-case
// human labels (`'negotiation'`, `'inspection'`, `'bottom-line'`) which
// would have silently missed their targets on rewrite.
export interface ReviewConcern {
  section:
    | 'diagnosis'
    | 'pros'
    | 'cons'
    | 'negotiationLevers'
    | 'inspectionRedFlags'
    | 'fixes'
    | 'bottomLine'
    | 'general'
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  claim: string        // the narrative claim being flagged
  reason: string       // why it's wrong — cite the structured data
  correction?: string  // what the narrative should say instead
}

export interface ReviewResult {
  verdict: 'clean' | 'rewrite' | 'block'
  confidence: number   // 0-1, reviewer's own self-rating
  concerns: ReviewConcern[]
  summary: string      // 1-2 sentence overall read
  round: number        // which review round produced this
  rawTranscript?: string
  error?: string
}

const SYSTEM_PROMPT = `You are the quality reviewer for DealDoctor, a real-estate investment analyzer. You receive:
1. The structured data passed into the narrative generator (facts the generator was told to use)
2. The narrative the generator produced (pros/cons, negotiation scripts, inspection red flags, fixes, bottom line)

Your job: catch places where the narrative contradicts the structured data, invents figures, violates prompt rules, or introduces internal inconsistencies across sections. Do NOT nitpick style. Do NOT re-compute math — if a cash-flow or breakeven number looks wrong, that's a code bug, not a narrative bug (mark verdict "block" so the pipeline fails loudly instead of papering over math errors).

## What to flag (these are narrative bugs)
- Dollar amounts in the narrative that don't appear in the structured data (hallucinated figures)
- Property-type drift ("row home" when data says "Condo"; "single family" for high-rise)
- Rent-control claims when structured data says rent control is NONE in this jurisdiction
- "Switch to STR" recommendations when STR net cash flow is lower than LTR net cash flow
- Inspection red flags that don't fit the property type (roof/foundation for a condo unit; HOA docs for a detached SFR)
- Negotiation targets that deviate from the canonical breakeven price
- Verdict / tone mismatches (e.g., "great deal" when DSCR < 1 and cash flow is negative)
- Internal contradictions between sections (pros say one thing, cons or fixes contradict it)

## What to flag as verdict "block" (pipeline should fail, not rewrite)
- IRR in the narrative differs from IRR in the structured data
- Breakeven mentioned in narrative differs from canonical breakeven
- Monthly cash flow narrated is a different number than structured data shows
- Wealth projection in narrative contradicts the structured 5-year figure

## What to flag as verdict "rewrite"
- Everything else above (narrative-fixable issues). Include a concrete \`correction\` for each concern so the rewriter has an anchor.

## Confidence score
Rate your own confidence 0.0-1.0 in this review. Use high (≥0.9) when you're certain every concern listed is a real issue; use medium (0.6-0.89) when some concerns are judgment calls; use low (<0.6) when the narrative is borderline and you're pattern-matching rather than catching a hard rule violation. The caller uses confidence ≥0.9 as an early-exit signal — don't inflate confidence to force a ship.

## Output
Return ONLY a single JSON object, no prose, no markdown fences:
{
  "verdict": "clean | rewrite | block",
  "confidence": 0.0-1.0,
  "concerns": [
    {
      "section": "diagnosis | pros | cons | negotiationLevers | inspectionRedFlags | fixes | bottomLine | general",
      "severity": "CRITICAL | HIGH | MEDIUM | LOW",
      "claim": "<quoted text or paraphrase>",
      "reason": "<why it's wrong, citing the structured data>",
      "correction": "<what it should say — optional, for rewritable concerns>"
    }
  ],
  "summary": "<1-2 sentence overall read>"
}

If verdict is "clean", return an empty concerns array.`

export interface ReviewInput {
  structuredData: Record<string, unknown>
  narrative: Record<string, unknown>
  round: number
}

export async function reviewNarrative(input: ReviewInput): Promise<ReviewResult> {
  const userPrompt = buildPrompt(input.structuredData, input.narrative)

  try {
    const response = await anthropic.messages.create({
      model: REVIEWER_MODEL_ID,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    })
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((b) => b.text)
      .join('\n')
    return parseReview(text, input.round)
  } catch (err) {
    // Fail-open: if reviewer errors, don't block the report. Mark clean with
    // the error noted so operators can see reviewer failures in logs/metrics.
    return {
      verdict: 'clean',
      confidence: 0,
      concerns: [],
      summary: '(reviewer unavailable — shipped without review)',
      round: input.round,
      error: (err as Error).message,
    }
  }
}

function buildPrompt(
  structuredData: Record<string, unknown>,
  narrative: Record<string, unknown>
): string {
  // Trim the structured data to fields the narrative could plausibly cite —
  // avoid blowing the prompt with raw Rentcast JSON the reviewer doesn't
  // need. The reviewer's job is narrative-vs-fact, not data validation.
  const sd = structuredData as Record<string, unknown>
  const trimmed = {
    property: (sd.property as Record<string, unknown> | undefined) ?? null,
    breakeven: (sd.breakeven as Record<string, unknown> | undefined) ?? null,
    expenses: (sd.expenses as Record<string, unknown> | undefined) ?? null,
    rentAdjustment: (sd.rentAdjustment as Record<string, unknown> | undefined) ?? null,
    inputs: (sd.inputs as Record<string, unknown> | undefined) ?? null,
    wealthProjection: (sd.wealthProjection as Record<string, unknown> | undefined)
      ? {
          hero: (sd.wealthProjection as { hero?: unknown }).hero ?? null,
          assumptions: (sd.wealthProjection as { assumptions?: unknown }).assumptions ?? null,
        }
      : null,
    strProjection: (sd.strProjection as Record<string, unknown> | undefined) ?? null,
    recommendedOffers: (sd.recommendedOffers as Record<string, unknown> | undefined) ?? null,
    valueTriangulation: (sd.valueTriangulation as Record<string, unknown> | undefined) ?? null,
    warnings: sd.warnings ?? null,
    ltr: sd.ltr ?? null,
    // NOT included: raw comp lists, climate granular data, marketSnapshot —
    // the narrative doesn't cite them directly.
  }

  return `## STRUCTURED DATA (what the generator was told to use):
\`\`\`json
${JSON.stringify(trimmed, null, 2)}
\`\`\`

## NARRATIVE TO REVIEW:
\`\`\`json
${JSON.stringify(narrative, null, 2)}
\`\`\`

Return the JSON verdict now.`
}

function parseReview(text: string, round: number): ReviewResult {
  // A parse failure is NOT the same as "clean". Treat it as a neutral
  // "shipped without review signal" outcome: no verdict change requested, no
  // concerns manufactured, but the error field is set so the caller can
  // surface "reviewer unavailable" in UI + telemetry.
  const unparseable = (errorKey: string, summary: string): ReviewResult => ({
    verdict: 'clean', // we don't want to block on a parse error
    confidence: -1,   // sentinel: reviewer didn't produce a rateable result
    concerns: [],
    summary,
    round,
    rawTranscript: text.slice(0, 2000),
    error: errorKey,
  })

  const match = text.match(/\{[\s\S]*\}/)
  if (!match) {
    return unparseable('no-json', '(reviewer returned no parseable JSON; shipped as-is)')
  }
  try {
    const parsed = JSON.parse(match[0]) as Partial<ReviewResult>
    const verdict = (parsed.verdict ?? 'clean') as ReviewResult['verdict']
    const confidence =
      typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0
    return {
      verdict: verdict === 'block' || verdict === 'rewrite' ? verdict : 'clean',
      confidence,
      concerns: Array.isArray(parsed.concerns) ? (parsed.concerns as ReviewConcern[]) : [],
      summary: parsed.summary ?? '(no summary)',
      round,
      rawTranscript: text.slice(0, 2000),
    }
  } catch {
    return unparseable('parse-error', '(reviewer JSON unparseable; shipped as-is)')
  }
}

// ─── Loop controller — hard cap 3 rounds OR early-exit at confidence ≥ 0.9 ──

export interface ReviewLoopConfig {
  maxRounds?: number            // default 3
  confidenceFloor?: number      // default 0.9 — exit early when this is met
  verifyAfterRewrite?: boolean  // default true — when false, ship immediately
                                // after a rewrite without a verification review
}

export interface ReviewLoopOutcome {
  rounds: number
  finalVerdict: ReviewResult['verdict']
  finalConfidence: number
  finalConcerns: ReviewConcern[]
  finalSummary: string
  history: ReviewResult[]        // one entry per review call
  blocked: boolean               // true if any round returned 'block'
}

/**
 * Wrapper that runs: (review → rewrite → review → ...) up to maxRounds.
 * The caller supplies an async `regenerate(concerns) => newNarrative` hook.
 * Returns the final outcome + a full history for logging/UI.
 */
export async function runReviewLoop(
  structuredData: Record<string, unknown>,
  initialNarrative: Record<string, unknown>,
  regenerate: (concerns: ReviewConcern[]) => Promise<Record<string, unknown>>,
  config: ReviewLoopConfig = {}
): Promise<{ narrative: Record<string, unknown>; outcome: ReviewLoopOutcome }> {
  const maxRounds = config.maxRounds ?? 3
  const confidenceFloor = config.confidenceFloor ?? 0.9
  const verifyAfterRewrite = config.verifyAfterRewrite ?? true
  let narrative = initialNarrative
  const history: ReviewResult[] = []
  let blocked = false

  for (let round = 1; round <= maxRounds; round++) {
    const result = await reviewNarrative({ structuredData, narrative, round })
    history.push(result)

    if (result.verdict === 'block') {
      blocked = true
      break
    }
    if (result.error) {
      // Reviewer was unavailable or returned unparseable output — ship the
      // current narrative rather than gamble on another rewrite. Distinguish
      // this from a genuine 'clean' outcome via the error field.
      break
    }
    if (result.verdict === 'clean') {
      // No issues found — ship.
      break
    }
    // verdict === 'rewrite'. The confidenceFloor is a QUALITY gate on the
    // concerns themselves: high confidence means the reviewer is certain the
    // flagged issues are real, so we DO rewrite. Low confidence means the
    // reviewer is pattern-matching rather than catching hard violations, so
    // a rewrite is likely to make things worse — ship with the soft flags
    // instead.
    if (result.confidence < confidenceFloor) {
      // Low-confidence critique — don't gamble on a rewrite.
      break
    }
    if (round === maxRounds) {
      // Out of rewrite budget — ship with residual concerns visible.
      break
    }
    if (result.concerns.length === 0) {
      // Reviewer said rewrite but gave nothing to rewrite against. Ship.
      break
    }
    try {
      narrative = await regenerate(result.concerns)
    } catch {
      // Regenerator failed — ship what we have.
      break
    }
    if (!verifyAfterRewrite) {
      // Caller opted out of a post-rewrite verification pass — ship the
      // rewrite as-is. Saves one reviewer call (~25-30s) at the cost of
      // not catching regressions the rewrite may have introduced.
      break
    }
  }

  const final = history[history.length - 1]
  return {
    narrative,
    outcome: {
      rounds: history.length,
      finalVerdict: final?.verdict ?? 'clean',
      finalConfidence: final?.confidence ?? 0,
      finalConcerns: final?.concerns ?? [],
      finalSummary: final?.summary ?? '(no review completed)',
      history,
      blocked,
    },
  }
}
