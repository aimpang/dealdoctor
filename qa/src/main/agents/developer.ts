import { runClaude } from '../claude';
import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTestWriterAgent } from './testWriter';
import { runReviewerAgent } from './reviewer';
import type {
  ConsolidatedIssue,
  DeveloperLabel,
  DeveloperResult,
  ResolvedValues,
  ReviewerResult,
  SingleDeveloperResult,
  TestWriterResult,
} from '../../shared/types';

// ─── Scope definitions ─────────────────────────────────────────────────────
// DealDoctor is a Next.js repo, not src/-prefixed. The buckets below describe
// the LOGICAL scope each dev agent owns. Paths are specific to this repo but
// the conceptual split mirrors the spec (data/calc/api vs narrative/templates).

const SCOPE_A_PATHS = [
  'lib/calculations.ts',
  'lib/rates.ts',
  'lib/propertyApi.ts',
  'lib/studentHousing.ts',
  'lib/climateRisk.ts',
  'lib/entitlements.ts',
  'lib/shareToken.ts',
  'lib/debugAccess.ts',
  'lib/reportGenerator.ts  (math/data sections only — NOT AI prompt construction)',
  'app/api/',
];
const SCOPE_A_FORBIDDEN = [
  'lib/dealDoctor.ts            (AI prompt construction)',
  'lib/email.ts                 (templates)',
  'components/                  (React render)',
  'app/report/                  (page templates)',
  'app/page.tsx                 (UI)',
];

const SCOPE_B_PATHS = [
  'lib/dealDoctor.ts            (AI prompt construction — primary responsibility)',
  'lib/email.ts                 (email templates)',
  'lib/reportGenerator.ts       (narrative wiring only — NOT calculations)',
  'components/',
  'app/report/',
  'app/page.tsx',
];
const SCOPE_B_FORBIDDEN = [
  'lib/calculations.ts',
  'lib/rates.ts',
  'lib/propertyApi.ts',
  'lib/studentHousing.ts',
  'lib/climateRisk.ts',
  'app/api/',
];

const BASE_SYSTEM = (
  scopeAllowed: string[],
  scopeForbidden: string[],
  label: DeveloperLabel,
  extraAllowed: string[]
) => `You are ${label}, a developer fixing bugs in a real estate investment report generator called DealDoctor.

You receive a scoped bug report. Only bugs that fall within YOUR ownership are included; a sibling developer is handling the rest in parallel.

## Scope — you MAY modify files in:
${scopeAllowed.map((p) => '  - ' + p).join('\n')}
${extraAllowed.length > 0 ? `
## ADDITIONAL FILES YOU MAY EDIT THIS RUN ONLY (rebalanced from the other developer for speed):
${extraAllowed.map((p) => '  - ' + p).join('\n')}
` : ''}
## Scope — you MUST NOT modify files in:
${scopeForbidden.map((p) => '  - ' + p).join('\n')}

Touching a forbidden file will cause a merge conflict with the other developer — skip the bug and note it in the skipped list instead. Err on the side of skipping if you're unsure.

## PIPELINE CONTEXT
OSCAR (test-writer) ran BEFORE you and wrote failing Vitest tests for each CRITICAL/HIGH bug in this batch. TOBY (reviewer) will run AFTER you to audit your diff before tests execute. You do not need to write tests — you need to make Oscar's tests PASS. Oscar's test files are listed below for each relevant bug.

For each bug:
- Read the description, what the report says vs what's actually correct, and the suggested fix
- Read Oscar's failing test file so you know exactly what assertion must flip from red to green
- Find the relevant code in the codebase (start from your allowed paths)
- Implement the fix so Oscar's test passes
- If a bug has no Oscar test (MEDIUM/LOW or Oscar skipped it), fix based on the description alone
- Do NOT write new test files. Do NOT modify Oscar's tests. If you believe Oscar's test is wrong, skip the bug and note it — the reviewer will flag it.

## DO NOT RUN the full test suite yourself
The dispatcher will run \`npm test\` ONCE after both developers finish editing — a shared test run avoids two parallel vitest processes fighting over the same cache directory and halves the cycle time. Focus your time on reading, editing, and reporting. Do not run \`npm test\`, \`npm run test\`, or \`vitest\` yourself.

After all fixes are applied, end your response with the JSON block below (delimiter REQUIRED):

===FIXES===
{
  "fixesApplied": [
    { "bug": "<title>", "file": "<path>", "change": "<one-line summary>", "linesChanged": <number>, "testsAdded": ["<Oscar's test file(s) you made pass>"] }
  ],
  "skipped": [
    { "bug": "<title>", "reason": "<why — scope / risk / already correct / test-wrong>" }
  ]
}
===END===

Prioritize: CRITICAL first, then HIGH, then MEDIUM/LOW if time permits. If a fix is too risky or would require major refactoring, skip it.`;

