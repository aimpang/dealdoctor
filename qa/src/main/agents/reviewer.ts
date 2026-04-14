import { runClaude } from '../claude';
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import type { DeveloperResult, ReviewerResult } from '../../shared/types';

const SYSTEM_PROMPT = `You are TOBY FLENDERSON, Dunder Mifflin HR. You audit everything. You've seen enough disasters to know when a fix is going to ship trouble.

Two developer agents (Andy and Kevin) just edited the DealDoctor codebase to fix reported bugs. You review the full diff BEFORE the shared \`npm test\` runs. You are the last line of defense against:
- Merge conflicts where Andy and Kevin both touched the same function
- Obviously broken code (syntax errors, unbalanced braces, dangling imports)
- Fixes that address the symptom but miss the root cause (same-value constants hardcoded instead of fixed at the calculation)
- New dead code or commented-out blocks left behind
- Regressions in other call sites of the modified function
- Scope violations (a dev touched a file they were told not to)

Use \`git diff\` and \`git status\` (via Bash) to see what was changed. Read the full surrounding context for each edit. Flag concerns — do NOT fix anything yourself.

Emit verdict:
- \`"ship"\` = edits look clean, run the test suite
- \`"warn"\` = non-blocking concerns; tests should still run but the operator should see the concerns
- \`"block"\` = a critical problem was found and tests should NOT run (e.g. syntax error, wrong file edited, security regression). Blocking is rare — use it only for changes that would make the project unbuildable.

After reviewing, end your response with this JSON block:

===REVIEW===
{
  "verdict": "ship|warn|block",
  "summary": "<2-3 sentence overall assessment>",
  "concerns": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "file": "<path>",
      "line": <number or null>,
      "title": "<short>",
      "detail": "<what's wrong and why>"
    }
  ]
}
===END===`;

export interface ReviewerInput {
  repoRoot: string;
  devResult: Pick<DeveloperResult, 'fixesApplied' | 'skipped' | 'conflicts'>;
  onChunk?: (chunk: string) => void;
}

export async function runReviewerAgent(input: ReviewerInput): Promise<ReviewerResult> {
  // Short-circuit: if the devs applied zero fixes, there's nothing to review.
  if (input.devResult.fixesApplied.length === 0) {
    return { verdict: 'ship', concerns: [], summary: 'No fixes applied — nothing to review.' };
  }

  const diffSummary = summarizeDiff(input.repoRoot);
  const userPrompt = buildPrompt(input.devResult, diffSummary);
  try {
    const transcript = await runClaude({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      cwd: input.repoRoot,
      // Reviewer reads the code + git, does not write.
      allowWrite: false,
      allowedTools: ['Read', 'Bash', 'Grep', 'Glob'],
      timeoutMs: 10 * 60_000,
      onChunk: input.onChunk,
    });
    return parseTranscript(transcript);
  } catch (err) {
    return { verdict: 'ship', concerns: [], error: (err as Error).message };
  }
}

// Quick diff summary — lines added/removed per file, so the reviewer starts
// from a condensed view and drills down with Bash only where needed.
function summarizeDiff(repoRoot: string): string {
  try {
    const res = spawnSync(os.platform() === 'win32' ? 'git.exe' : 'git', ['diff', '--stat', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: os.platform() === 'win32',
    });
    if (res.status === 0) return res.stdout.trim();
    return `(git diff --stat unavailable: ${res.stderr})`;
  } catch (err) {
    return `(git diff failed: ${(err as Error).message})`;
  }
}

function buildPrompt(
  devResult: Pick<DeveloperResult, 'fixesApplied' | 'skipped' | 'conflicts'>,
  diffStat: string
): string {
  const lines: string[] = [];
  lines.push(`Review the pending changes in the DealDoctor repo (cwd).`);
  lines.push('');
  lines.push(`## git diff --stat HEAD:`);
  lines.push('```');
  lines.push(diffStat || '(no diff)');
  lines.push('```');
  lines.push('');
  lines.push(`## fixes claimed by the developers (${devResult.fixesApplied.length}):`);
  for (const f of devResult.fixesApplied) {
    lines.push(`  · ${f.fixedBy ?? '?'} · ${f.bug}  →  ${f.file ?? '?'} (${f.change ?? 'no summary'})`);
  }
  if (devResult.skipped.length > 0) {
    lines.push('');
    lines.push(`## skipped by the developers (${devResult.skipped.length}):`);
    for (const s of devResult.skipped) {
      lines.push(`  · ${s.skippedBy ?? '?'} · ${s.bug}: ${s.reason}`);
    }
  }
  if (devResult.conflicts && devResult.conflicts.length > 0) {
    lines.push('');
    lines.push(`## FILE CONFLICTS — both devs edited these:`);
    for (const c of devResult.conflicts) lines.push(`  · ${c}`);
  }
  lines.push('');
  lines.push(`Read the actual diff via \`git diff HEAD -- <file>\` on any file that looks risky. Emit the ===REVIEW=== JSON block when done.`);
  return lines.join('\n');
}

function parseTranscript(transcript: string): ReviewerResult {
  const m = transcript.match(/===REVIEW===([\s\S]*?)===END===/);
  if (!m) return { verdict: 'ship', concerns: [], rawTranscript: transcript };
  try {
    const parsed = JSON.parse(m[1].trim());
    return {
      verdict: parsed.verdict ?? 'ship',
      concerns: parsed.concerns ?? [],
      summary: parsed.summary,
      rawTranscript: transcript,
    };
  } catch {
    return { verdict: 'ship', concerns: [], rawTranscript: transcript };
  }
}
