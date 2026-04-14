import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentEvent, AgentKey, AgentPhase, ConsolidatedIssue, Grade, LoopState, Severity, StatusEvent } from '../shared/types';
import { AgentRoom } from './AgentRoom';

type IssueStatus = 'new' | 'recurring' | 'fixed';
interface HistoryItem extends ConsolidatedIssue {
  status: IssueStatus;
  firstSeenRun: number;
}

function idKey(i: ConsolidatedIssue): string {
  // Prefer category when the agent tagged one — survives wording drift.
  if (i.category) return `${i.source}|${i.category}`;
  return `${i.source}|${i.severity}|${i.title.toLowerCase().trim()}`;
}
function firstRunSeen(state: LoopState, key: string): number {
  for (let i = 0; i < state.runs.length; i++) {
    if (state.runs[i].consolidated.some((x) => idKey(x) === key)) return i + 1;
  }
  return state.runs.length;
}

type Pane = 'issues' | 'pdf';

const SOURCE_GLYPH = {
  market_accuracy: 'M',
  internal_consistency: 'C',
  narrative_accuracy: 'N',
} as const;

const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

interface AgentTile {
  phase: AgentPhase;
  transcript: string;
  message?: string;
  grade?: Grade;
  issueCount?: number;
  error?: string;
}

const AGENT_ORDER: AgentKey[] = ['market', 'consistency', 'narrative', 'developerA', 'developerB'];

const AGENT_META: Record<AgentKey, { label: string; glyph: string; kind: string }> = {
  market:      { label: 'MARKET',      glyph: 'M', kind: 'web search + AVM check' },
  consistency: { label: 'CONSISTENCY', glyph: 'C', kind: 'pure-code invariants' },
  narrative:   { label: 'NARRATIVE',   glyph: 'N', kind: 'AI prose fact-check' },
  developerA:  { label: 'ANDY · DATA', glyph: 'A', kind: 'data / calc / api fixes' },
  developerB:  { label: 'KEVIN · NARR', glyph: 'K', kind: 'narrative / template fixes' },
};

const emptyTile = (): AgentTile => ({ phase: 'idle', transcript: '' });