export interface DeveloperInput {
  address: string;
  issues: ConsolidatedIssue[];
  userNotes?: string;
  repoRoot: string;
  onChunk?: (chunk: string) => void;
}

export interface SplitDeveloperInput extends DeveloperInput {
  resolvedValues: ResolvedValues;
  onChunkByAgent?: (label: DeveloperLabel, chunk: string) => void;
}

// ─── Issue routing ─────────────────────────────────────────────────────────

// Canonical category -> bucket map. Prefer `issue.category` when present;
// fall back to title heuristic for legacy issues without a category tag.
const B_CATEGORIES = new Set<string>([
  'narrative_accuracy',
  'property_type_drift',
  'hallucinated_figure',
  'inspector_guidance',
  'negotiation_mismatch',
  'verdict_questionable',
  'str_math',
  'prose_factual',
]);
const B_TITLE_MARKERS = [
  'narrative', 'hallucinat', 'property type', 'row home', 'row house',
  'inspector', 'negotiation', 'str math', 'str comp', 'verdict',
  'pass verdict', 'prose', 'description',
];

export function categorizeIssue(issue: ConsolidatedIssue): 'A' | 'B' {
  if (issue.category && B_CATEGORIES.has(issue.category)) return 'B';
  if (issue.category) return 'A'; // any tagged category not in B -> A
  if (issue.source === 'narrative_accuracy') return 'B';
  const t = issue.title.toLowerCase();
  if (B_TITLE_MARKERS.some((m) => t.includes(m))) return 'B';
  return 'A';
}

export function splitIssuesForAgents(issues: ConsolidatedIssue[]): {
  agentA: ConsolidatedIssue[];
  agentB: ConsolidatedIssue[];
} {
  const checked = issues.filter((i) => i.checked);
  const agentA: ConsolidatedIssue[] = [];
  const agentB: ConsolidatedIssue[] = [];
  for (const i of checked) {
    if (categorizeIssue(i) === 'A') agentA.push(i);
    else agentB.push(i);
  }
  return { agentA, agentB };
}

// ─── Rebalance ─────────────────────────────────────────────────────────────
// DealDoctor audits are calc-heavy in practice (most issues are numeric and
// flow to Andy). When the natural split lands >60/40, peel the safest items
// from Andy's bucket into Kevin's and track which files Kevin needs access
// to this run.

const ANDY_HOT_SPOTS = /\b(calculations|propertyApi|rates|studentHousing|climateRisk|entitlements)\b/i;
const NARRATIVE_WORDS = /(narrative|prose|description|label|warning|banner|render|template|component|page|headline|copy|message)/i;

function safetyScore(i: ConsolidatedIssue): number {
  // Higher score = safer to rebalance from Andy to Kevin.
  const text = `${i.title} ${i.fix ?? ''} ${i.reportSays ?? ''} ${i.actuallyFound ?? ''}`.toLowerCase();
  let score = 0;
  if (NARRATIVE_WORDS.test(text)) score += 100;
  if (ANDY_HOT_SPOTS.test(text)) score -= 100;
  if (i.severity === 'LOW') score += 15;
  else if (i.severity === 'MEDIUM') score += 6;
  else if (i.severity === 'CRITICAL') score -= 25;
  return score;
}

// Heuristic file inference — map an issue to the files its fix is most
// likely to touch. Used to build Kevin's per-run allowlist.
function inferFilesForIssue(i: ConsolidatedIssue): string[] {
  const text = `${i.title} ${i.fix ?? ''}`.toLowerCase();
  const files: string[] = [];
  if (/hoa|comp|appreciation|rent\b|avm|zip|market/.test(text)) files.push('lib/reportGenerator.ts');
  if (/rent-control|warning|diagnosis|prompt|narrative|row home|row house/.test(text)) {
    files.push('lib/dealDoctor.ts');
    files.push('lib/reportGenerator.ts');
  }
  if (/breakeven|irr|cashflow|wealth|sensitivity/.test(text)) files.push('lib/calculations.ts');
  if (/str|short-term/.test(text)) files.push('lib/reportGenerator.ts');
  if (/property type|bedroom|studio|year built/.test(text)) {
    files.push('lib/reportGenerator.ts');
    files.push('lib/dealDoctor.ts');
  }
  return Array.from(new Set(files));
}

