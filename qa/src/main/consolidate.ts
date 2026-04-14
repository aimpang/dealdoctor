import type { AgentReport, ConsolidatedIssue, Issue } from '../shared/types';

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

export function consolidateReports(reports: AgentReport[]): ConsolidatedIssue[] {
  const all: Array<Issue & { source: AgentReport['agent'] }> = [];
  for (const r of reports) {
    for (const issue of r.issues) {
      all.push({ ...issue, source: r.agent });
    }
  }
  all.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return all.map((issue, id) => ({ id, checked: true, ...issue }));
}

export function countBySeverity(issues: ConsolidatedIssue[]) {
  const out = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const i of issues) {
    if (i.severity === 'CRITICAL') out.critical++;
    else if (i.severity === 'HIGH') out.high++;
    else if (i.severity === 'MEDIUM') out.medium++;
    else if (i.severity === 'LOW') out.low++;
  }
  return out;
}