export function App() {
  const [address, setAddress] = useState('');
  const [state, setState] = useState<LoopState | null>(null);
  const [statusPhase, setStatusPhase] = useState<LoopState['status']>('idle');
  const [statusMsg, setStatusMsg] = useState<string>('Ready');
  const [activePane, setActivePane] = useState<Pane>('issues');
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [agents, setAgents] = useState<Record<AgentKey, AgentTile>>(() => ({
    market: emptyTile(),
    consistency: emptyTile(),
    narrative: emptyTile(),
    testwriter: emptyTile(),
    developerA: emptyTile(),
    developerB: emptyTile(),
    reviewer: emptyTile(),
  }));
  const [openDrawer, setOpenDrawer] = useState<AgentKey | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentRun = state?.runs[state.runs.length - 1] ?? null;
  const totals = currentRun?.totals ?? { critical: 0, high: 0, medium: 0, low: 0 };
  const agentErrors = (currentRun?.reports ?? [])
    .filter((r) => r.error)
    .map((r) => ({ agent: r.agent, error: r.error as string }));

  // Accumulate issues across all runs, tagging each with a lifecycle status.
  // NEW       → appears only in the latest run
  // RECURRING → appears in the latest run AND at least one prior run
  // FIXED     → appeared in a prior run but is absent from the latest run
  const history = useMemo((): HistoryItem[] => {
    if (!state || state.runs.length === 0) return [];
    const latest = state.runs[state.runs.length - 1].consolidated;
    const latestKeys = new Set(latest.map(idKey));
    const priorKeys = new Set<string>();
    for (let i = 0; i < state.runs.length - 1; i++) {
      for (const issue of state.runs[i].consolidated) priorKeys.add(idKey(issue));
    }

    const out: HistoryItem[] = latest.map((i) => ({
      ...i,
      status: priorKeys.has(idKey(i)) ? 'recurring' : 'new',
      firstSeenRun: firstRunSeen(state, idKey(i)),
    }));

    // Fixed = keys that were in prior runs but not in latest
    const seenInLatest = new Set(latest.map(idKey));
    const fixedMap = new Map<string, HistoryItem>();
    for (let i = 0; i < state.runs.length - 1; i++) {
      for (const issue of state.runs[i].consolidated) {
        const k = idKey(issue);
        if (!seenInLatest.has(k) && !fixedMap.has(k)) {
          fixedMap.set(k, { ...issue, id: 10_000 + fixedMap.size, status: 'fixed', firstSeenRun: i + 1 });
        }
      }
    }
    for (const f of fixedMap.values()) out.push(f);
    return out;
  }, [state]);

  const grouped = useMemo(() => {
    const out: Record<Severity, HistoryItem[]> = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] };
    for (const i of history) out[i.severity].push(i);
    return out;
  }, [history]);

  const flatOrder = useMemo(() => {
    // Order within each severity: NEW first, then RECURRING, then FIXED (bottom).
    const rank = (s: IssueStatus) => (s === 'new' ? 0 : s === 'recurring' ? 1 : 2);
    const flat: HistoryItem[] = [];
    for (const s of SEVERITY_ORDER) {
      flat.push(...[...grouped[s]].sort((a, b) => rank(a.status) - rank(b.status)));
    }
    return flat;
  }, [grouped]);

  const issues = history; // keep the name around for the `f` keybinding

  const loopClosed = state?.status === 'done';
  const busy = statusPhase === 'capturing' || statusPhase === 'auditing' || statusPhase === 'fixing';

  // ─── live status stream ───
  useEffect(() => {
    const off = window.qa.onStatus((e: StatusEvent) => {
      setStatusPhase(e.phase);
      setStatusMsg(e.message);
      if (e.phase === 'capturing') {
        // Reset all agent tiles at the start of a new run.
        setAgents({
          market: emptyTile(),
          consistency: emptyTile(),
          narrative: emptyTile(),
          testwriter: emptyTile(),
          developerA: emptyTile(),
          developerB: emptyTile(),
          reviewer: emptyTile(),
        });
      }
    });
    return off;
  }, []);

  // ─── per-agent live stream ───
  useEffect(() => {
    const off = window.qa.onAgent((e: AgentEvent) => {
      setAgents((prev) => {
        const cur = prev[e.agent] ?? emptyTile();
        const next: AgentTile = {
          phase: e.phase,
          transcript: e.chunk ? (cur.transcript + e.chunk).slice(-20000) : cur.transcript,
          message: e.message ?? cur.message,
          grade: e.grade ?? cur.grade,
          issueCount: e.issueCount ?? cur.issueCount,
          error: e.error ?? cur.error,
        };
        return { ...prev, [e.agent]: next };
      });
    });
    return off;
  }, []);

  // ─── load pdf when it changes ───
  useEffect(() => {
    if (!currentRun?.pdfPath) {
      setPdfUrl(null);
      return;
    }
    let cancelled = false;
    window.qa.readPdf(currentRun.pdfPath).then((buf) => {
      if (cancelled || !buf) return;
      const blob = new Blob([buf], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [currentRun?.pdfPath]);

  // ─── keyboard ───
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') (document.activeElement as HTMLElement).blur();
        return;
      }
      if (notesOpen) return;

      if (e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        setActivePane((p) => (p === 'issues' ? 'pdf' : 'issues'));
        return;
      }
      if (activePane === 'issues' && flatOrder.length > 0) {
        if (e.key === 'j' || e.key === 'ArrowDown') {
          e.preventDefault();
          setCursor((c) => Math.min(flatOrder.length - 1, c + 1));
          return;
        }
        if (e.key === 'k' || e.key === 'ArrowUp') {
          e.preventDefault();
          setCursor((c) => Math.max(0, c - 1));
          return;
        }
        if (e.key === ' ') {
          e.preventDefault();
          toggleChecked(flatOrder[cursor].id);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          toggleExpanded(flatOrder[cursor].id);
          return;
        }
        if (e.key === 'A') {
          setChecked(true);
          return;
        }
        if (e.key === 'D') {
          setChecked(false);
          return;
        }
      }
      if (e.key === 'f' && issues.length > 0 && !busy && !loopClosed) {
        e.preventDefault();
        setNotesOpen(true);
      }
      if (e.key === 'a' && state && !busy && !loopClosed) {
        e.preventDefault();
        onAccept();
      }
      if (e.key === 'e' && state) {
        e.preventDefault();
        onExport();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activePane, flatOrder, cursor, issues, state, busy, loopClosed, notesOpen]);

  function toggleChecked(id: number) {
    if (!state || !currentRun) return;
    const next = { ...state };
    const run = next.runs[next.runs.length - 1];
    run.consolidated = run.consolidated.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i));
    setState(next);
  }
  function setChecked(v: boolean) {
    if (!state || !currentRun) return;
    const next = { ...state };
    const run = next.runs[next.runs.length - 1];
    run.consolidated = run.consolidated.map((i) => ({ ...i, checked: v }));
    setState(next);
  }
  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  async function onStart() {
    const trimmed = address.trim();
    if (!trimmed) {
      flash('enter an address');
      return;
    }
    setStatusPhase('capturing');
    setStatusMsg('Starting…');
    const s = await window.qa.start(trimmed);
    setState(s);
  }
  async function onFix() {
    if (!state || !currentRun) return;
    setNotesOpen(false);
    setStatusPhase('fixing');
    try {
      const { state: next } = await window.qa.fix({
        address: state.address,
        issues: currentRun.consolidated,
        notes: notes.trim() || undefined,
      });
      setState(next);
      setNotes('');
      setCursor(0);
      flash('run complete');
    } catch (err) {
      flash('fix failed — see status');
      console.error(err);
    }
  }
  async function onAccept() {
    if (!state) return;
    const next = await window.qa.accept(state.address);
    setState(next);
    flash('report accepted');
  }
  async function onExport() {
    if (!state) return;
    const p = await window.qa.exportTrail(state.address);
    flash(`exported → ${p}`);
  }
  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  // ── close drawer with esc ──
  useEffect(() => {
    if (!openDrawer) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenDrawer(null);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [openDrawer]);

  return (
    <div className="app">
      <div className="titlebar">
        <div className="brand">DEALDOCTOR<span className="brand-sub"> // QA LOOP</span></div>
        <div className="spacer" />
        {state && (
          <div className={`run-pill ${loopClosed ? 'done' : busy ? 'active' : ''}`}>
            RUN {state.runs.length || 0}
          </div>
        )}
      </div>

      <div className="addr">
        <div className="prompt">ADDR ▸</div>
        <input
          ref={inputRef}
          placeholder="1330 New Hampshire Ave NW, Washington, DC 20036"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) onStart();
          }}
          disabled={busy}
        />
        <button className="btn primary" onClick={onStart} disabled={busy}>
          {busy ? <>WORKING<span className="dots" /></> : 'GEN & AUDIT'}
        </button>
        <div className={`status-chip ${statusPhase}`}>
          <span className="dot" />
          <span>{phaseLabel(statusPhase)}</span>
        </div>
      </div>

      <div className="four-panels six-panels">
        <AgentReportPanel
          agentKey="market"
          title="MARKET · DWIGHT"
          accent="var(--high)"
          tile={agents.market}
          history={history.filter((i) => i.source === 'market_accuracy')}
          expanded={expanded}
          onToggleExpand={toggleExpanded}
          onToggleCheck={toggleChecked}
        />
        <AgentReportPanel
          agentKey="consistency"
          title="CONSISTENCY · JIM"
          accent="var(--low)"
          tile={agents.consistency}
          history={history.filter((i) => i.source === 'internal_consistency')}
          expanded={expanded}
          onToggleExpand={toggleExpanded}
          onToggleCheck={toggleChecked}
        />
        <AgentReportPanel
          agentKey="narrative"
          title="NARRATIVE · MICHAEL"
          accent="var(--ok)"
          tile={agents.narrative}
          history={history.filter((i) => i.source === 'narrative_accuracy')}
          expanded={expanded}
          onToggleExpand={toggleExpanded}
          onToggleCheck={toggleChecked}
        />
        <TestWriterPanel tile={agents.testwriter} runs={state?.runs ?? []} />
        <DeveloperPanel tileA={agents.developerA} tileB={agents.developerB} runs={state?.runs ?? []} />
        <ReviewerPanel tile={agents.reviewer} runs={state?.runs ?? []} />
      </div>

      <div className="split">
        <AgentRoom agents={agents} onAgentClick={(k) => setOpenDrawer(k)} />
        <div className="divider" />
        <PdfPanel active={activePane === 'pdf'} onClick={() => setActivePane('pdf')} url={pdfUrl} />
      </div>

      {openDrawer && (
        <AgentDrawer
          which={openDrawer}
          tile={agents[openDrawer]}
          onClose={() => setOpenDrawer(null)}
        />
      )}

      <Keybar
        canFix={issues.length > 0 && !busy && !loopClosed}
        canAccept={!!state && !busy && !loopClosed}
        canExport={!!state}
        statusMsg={statusMsg}
      />

      {toast && <div className="toast">{toast}</div>}

      {notesOpen && (
        <div className="backdrop" onClick={() => setNotesOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>FIX CHECKED ISSUES</h2>
            <div style={{ color: 'var(--dim)', fontSize: 11, marginBottom: 10 }}>
              {issues.filter((i) => i.checked).length} approved / {issues.length - issues.filter((i) => i.checked).length} ignored. Notes (optional):
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Focus on the IRR mismatch first. Don't touch the narrative, just fix the comps."
              autoFocus
            />
            <div className="actions">
              <button className="btn" onClick={() => setNotesOpen(false)}>cancel</button>
              <button className="btn primary" onClick={onFix}>dispatch developer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────

interface IssuesPanelProps {
  active: boolean;
  onClick: () => void;
  grouped: Record<Severity, HistoryItem[]>;
  totals: { critical: number; high: number; medium: number; low: number };
  cursor: number;
  flatOrder: HistoryItem[];
  expanded: Set<number>;
  onToggleCheck: (id: number) => void;
  onToggleExpand: (id: number) => void;
  hasRun: boolean;
  agentErrors: Array<{ agent: string; error: string }>;
}

function IssuesPanel(p: IssuesPanelProps) {
  return (
    <div className={`panel ${p.active ? 'active' : ''}`} onClick={p.onClick}>
      <div className="panel-title">
        <span>◢ ISSUES</span>
        <div className="count-badges">
          <span className={`count-badge ${p.totals.critical ? 'critical' : 'zero'}`}>{p.totals.critical} crit</span>
          <span className={`count-badge ${p.totals.high ? 'high' : 'zero'}`}>{p.totals.high} high</span>
          <span className={`count-badge ${p.totals.medium ? 'medium' : 'zero'}`}>{p.totals.medium} med</span>
          <span className={`count-badge ${p.totals.low ? 'low' : 'zero'}`}>{p.totals.low} low</span>
        </div>
      </div>
      <div className="panel-body">
        {!p.hasRun && (
          <div className="empty-state">
            <pre className="ascii">{`
   ┌─────────────┐
   │ · · · · · · │
   │ · AWAITING· │
   │ · INPUT  · │
   │ · · · · · · │
   └─────────────┘`}</pre>
            enter an address above and press <span style={{ color: 'var(--accent)' }}>GEN & AUDIT</span>
          </div>
        )}
        {p.hasRun && p.flatOrder.length === 0 && (
          <div className="empty-state">
            {p.agentErrors.length > 0 ? (
              <>
                <pre className="ascii" style={{ color: 'var(--crit)' }}>{`
   ╔═════════════╗
   ║  AGENT FAIL ║
   ╚═════════════╝`}</pre>
                <div style={{ textAlign: 'left', maxWidth: 540, margin: '0 auto' }}>
                  {p.agentErrors.map((e, i) => (
                    <div key={i} style={{ marginBottom: 10 }}>
                      <div style={{ color: 'var(--crit)', fontWeight: 700 }}>{e.agent}</div>
                      <div style={{ color: 'var(--muted)', fontSize: 11 }}>{e.error}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <pre className="ascii" style={{ color: 'var(--ok)' }}>{`
   ╔═════════════╗
   ║  ALL CLEAR  ║
   ╚═════════════╝`}</pre>
                no issues detected — press <span style={{ color: 'var(--accent)' }}>a</span> to accept
              </>
            )}
          </div>
        )}
        {SEVERITY_ORDER.map((sev) => {
          const group = p.grouped[sev];
          if (group.length === 0) return null;
          return (
            <div key={sev}>
              <div className={`section-head ${sev}`}>
                {sev} · {group.length}
              </div>
              {group.map((issue) => {
                const flatIdx = p.flatOrder.indexOf(issue);
                const isCursor = p.active && flatIdx === p.cursor;
                const isExpanded = p.expanded.has(issue.id);
                const isFixed = issue.status === 'fixed';
                return (
                  <div
                    key={issue.id}
                    className={`issue status-${issue.status} ${isCursor ? 'cursor' : ''} ${!issue.checked ? 'unchecked' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onToggleExpand(issue.id);
                    }}
                  >
                    <div
                      className="check"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isFixed) p.onToggleCheck(issue.id);
                      }}
                    >
                      {isFixed ? '[✓]' : issue.checked ? '[x]' : '[ ]'}
                    </div>
                    <div className={`sev-dot ${issue.severity}`} />
                    <div className="src" title={issue.source}>{SOURCE_GLYPH[issue.source]}</div>
                    <div>
                      <div className="title-row">
                        <span className="title">{issue.title}</span>
                        <StatusBadge status={issue.status} firstSeen={issue.firstSeenRun} />
                      </div>
                      {isExpanded && (
                        <div className="detail">
                          {issue.reportSays && <KV k="REPORT" v={issue.reportSays} />}
                          {issue.actuallyFound && <KV k="ACTUAL" v={issue.actuallyFound} />}
                          {issue.conflict && <KV k="CONFLICT" v={issue.conflict} />}
                          {issue.narrativeText && <KV k="NARRATIVE" v={issue.narrativeText} />}
                          {issue.structuredData && <KV k="DATA" v={issue.structuredData} />}
                          <KV k="FIX" v={issue.fix} cls="fix" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Per-agent report panels — one per audit agent + developer.

function AgentReportPanel({
  agentKey,
  title,
  accent,
  tile,
  history,
  expanded,
  onToggleExpand,
  onToggleCheck,
}: {
  agentKey: AgentKey;
  title: string;
  accent: string;
  tile: AgentTile;
  history: HistoryItem[];
  expanded: Set<number>;
  onToggleExpand: (id: number) => void;
  onToggleCheck: (id: number) => void;
}) {
  const active = history.filter((i) => i.status !== 'fixed');
  const fixed = history.filter((i) => i.status === 'fixed');
  const phaseLabel =
    tile.phase === 'running' ? 'AUDITING…' :
    tile.phase === 'done'    ? `GRADE ${tile.grade ?? '?'}` :
    tile.phase === 'error'   ? 'ERROR' : 'IDLE';
  const phaseClass = `phase-${tile.phase}`;
  return (
    <div className={`agent-report ${phaseClass}`} style={{ '--agent-accent': accent } as React.CSSProperties}>
      <div className="ar-head">
        <span className="ar-title">{title}</span>
        <span className={`ar-phase ${phaseClass}`}>{phaseLabel}</span>
        <span className="ar-count">{active.length}</span>
      </div>
      <div className="ar-body">
        {tile.error && (
          <div className="ar-err">{truncateStr(tile.error, 140)}</div>
        )}
        {history.length === 0 && !tile.error && (
          <div className="ar-empty">
            {tile.phase === 'running' ? '*typing…*' : 'no issues yet'}
          </div>
        )}
        {history.length > 0 && (
          <div className="ar-list">
            {[...active, ...fixed].map((issue) => {
              const isExpanded = expanded.has(issue.id);
              const isFixed = issue.status === 'fixed';
              return (
                <div
                  key={issue.id}
                  className={`ar-issue status-${issue.status}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand(issue.id);
                  }}
                >
                  <span
                    className="ar-check"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isFixed) onToggleCheck(issue.id);
                    }}
                  >
                    {isFixed ? '[✓]' : issue.checked ? '[x]' : '[ ]'}
                  </span>
                  <span className={`sev-dot ${issue.severity}`} />
                  <span className="ar-title-text">{issue.title}</span>
                  <StatusBadge status={issue.status} firstSeen={issue.firstSeenRun} />
                  {isExpanded && (
                    <div className="ar-detail">
                      {issue.reportSays && <KV k="REPORT" v={issue.reportSays} />}
                      {issue.actuallyFound && <KV k="ACTUAL" v={issue.actuallyFound} />}
                      {issue.conflict && <KV k="CONFLICT" v={issue.conflict} />}
                      {issue.narrativeText && <KV k="NARRATIVE" v={issue.narrativeText} />}
                      {issue.structuredData && <KV k="DATA" v={issue.structuredData} />}
                      <KV k="FIX" v={issue.fix} cls="fix" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function DeveloperPanel({
  tileA,
  tileB,
  runs,
}: {
  tileA: AgentTile;
  tileB: AgentTile;
  runs: Array<{ number: number; devResult?: import('../shared/types').DeveloperResult }>;
}) {
  const history = runs.filter((r) => r.devResult).reverse();
  // Combined phase: running if either is running; error if both errored; done if both done; else idle.
  const combinedPhase: AgentPhase =
    tileA.phase === 'running' || tileB.phase === 'running' ? 'running' :
    tileA.phase === 'error'   && tileB.phase === 'error'   ? 'error'   :
    tileA.phase === 'done'    || tileB.phase === 'done'    ? 'done'    : 'idle';
  const label =
    combinedPhase === 'running' ? 'PATCHING…' :
    combinedPhase === 'done'    ? 'DONE'       :
    combinedPhase === 'error'   ? 'ERROR'      : 'IDLE';

  return (
    <div className={`agent-report developer phase-${combinedPhase}`} style={{ '--agent-accent': 'var(--purple, #d2a6ff)' } as React.CSSProperties}>
      <div className="ar-head">
        <span className="ar-title">DEVS · ANDY + KEVIN</span>
        <span className={`ar-phase phase-${combinedPhase}`}>{label}</span>
      </div>
      <div className="ar-body">
        {/* two-column live tiles — one per dev */}
        <div className="dev-live-grid">
          <DevLiveColumn name="ANDY" subtitle="data / calc / api" tile={tileA} />
          <DevLiveColumn name="KEVIN" subtitle="narrative / templates" tile={tileB} />
        </div>

        {history.length === 0 && combinedPhase !== 'running' && !tileA.error && !tileB.error && (
          <div className="ar-empty">awaiting your "fix checked issues"</div>
        )}

        {history.map((r) => {
          const d = r.devResult!;
          return (
            <div key={r.number} className="dev-run">
              <div className="dev-run-head">
                RUN {r.number} → fixed {d.fixesApplied.length} · skipped {d.skipped.length}
                {d.testsRun != null && ` · tests ${d.testsPassed}/${d.testsRun}`}
                {d.conflicts && d.conflicts.length > 0 && (
                  <span className="dev-conflict"> · CONFLICTS: {d.conflicts.join(', ')}</span>
                )}
              </div>
              {d.resolvedValues && Object.keys(d.resolvedValues).length > 0 && (
                <div className="dev-block">
                  <div className="dev-block-head">RESOLVED VALUES</div>
                  <div className="dev-resolved">
                    {Object.entries(d.resolvedValues).map(([k, v]) => (
                      <span key={k} className="dev-kv"><span className="k">{k}</span>: <span className="v">{String(v)}</span></span>
                    ))}
                  </div>
                </div>
              )}
              {d.fixesApplied.length > 0 && (
                <div className="dev-block">
                  <div className="dev-block-head">APPLIED</div>
                  {d.fixesApplied.map((f, i) => (
                    <div key={i} className="dev-line">
                      <span className={`dev-dot ok`} />
                      <span className={`dev-by by-${f.fixedBy ?? ''}`}>{f.fixedBy ?? '—'}</span>
                      <strong>{f.bug}</strong>
                      {f.file && <span className="dev-file"> — {f.file}</span>}
                      {f.change && <div className="dev-change">{f.change}</div>}
                    </div>
                  ))}
                </div>
              )}
              {d.skipped.length > 0 && (
                <div className="dev-block">
                  <div className="dev-block-head">SKIPPED</div>
                  {d.skipped.map((s, i) => (
                    <div key={i} className="dev-line">
                      <span className="dev-dot warn" />
                      <span className={`dev-by by-${s.skippedBy ?? ''}`}>{s.skippedBy ?? '—'}</span>
                      <strong>{s.bug}</strong>
                      <div className="dev-change">{s.reason}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TestWriterPanel({
  tile,
  runs,
}: {
  tile: AgentTile;
  runs: Array<{ number: number; devResult?: import('../shared/types').DeveloperResult }>;
}) {
  const history = runs.filter((r) => r.devResult?.testWriter).reverse();
  const label =
    tile.phase === 'running' ? 'WRITING TESTS…' :
    tile.phase === 'done'    ? 'DONE'           :
    tile.phase === 'error'   ? 'ERROR'          : 'IDLE';
  const tail = tile.transcript ? tile.transcript.slice(-600) : '';
  return (
    <div className={`agent-report phase-${tile.phase}`} style={{ '--agent-accent': '#7fd962' } as React.CSSProperties}>
      <div className="ar-head">
        <span className="ar-title">TESTS · OSCAR</span>
        <span className={`ar-phase phase-${tile.phase}`}>{label}</span>
      </div>
      <div className="ar-body">
        {tile.error && <div className="ar-err">{truncateStr(tile.error, 140)}</div>}
        {tile.phase === 'running' && tail && <pre className="dev-live">{tail}</pre>}
        {history.length === 0 && tile.phase !== 'running' && !tile.error && (
          <div className="ar-empty">no regression tests written yet</div>
        )}
        {history.map((r) => {
          const tw = r.devResult!.testWriter!;
          return (
            <div key={r.number} className="dev-run">
              <div className="dev-run-head">
                RUN {r.number} → wrote {tw.testsWritten.length} · skipped {tw.skipped.length}
              </div>
              {tw.testsWritten.map((t, i) => (
                <div key={i} className="dev-line">
                  <span className="dev-dot ok" /> <strong>{t.bug}</strong>
                  <span className="dev-file"> — {t.testFile}</span>
                  {t.description && <div className="dev-change">{t.description}</div>}
                </div>
              ))}
              {tw.skipped.map((s, i) => (
                <div key={i} className="dev-line">
                  <span className="dev-dot warn" /> <strong>{s.bug}</strong>
                  <div className="dev-change">{s.reason}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReviewerPanel({
  tile,
  runs,
}: {
  tile: AgentTile;
  runs: Array<{ number: number; devResult?: import('../shared/types').DeveloperResult }>;
}) {
  const history = runs.filter((r) => r.devResult?.reviewer).reverse();
  const label =
    tile.phase === 'running' ? 'REVIEWING DIFF…' :
    tile.phase === 'done'    ? 'DONE'             :
    tile.phase === 'error'   ? 'ERROR'            : 'IDLE';
  const tail = tile.transcript ? tile.transcript.slice(-600) : '';
  return (
    <div className={`agent-report phase-${tile.phase}`} style={{ '--agent-accent': '#8b8b8b' } as React.CSSProperties}>
      <div className="ar-head">
        <span className="ar-title">REVIEW · TOBY</span>
        <span className={`ar-phase phase-${tile.phase}`}>{label}</span>
      </div>
      <div className="ar-body">
        {tile.error && <div className="ar-err">{truncateStr(tile.error, 140)}</div>}
        {tile.phase === 'running' && tail && <pre className="dev-live">{tail}</pre>}
        {history.length === 0 && tile.phase !== 'running' && !tile.error && (
          <div className="ar-empty">awaiting developer diff</div>
        )}
        {history.map((r) => {
          const rv = r.devResult!.reviewer!;
          const verdictColor = rv.verdict === 'block' ? 'var(--crit)' : rv.verdict === 'warn' ? 'var(--high)' : 'var(--ok)';
          return (
            <div key={r.number} className="dev-run">
              <div className="dev-run-head" style={{ color: verdictColor }}>
                RUN {r.number} → {rv.verdict.toUpperCase()} · {rv.concerns.length} concern{rv.concerns.length === 1 ? '' : 's'}
              </div>
              {rv.summary && <div className="dev-change" style={{ marginBottom: 4 }}>{rv.summary}</div>}
              {rv.concerns.map((c, i) => (
                <div key={i} className="dev-line">
                  <span className={`sev-dot ${c.severity}`} /> <strong>{c.title}</strong>
                  {c.file && <span className="dev-file"> — {c.file}{c.line ? `:${c.line}` : ''}</span>}
                  {c.detail && <div className="dev-change">{c.detail}</div>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DevLiveColumn({ name, subtitle, tile }: { name: string; subtitle: string; tile: AgentTile }) {
  const tail = tile.transcript ? tile.transcript.slice(-300) : '';
  return (
    <div className={`dev-live-col phase-${tile.phase}`}>
      <div className="dev-live-head">
        <strong>{name}</strong> <span className="dev-live-sub">{subtitle}</span>
        <span className="dev-live-phase">{tile.phase.toUpperCase()}</span>
      </div>
      {tile.error && <div className="dev-live-err">{truncateStr(tile.error, 120)}</div>}
      {tile.phase === 'running' && tail && <pre className="dev-live-tail">{tail}</pre>}
      {tile.phase === 'done' && !tile.error && (
        <div className="dev-live-ok">✓ {tile.message ?? 'done'}</div>
      )}
    </div>
  );
}

function truncateStr(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function StatusBadge({ status, firstSeen }: { status: IssueStatus; firstSeen: number }) {
  if (status === 'new') return <span className="status-badge new">NEW</span>;
  if (status === 'recurring') return <span className="status-badge recurring" title={`first seen run ${firstSeen}`}>RECURRING · r{firstSeen}+</span>;
  return <span className="status-badge fixed" title={`introduced run ${firstSeen}, not in latest`}>FIXED · r{firstSeen}</span>;
}

function KV({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <div className={`kv ${cls ?? ''}`}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function PdfPanel({ active, onClick, url }: { active: boolean; onClick: () => void; url: string | null }) {
  return (
    <div className={`panel ${active ? 'active' : ''}`} onClick={onClick}>
      <div className="panel-title">
        <span>◢ PDF PREVIEW</span>
      </div>
      <div className="panel-body" style={{ padding: 0, display: 'flex' }}>
        {url ? (
          <div className="pdf-pane">
            <iframe src={url} title="report pdf" />
          </div>
        ) : (
          <div className="pdf-empty">
            <pre className="ascii">{`
  ██████  ██████   ███████
  ██   ██ ██   ██  ██
  ██████  ██   ██  █████
  ██      ██   ██  ██
  ██      ██████   ██`}</pre>
            <div>no report captured yet</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Keybar({
  canFix,
  canAccept,
  canExport,
  statusMsg,
}: {
  canFix: boolean;
  canAccept: boolean;
  canExport: boolean;
  statusMsg: string;
}) {
  const items: Array<{ k: string; label: string; enabled: boolean }> = [
    { k: '/', label: 'address', enabled: true },
    { k: 'j/k', label: 'nav', enabled: true },
    { k: 'space', label: 'toggle', enabled: true },
    { k: 'enter', label: 'expand', enabled: true },
    { k: 'A/D', label: 'select all/none', enabled: true },
    { k: 'tab', label: 'pane', enabled: true },
    { k: 'f', label: 'fix checked', enabled: canFix },
    { k: 'a', label: 'accept', enabled: canAccept },
    { k: 'e', label: 'export', enabled: canExport },
  ];
  return (
    <div className="keybar">
      {items.map((it, i) => (
        <React.Fragment key={it.k}>
          {i > 0 && <div className="sep" />}
          <span className={`kb ${it.enabled ? 'enabled' : 'disabled'}`}>
            <span className="key">{it.k}</span>
            <span>{it.label}</span>
          </span>
        </React.Fragment>
      ))}
      <div className="spacer" />
      <span className="msg" title={statusMsg}>{statusMsg}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// (legacy) AgentStrip — replaced by AgentRoom. Left for reference.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function AgentStrip({
  agents,
  onOpen,
}: {
  agents: Record<AgentKey, AgentTile>;
  onOpen: (k: AgentKey) => void;
}) {
  return (
    <div className="agent-strip">
      {AGENT_ORDER.map((k) => {
        const t = agents[k];
        const meta = AGENT_META[k];
        return (
          <button
            key={k}
            className={`agent-tile ${t.phase}`}
            onClick={() => onOpen(k)}
            title={meta.kind}
          >
            <div className="at-header">
              <span className="at-glyph">{meta.glyph}</span>
              <span className="at-label">{meta.label}</span>
              <span className={`at-phase ${t.phase}`}>
                {t.phase === 'running' && <span className="dots">live</span>}
                {t.phase === 'done' && (t.grade ? `done · ${t.grade}` : 'done')}
                {t.phase === 'error' && 'error'}
                {t.phase === 'idle' && 'idle'}
              </span>
            </div>
            <div className="at-body">
              {t.error ? (
                <span className="at-err">{truncate(t.error, 80)}</span>
              ) : t.message ? (
                <span className="at-msg">{truncate(t.message, 80)}</span>
              ) : t.transcript ? (
                <span className="at-tail">› {truncate(tailLine(t.transcript), 80)}</span>
              ) : (
                <span className="at-msg">{meta.kind}</span>
              )}
              {t.issueCount != null && t.phase === 'done' && (
                <span className="at-count">
                  {t.issueCount} issue{t.issueCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function AgentDrawer({
  which,
  tile,
  onClose,
}: {
  which: AgentKey;
  tile: AgentTile;
  onClose: () => void;
}) {
  const meta = AGENT_META[which];
  const bodyRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [tile.transcript]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <span className="at-glyph">{meta.glyph}</span>
          <span>{meta.label} AGENT</span>
          <span className="drawer-sub">{meta.kind}</span>
          <span className={`at-phase ${tile.phase}`}>{tile.phase.toUpperCase()}</span>
          <div style={{ flex: 1 }} />
          <span style={{ color: 'var(--dim)', fontSize: 10 }}>esc to close</span>
        </div>
        {tile.error && (
          <div className="drawer-err">
            <div style={{ color: 'var(--crit)', textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: 10 }}>error</div>
            <div>{tile.error}</div>
          </div>
        )}
        <pre className="drawer-body" ref={bodyRef}>
          {tile.transcript || (tile.phase === 'idle' ? '// waiting to start…' : '// no output yet')}
        </pre>
      </div>
    </div>
  );
}

function tailLine(s: string): string {
  const lines = s.trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim()) return lines[i].trim();
  }
  return '';
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function phaseLabel(phase: LoopState['status']): string {
  switch (phase) {
    case 'idle': return 'idle';
    case 'capturing': return 'generating pdf';
    case 'auditing': return 'agents auditing';
    case 'awaiting_review': return 'ready for review';
    case 'fixing': return 'developer fixing';
    case 'done': return 'accepted';
  }
}