export function rebalanceBuckets(
  agentA: ConsolidatedIssue[],
  agentB: ConsolidatedIssue[]
): {
  agentA: ConsolidatedIssue[];
  agentB: ConsolidatedIssue[];
  peeled: ConsolidatedIssue[];
  kevinExtraAllowed: string[];
} {
  const total = agentA.length + agentB.length;
  if (total < 3 || agentA.length / total <= 0.6) {
    return { agentA, agentB, peeled: [], kevinExtraAllowed: [] };
  }
  const target = Math.ceil(total / 2);
  const toPeel = agentA.length - target;
  if (toPeel <= 0) {
    return { agentA, agentB, peeled: [], kevinExtraAllowed: [] };
  }
  // Sort Andy's bucket by safety to hand off (highest score first).
  const sorted = [...agentA].sort((a, b) => safetyScore(b) - safetyScore(a));
  const peeled = sorted.slice(0, toPeel);
  const keptA = agentA.filter((x) => !peeled.includes(x));
  // Kevin needs the union of inferred files for every peeled issue, plus
  // `lib/reportGenerator.ts` as a catch-all since most peeled fixes land there.
  const allow = new Set<string>();
  for (const p of peeled) for (const f of inferFilesForIssue(p)) allow.add(f);
  return {
    agentA: keptA,
    agentB: [...agentB, ...peeled],
    peeled,
    kevinExtraAllowed: Array.from(allow),
  };
}

// ─── Resolved values — what the audit agents say is CORRECT ────────────────

