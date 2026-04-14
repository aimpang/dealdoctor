import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LoopState } from '../shared/types';
import { exportsDir } from './state';

export function exportMarkdown(state: LoopState): string {
  const lines: string[] = [];
  lines.push(`# DealDoctor QA Audit Trail`);
  lines.push('');
  lines.push(`**Address:** ${state.address}`);
  lines.push(`**Started:** ${state.startedAt}`);
  lines.push(`**Runs:** ${state.runs.length}`);
  lines.push('');

  if (state.runs.length > 0) {
    const first = state.runs[0];
    const last = state.runs[state.runs.length - 1];
    const firstTotal = first.consolidated.length;
    const lastTotal = last.consolidated.length;
    lines.push(`**Summary:** Started with ${firstTotal} issues. After ${state.runs.length} run(s): ${lastTotal} issue(s) remaining.`);
    lines.push('');
  }

  for (const run of state.runs) {
    lines.push(`---`);
    lines.push('');
    lines.push(`## Run ${run.number} — ${run.timestamp}`);
    lines.push('');
    lines.push(`- PDF: \`${run.pdfPath}\``);
    lines.push(`- Totals: ${run.totals.critical} critical, ${run.totals.high} high, ${run.totals.medium} medium, ${run.totals.low} low`);
    lines.push('');
    for (const report of run.reports) {
      lines.push(`### Agent: ${report.agent} (grade ${report.grade}${report.error ? ` — ERROR: ${report.error}` : ''})`);
      if (report.issues.length === 0) {
        lines.push('- No issues found.');
      } else {
        for (const issue of report.issues) {
          lines.push(`- **[${issue.severity}] ${issue.title}**`);
          if (issue.reportSays) lines.push(`  - Report says: ${issue.reportSays}`);
          if (issue.actuallyFound) lines.push(`  - Actually: ${issue.actuallyFound}`);
          if (issue.conflict) lines.push(`  - Conflict: ${issue.conflict}`);
          if (issue.narrativeText) lines.push(`  - Narrative: ${issue.narrativeText}`);
          if (issue.structuredData) lines.push(`  - Structured: ${issue.structuredData}`);
          lines.push(`  - Fix: ${issue.fix}`);
        }
      }
      lines.push('');
    }
  }

  const content = lines.join('\n');
  const slug = state.address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const out = path.join(exportsDir(), `${slug}-${Date.now()}.md`);
  fs.writeFileSync(out, content, 'utf8');
  return out;
}
