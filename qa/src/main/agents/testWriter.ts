import { runClaude } from '../claude';
import type { ConsolidatedIssue, TestWriterResult } from '../../shared/types';

const SYSTEM_PROMPT = `You are OSCAR MARTINEZ, Dunder Mifflin's senior accountant — meticulous, fact-driven, and completely unwilling to let a bug ship without a regression test.

You are the FIRST stop in the fix pipeline. A pair of developer agents (Andy and Kevin) will run in parallel AFTER you finish. Your only job: write a FAILING Vitest unit test for each CRITICAL or HIGH bug in the report, co-located next to the module under test in the DealDoctor codebase. Do not fix bugs. Do not modify production code. Write tests.

## Where tests live in this repo
- \`lib/calculations.test.ts\` for calc math (IRR, breakeven, cash flow, wealth, sensitivity)
- \`lib/studentHousing.test.ts\` for rent multiplier / cross-check
- \`lib/climateRisk.test.ts\` for climate insurance
- \`lib/entitlements.test.ts\` for entitlement logic
- \`lib/dealDoctor.test.ts\` for AI prompt shaping
- \`lib/reportGenerator.test.ts\` for composeFullReport + warnings + wealth projection
- \`tests/pressure/scenarios/*.test.ts\` for end-to-end property scenarios
- New \`*.test.ts\` files alongside modules you want to cover

## Rules
1. Each test must FAIL against current code — it reproduces the bug. If you cannot make it fail with a clear assertion, skip the bug with reason.
2. Use existing fixtures and helpers — start by reading the nearby test file to match style.
3. Prefer small pure-function tests (call \`calculateBreakEvenPrice\`, check the return) over end-to-end tests. E2E is for last-resort coverage.
4. Tests should have a comment linking back to the bug, e.g. \`// regression: breakeven mismatch between instant card and full report (QA run 4)\`.
5. Do NOT run \`npm test\` — the shared test run happens after the developers finish.
6. Do NOT modify non-test files.

After you finish, end your response with this JSON block (delimiter REQUIRED):

===TESTS===
{
  "testsWritten": [
    { "bug": "<title>", "testFile": "<path to test file>", "description": "<one-line what it asserts>" }
  ],
  "skipped": [
    { "bug": "<title>", "reason": "<why — can't make it fail / already covered / too risky>" }
  ]
}
===END===`;

export interface TestWriterInput {
  address: string;
  issues: ConsolidatedIssue[];
  repoRoot: string;
  onChunk?: (chunk: string) => void;
}

export async function runTestWriterAgent(input: TestWriterInput): Promise<TestWriterResult> {
  const targets = input.issues.filter(
    (i) => i.checked && (i.severity === 'CRITICAL' || i.severity === 'HIGH')
  );
  if (targets.length === 0) {
    return { testsWritten: [], skipped: [] };
  }
  const userPrompt = buildPrompt(input.address, targets);
  try {
    const transcript = await runClaude({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      cwd: input.repoRoot,
      allowWrite: true,
      allowedTools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
      timeoutMs: 15 * 60_000,
      onChunk: input.onChunk,
    });
    return parseTranscript(transcript);
  } catch (err) {
    return { testsWritten: [], skipped: [], error: (err as Error).message };
  }
}

function buildPrompt(address: string, targets: ConsolidatedIssue[]): string {
  const lines: string[] = [];
  lines.push(`Working directory is the DealDoctor repo. Subject property for context: ${address}.`);
  lines.push('');
  lines.push(`Write failing regression tests for these ${targets.length} approved CRITICAL/HIGH bug${targets.length === 1 ? '' : 's'}:`);
  lines.push('');
  for (const i of targets) {
    lines.push(`## [${i.severity}] ${i.title}  (${i.source}${i.category ? ` · ${i.category}` : ''})`);
    if (i.reportSays) lines.push(`Report says: ${i.reportSays}`);
    if (i.actuallyFound) lines.push(`Actually: ${i.actuallyFound}`);
    if (i.conflict) lines.push(`Conflict: ${i.conflict}`);
    if (i.structuredData) lines.push(`Structured: ${i.structuredData}`);
    lines.push(`Suggested fix direction: ${i.fix}`);
    lines.push('');
  }
  lines.push('When done, end with the ===TESTS=== JSON block.');
  return lines.join('\n');
}

function parseTranscript(transcript: string): TestWriterResult {
  const m = transcript.match(/===TESTS===([\s\S]*?)===END===/);
  if (!m) return { testsWritten: [], skipped: [], rawTranscript: transcript };
  try {
    const parsed = JSON.parse(m[1].trim());
    return {
      testsWritten: parsed.testsWritten ?? [],
      skipped: parsed.skipped ?? [],
      rawTranscript: transcript,
    };
  } catch {
    return { testsWritten: [], skipped: [], rawTranscript: transcript };
  }
}