export function extractResolvedValues(issues: ConsolidatedIssue[]): ResolvedValues {
  const out: ResolvedValues = {};
  for (const issue of issues) {
    const evidence = [issue.actuallyFound, issue.structuredData, issue.conflict]
      .filter(Boolean)
      .join(' | ');
    if (!evidence) continue;
    const t = issue.title.toLowerCase();

    // rent — only accept values that look plausible for monthly rent
    if (t.includes('rent')) {
      const m = evidence.match(/\$?\s*([\d,]+(?:\.\d+)?)\s*(?:\/mo|\/month)?/i);
      if (m) {
        const n = parseFloat(m[1].replace(/,/g, ''));
        if (n > 200 && n < 20_000) out.rentEstimate = Math.round(n);
      }
    }
    if (t.includes('property type') || t.includes('row home') || t.includes('row house')) {
      // look for "propertyType: X" or "is a X" patterns
      const m =
        evidence.match(/propertyType[:"\s]+([a-z][\w\s-]{2,20})/i) ??
        evidence.match(/is a (?:high-rise |low-rise |mid-rise )?(condo|apartment|townhouse|row home|row house|single family|sfr|duplex|triplex)/i);
      if (m) out.propertyType = m[1].trim().toLowerCase();
    }
    if (t.includes('hoa')) {
      const m = evidence.match(/\$?\s*([\d,]+)\s*(?:\/mo|\/month)?/i);
      if (m) {
        const n = parseFloat(m[1].replace(/,/g, ''));
        if (n >= 0 && n < 5000) out.hoa = Math.round(n);
      }
    }
    if (t.includes('avm') || t.includes('value')) {
      const m = evidence.match(/\$\s*([\d,]+)/);
      if (m) {
        const n = parseFloat(m[1].replace(/,/g, ''));
        if (n > 10_000) out.avm = Math.round(n);
      }
    }
    if (t.includes('breakeven')) {
      const m = evidence.match(/\$\s*([\d,]+)/);
      if (m) {
        const n = parseFloat(m[1].replace(/,/g, ''));
        if (n > 10_000) out.breakeven = Math.round(n);
      }
    }
    if (t.includes('dscr')) {
      const m = evidence.match(/([\d.]+)/);
      if (m) out.dscr = parseFloat(m[1]);
    }
  }
  return out;
}

// ─── Single agent runner ───────────────────────────────────────────────────

async function runSingleDevAgent(
  label: DeveloperLabel,
  scopeAllowed: string[],
  scopeForbidden: string[],
  address: string,
  issues: ConsolidatedIssue[],
  resolvedValues: ResolvedValues,
  userNotes: string | undefined,
  repoRoot: string,
  extraAllowed: string[],
  onChunk?: (chunk: string) => void
): Promise<SingleDeveloperResult> {
  if (issues.length === 0) {
    return { label, fixesApplied: [], skipped: [] };
  }
  const sys = BASE_SYSTEM(scopeAllowed, scopeForbidden, label, extraAllowed);
  const userPrompt = buildPrompt(address, issues, resolvedValues, userNotes, label);
  const transcript = await runClaude({
    systemPrompt: sys,
    userPrompt,
    cwd: repoRoot,
    allowWrite: true,
    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'],
    timeoutMs: 30 * 60_000,
    onChunk,
  });
  return parseSingleTranscript(label, transcript);
}

function buildPrompt(
  address: string,
  issues: ConsolidatedIssue[],
  resolvedValues: ResolvedValues,
  userNotes: string | undefined,
  label: DeveloperLabel
): string {
  const lines: string[] = [];
  lines.push(`Working directory is the DealDoctor repo. Target address for regeneration after fixes: ${address}`);
  lines.push('');
  if (userNotes) {
    lines.push(`OPERATOR NOTES:`);
    lines.push(userNotes);
    lines.push('');
  }

  // Agent B (narrative/templates) uses resolvedValues as hard constraints.
  // Agent A can consult them as hints, but the authoritative source is code.
  if (label === 'KEVIN' && Object.keys(resolvedValues).length > 0) {
    lines.push('## RESOLVED VALUES — use these as hard constraints in narrative prompts:');
    if (resolvedValues.rentEstimate != null) {
      lines.push(`- The rent estimate is $${resolvedValues.rentEstimate}/mo. Use this exact figure — do not invent a different one.`);
    }
    if (resolvedValues.propertyType) {
      lines.push(`- The property type is "${resolvedValues.propertyType}". Do not describe it as anything else.`);
    }
    if (resolvedValues.hoa != null) {
      lines.push(`- HOA is $${resolvedValues.hoa}/mo.`);
    }
    if (resolvedValues.avm != null) {
      lines.push(`- AVM / estimated value is $${resolvedValues.avm.toLocaleString()}.`);
    }
    if (resolvedValues.breakeven != null) {
      lines.push(`- Breakeven price is $${resolvedValues.breakeven.toLocaleString()}.`);
    }
    if (resolvedValues.dscr != null) {
      lines.push(`- DSCR is ${resolvedValues.dscr}.`);
    }
    lines.push('');
  }

  lines.push(`APPROVED BUGS IN YOUR SCOPE (${issues.length}):`);
  lines.push('');
  for (const issue of issues) {
    lines.push(`## [${issue.severity}] ${issue.title}  (found by ${issue.source})`);

    // Recurrence warning — tell the dev this bug survived prior fix attempts.
    if (issue.priorAttempts && issue.priorAttempts.length > 0) {
      const n = issue.priorAttempts.length;
      lines.push(`⚠ RECURRING — ${n} prior fix attempt${n === 1 ? '' : 's'} failed. The bug came back, which means the patch did not address the root cause. Do NOT repeat the same surface-level change — read the prior attempts, understand why they didn't stick, and go deeper.`);
      for (const a of issue.priorAttempts) {
        if (a.outcome === 'applied') {
          const by = a.fixedBy ?? '?';
          const f = a.file ? ` → ${a.file}` : '';
          lines.push(`  · Run ${a.runNumber} (${by} applied)${f}: ${a.change ?? '(no summary)'}`);
        } else {
          const by = a.fixedBy ?? '?';
          lines.push(`  · Run ${a.runNumber} (${by} skipped): ${a.reason ?? '(no reason given)'}`);
        }
      }
      lines.push('');
    }

    if (issue.reportSays) lines.push(`Report says: ${issue.reportSays}`);
    if (issue.actuallyFound) lines.push(`Actually: ${issue.actuallyFound}`);
    if (issue.conflict) lines.push(`Conflict: ${issue.conflict}`);
    if (issue.narrativeText) lines.push(`Narrative: ${issue.narrativeText}`);
    if (issue.structuredData) lines.push(`Structured data: ${issue.structuredData}`);
    lines.push(`Suggested fix: ${issue.fix}`);
    lines.push('');
  }
  lines.push(`When done, end your response with the ===FIXES=== JSON block.`);
  return lines.join('\n');
}

function parseSingleTranscript(label: DeveloperLabel, transcript: string): SingleDeveloperResult {
  const m = transcript.match(/===FIXES===([\s\S]*?)===END===/);
  if (!m) {
    return { label, fixesApplied: [], skipped: [], rawTranscript: transcript };
  }
  try {
    const parsed = JSON.parse(m[1].trim());
    return {
      label,
      fixesApplied: parsed.fixesApplied ?? [],
      skipped: parsed.skipped ?? [],
      testsRun: parsed.testsRun,
      testsPassed: parsed.testsPassed,
      testsFailed: parsed.testsFailed,
      rawTranscript: transcript,
    };
  } catch {
    return { label, fixesApplied: [], skipped: [], rawTranscript: transcript };
  }
}

// ─── Parallel two-agent dispatcher ─────────────────────────────────────────

export interface RunTwoDevsOptions extends SplitDeveloperInput {
  onTestsStart?: () => void;
  onTestsDone?: (summary: { testsRun?: number; testsPassed?: number; testsFailed?: number }) => void;
  onTestWriterStart?: () => void;
  onTestWriterChunk?: (chunk: string) => void;
  onTestWriterDone?: (result: TestWriterResult) => void;
  onReviewerStart?: () => void;
  onReviewerChunk?: (chunk: string) => void;
  onReviewerDone?: (result: ReviewerResult) => void;
}

export async function runTwoDeveloperAgents(input: RunTwoDevsOptions): Promise<DeveloperResult> {
  const { agentA: rawA, agentB: rawB } = splitIssuesForAgents(input.issues);
  const { agentA, agentB, peeled, kevinExtraAllowed } = rebalanceBuckets(rawA, rawB);
  const resolvedValues = input.resolvedValues ?? extractResolvedValues(input.issues);

  console.log(
    `[qa] dispatched: andy=${agentA.length} kevin=${agentB.length} ` +
      `(natural split was ${rawA.length}/${rawB.length}; peeled ${peeled.length} to kevin)`
  );

  // ── Pre-pass: OSCAR writes failing tests for CRITICAL/HIGH issues ──
  input.onTestWriterStart?.();
  const testWriter = await runTestWriterAgent({
    address: input.address,
    issues: input.issues,
    repoRoot: input.repoRoot,
    onChunk: input.onTestWriterChunk,
  });
  console.log(
    `[qa] oscar wrote ${testWriter.testsWritten.length} test${testWriter.testsWritten.length === 1 ? '' : 's'}, skipped ${testWriter.skipped.length}`
  );
  input.onTestWriterDone?.(testWriter);

  // Map each issue → Oscar's test file (if written) so Andy+Kevin know which
  // test they must make pass.
  const testByBug = new Map<string, string>();
  for (const t of testWriter.testsWritten) testByBug.set(t.bug.toLowerCase(), t.testFile);
  const withTestRef = (arr: ConsolidatedIssue[]) =>
    arr.map((i) => {
      const f = testByBug.get(i.title.toLowerCase());
      if (!f) return i;
      // Append the test path to the suggested fix so it lands in the dev prompt.
      return {
        ...i,
        fix: `${i.fix}\n  [TEST TO PASS]: ${f}`,
      };
    });

  const [resultA, resultB] = await Promise.all([
    runSingleDevAgent(
      'ANDY',
      SCOPE_A_PATHS,
      SCOPE_A_FORBIDDEN,
      input.address,
      withTestRef(agentA),
      resolvedValues,
      input.userNotes,
      input.repoRoot,
      [],
      (c) => input.onChunkByAgent?.('ANDY', c)
    ),
    runSingleDevAgent(
      'KEVIN',
      SCOPE_B_PATHS,
      SCOPE_B_FORBIDDEN.filter((p) => !kevinExtraAllowed.some((a) => p.startsWith(a))),
      input.address,
      withTestRef(agentB),
      resolvedValues,
      input.userNotes,
      input.repoRoot,
      kevinExtraAllowed,
      (c) => input.onChunkByAgent?.('KEVIN', c)
    ),
  ]);

  // Conflict detection — any file both agents modified.
  const filesA = new Set(resultA.fixesApplied.map((f) => f.file).filter(Boolean) as string[]);
  const filesB = new Set(resultB.fixesApplied.map((f) => f.file).filter(Boolean) as string[]);
  const conflicts: string[] = [];
  for (const f of filesA) if (filesB.has(f)) conflicts.push(f);

  // ── Post-pass: TOBY reviews the diff before we run tests ──
  input.onReviewerStart?.();
  const reviewer = await runReviewerAgent({
    repoRoot: input.repoRoot,
    devResult: {
      fixesApplied: [
        ...resultA.fixesApplied.map((f) => ({ ...f, fixedBy: 'ANDY' as const })),
        ...resultB.fixesApplied.map((f) => ({ ...f, fixedBy: 'KEVIN' as const })),
      ],
      skipped: [
        ...resultA.skipped.map((s) => ({ ...s, skippedBy: 'ANDY' as const })),
        ...resultB.skipped.map((s) => ({ ...s, skippedBy: 'KEVIN' as const })),
      ],
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    },
    onChunk: input.onReviewerChunk,
  });
  console.log(`[qa] toby verdict: ${reviewer.verdict} (${reviewer.concerns.length} concern${reviewer.concerns.length === 1 ? '' : 's'})`);
  input.onReviewerDone?.(reviewer);

  // Shared npm test — one run after both devs + reviewer finish. If Toby
  // verdicts BLOCK, skip the test run to save time and surface the concerns.
  let tests: Awaited<ReturnType<typeof runSharedTests>> = {};
  if (reviewer.verdict !== 'block') {
    input.onTestsStart?.();
    tests = await runSharedTests(input.repoRoot);
    input.onTestsDone?.(tests);
  }

  return {
    fixesApplied: [
      ...resultA.fixesApplied.map((f) => ({ ...f, fixedBy: 'ANDY' as const })),
      ...resultB.fixesApplied.map((f) => ({ ...f, fixedBy: 'KEVIN' as const })),
    ],
    skipped: [
      ...resultA.skipped.map((s) => ({ ...s, skippedBy: 'ANDY' as const })),
      ...resultB.skipped.map((s) => ({ ...s, skippedBy: 'KEVIN' as const })),
    ],
    testsRun: tests.testsRun,
    testsPassed: tests.testsPassed,
    testsFailed: tests.testsFailed,
    rawTranscript:
      `=== ANDY (A) ===\n${resultA.rawTranscript ?? ''}\n\n=== KEVIN (B) ===\n${resultB.rawTranscript ?? ''}`,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
    resolvedValues,
    perAgent: { ANDY: resultA, KEVIN: resultB },
    testWriter,
    reviewer,
  };
}

// ─── Shared npm test ───────────────────────────────────────────────────────

function runSharedTests(
  repoRoot: string
): Promise<{ testsRun?: number; testsPassed?: number; testsFailed?: number }> {
  return new Promise((resolve) => {
    const bin = os.platform() === 'win32' ? 'npm.cmd' : 'npm';
    const proc = spawn(bin, ['test', '--silent'], {
      cwd: repoRoot,
      env: process.env,
      shell: os.platform() === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    proc.stderr.on('data', (d: Buffer) => (out += d.toString('utf8')));
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({});
    }, 10 * 60_000);
    proc.on('close', () => {
      clearTimeout(timer);
      // vitest output like "Tests  352 passed | 0 failed"
      const m = out.match(/Tests\s+(\d+)\s+passed(?:\s*\|\s*(\d+)\s+failed)?/i);
      if (m) {
        const passed = parseInt(m[1], 10);
        const failed = m[2] ? parseInt(m[2], 10) : 0;
        resolve({ testsRun: passed + failed, testsPassed: passed, testsFailed: failed });
      } else {
        resolve({});
      }
    });
    proc.on('error', () => {
      clearTimeout(timer);
      resolve({});
    });
  });
}

// Back-compat — if someone still wants a single-agent run, delegate to KEVIN
// with no scope restriction. Used only if old call sites remain.
export async function runDeveloperAgent(input: DeveloperInput): Promise<DeveloperResult> {
  return runTwoDeveloperAgents({
    ...input,
    resolvedValues: extractResolvedValues(input.issues),
  });
}

export const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
