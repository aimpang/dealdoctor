import { runClaudeJson } from '../claude';
import type { AgentReport, ExtractedData } from '../../shared/types';

const SYSTEM_PROMPT = `You are a fact-checker. You receive:
1. The narrative text from a real estate investment report (AI-generated prose)
2. The report's structured data (all computed metrics, property metadata)

Find every factual claim in the narrative and verify it against the structured data. Flag any discrepancy — even small ones. The narrative must be a faithful reflection of the data, not an approximation.

Pay special attention to:
- Dollar amounts that don't appear anywhere in the structured data (hallucinated figures)
- Property type mismatches ("row home" when the data says "condo")
- Building type in inspector guidance (high-rise condo should not get rowhouse advice)
- Rent figures that don't match the rent estimate
- DSCR, cap rate, cash-on-cash vs Year-1 metrics
- Negotiation targets vs breakeven / max offer
- STR figures vs the STR comparison section

Each issue MUST include a \`category\` field from this fixed enum (single best match):
  narrative_accuracy | property_type_drift | hallucinated_figure | inspector_guidance
  | negotiation_mismatch | verdict_questionable | str_math | prose_factual | other

Also include a \`confidence\` field ("high" | "medium" | "low").

Return ONLY a single JSON object — no prose, no markdown fences:
{
  "agent": "narrative_accuracy",
  "grade": "A|B|C|D|F",
  "issues": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "category": "<enum>",
      "confidence": "high|medium|low",
      "title": "<short canonical title — reuse across runs for the same bug>",
      "narrativeText": "...",
      "structuredData": "...",
      "fix": "..."
    }
  ]
}`;

export async function runNarrativeAgent(
  data: ExtractedData,
  onChunk?: (chunk: string) => void
): Promise<AgentReport> {
  const narrative = data.narrativeText || '';
  if (!narrative.trim()) {
    return {
      agent: 'narrative_accuracy',
      grade: 'A',
      issues: [],
      error: 'no narrative text captured — skipping',
    };
  }

  const factSheet = {
    propertyType: data.propertyType,
    yearBuilt: data.yearBuilt,
    squareFeet: data.squareFeet,
    bedrooms: data.bedrooms,
    avm: data.avm,
    rentEstimate: data.rentEstimate,
    hoa: data.hoa,
    dscr: data.dscr,
    score: data.score,
    verdict: data.verdict,
    summaryCard: data.summaryCard,
    sensitivity: data.sensitivity,
    breakeven: data.fullReport?.breakeven ?? data.instantCard?.breakeven,
    compsMedian: data.compsMedian,
  };

  const userPrompt = `Fact-check this narrative against the structured data.

NARRATIVE:
"""
${narrative}
"""

FACT SHEET (structured data):
\`\`\`json
${JSON.stringify(factSheet, null, 2)}
\`\`\`

Return the JSON object now.`;

  try {
    const report = await runClaudeJson<AgentReport>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      allowedTools: [],
      timeoutMs: 2 * 60_000,
      onChunk,
    });
    return { ...report, agent: 'narrative_accuracy' };
  } catch (err) {
    return {
      agent: 'narrative_accuracy',
      grade: 'F',
      issues: [],
      error: (err as Error).message,
    };
  }
}
