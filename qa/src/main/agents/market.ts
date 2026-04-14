import { runClaudeJson } from '../claude';
import type { AgentReport, ExtractedData } from '../../shared/types';

const SYSTEM_PROMPT = `You are a real estate market data auditor. You receive structured data extracted from an investment report. Your job is to verify every data point against real market sources using web search.

Do NOT assume the report is correct. Your job is to find what's wrong.

For each issue:
- Quote what the report says
- State what you found with the source URL
- Rate severity: CRITICAL / HIGH / MEDIUM / LOW
- Suggest a specific fix

Also search for data the report should have included but missed (e.g. same-building comps, actual HOA amounts).

Each issue MUST include a \`category\` field from this fixed enum (pick the single best match):
  sale_comps | rent_comps | value_estimate | hoa | zip_market | property_metadata
  | duplicate_comps | property_type_drift | prose_factual | other

Also include a \`confidence\` field: "high" when 2+ independent sources corroborate, "medium" when one authoritative source, "low" when inferred.

Return ONLY a single JSON object with this shape — no prose, no markdown fences:
{
  "agent": "market_accuracy",
  "grade": "A|B|C|D|F",
  "issues": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "category": "<enum>",
      "confidence": "high|medium|low",
      "title": "<short canonical title — reuse across runs for the same bug>",
      "reportSays": "...",
      "actuallyFound": "...",
      "source": "https://...",
      "fix": "..."
    }
  ],
  "missedData": [
    { "type": "...", "data": "...", "source": "https://..." }
  ]
}`;

export async function runMarketAgent(
  data: ExtractedData,
  onChunk?: (chunk: string) => void,
  factSheet?: import('../capture').AddressFactSheet
): Promise<AgentReport> {
  const factSection = factSheet
    ? `
Pre-scraped fact sheet (use these as starting hints — verify with 1 more source before flagging):
\`\`\`json
${JSON.stringify(factSheet, null, 2)}
\`\`\`
`
    : '';

  const userPrompt = `Audit this DealDoctor report data. Focus on sale comps (building / era / neighborhood match), rent comps (dedup, current listings), AVM vs Zillow/Redfin/Realtor, HOA on condos, zip market stats.
${factSection}
Address: ${data.address}

Structured data:
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

Return the JSON object now.`;

  try {
    const report = await runClaudeJson<AgentReport>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      allowedTools: ['WebSearch', 'WebFetch'],
      timeoutMs: 5 * 60_000,
      onChunk,
    });
    return { ...report, agent: 'market_accuracy' };
  } catch (err) {
    return {
      agent: 'market_accuracy',
      grade: 'F',
      issues: [],
      error: (err as Error).message,
    };
  }
}
