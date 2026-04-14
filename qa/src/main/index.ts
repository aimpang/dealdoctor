import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { captureReport, closeBrowser, scrapeFactSheet } from './capture';
import { runConsistencyAgent } from './agents/consistency';
import { runMarketAgent } from './agents/market';
import { runNarrativeAgent } from './agents/narrative';
import { runTwoDeveloperAgents, extractResolvedValues } from './agents/developer';
import { consolidateReports, countBySeverity } from './consolidate';
import { loadState, saveState, listSessions, pdfDir } from './state';
import { exportMarkdown } from './export';
import type { AgentEvent, AgentKey, AgentReport, ConsolidatedIssue, LoopState, StatusEvent } from '../shared/types';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
const sessions = new Map<string, LoopState>();

function emit(event: StatusEvent) {
  mainWindow?.webContents.send('status', event);
}
function emitAgent(event: AgentEvent) {
  mainWindow?.webContents.send('agent', event);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b0e14',
    title: 'DealDoctor · QA Loop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' ? MAIN_WINDOW_VITE_DEV_SERVER_URL : undefined;
  console.log('[qa] dev url:', devUrl, 'packaged:', app.isPackaged);

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[qa] did-fail-load', code, desc, url);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[qa] render-process-gone', details);
  });
  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    console.log(`[renderer:${level}]`, message, `(${source}:${line})`);
  });

  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const rendererName = typeof MAIN_WINDOW_VITE_NAME !== 'undefined' ? MAIN_WINDOW_VITE_NAME : 'main_window';
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', rendererName, 'index.html'));
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  await closeBrowser();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ───────────────────────── IPC ─────────────────────────

// Match prior attempts to current issues by CATEGORY first, falling back to
// title. Categories are canonical (enum), so recurrence tracking survives
// minor wording drift across audit runs.
function attachPriorAttempts(
  issues: ConsolidatedIssue[],
  state: LoopState
): ConsolidatedIssue[] {
  if (state.runs.length === 0) return issues;
  // Build two indexes: by category and by title (lowercase).
  const byCategory = new Map<string, import('../shared/types').PriorAttempt[]>();
  const byTitle = new Map<string, import('../shared/types').PriorAttempt[]>();
  for (const run of state.runs) {
    const d = run.devResult;
    if (!d) continue;
    // Reconstruct category -> title mapping for this run from the run's
    // consolidated list, so we can index dev results that were keyed by title.
    const titleToCat = new Map<string, string>();
    for (const ci of run.consolidated) {
      if (ci.category) titleToCat.set(ci.title.toLowerCase(), ci.category);
    }
    const pushAttempt = (
      bug: string,
      entry: import('../shared/types').PriorAttempt
    ) => {
      const tkey = bug.toLowerCase();
      const cat = titleToCat.get(tkey);
      const byT = byTitle.get(tkey) ?? [];
      byT.push(entry);
      byTitle.set(tkey, byT);
      if (cat) {
        const byC = byCategory.get(cat) ?? [];
        byC.push(entry);
        byCategory.set(cat, byC);
      }
    };
    for (const f of d.fixesApplied) {
      pushAttempt(f.bug, {
        runNumber: run.number,
        outcome: 'applied',
        fixedBy: f.fixedBy,
        file: f.file,
        change: f.change,
      });
    }
    for (const s of d.skipped) {
      pushAttempt(s.bug, {
        runNumber: run.number,
        outcome: 'skipped',
        fixedBy: s.skippedBy,
        reason: s.reason,
      });
    }
  }
  return issues.map((i) => {
    const fromCat = i.category ? byCategory.get(i.category) : undefined;
    const fromTitle = byTitle.get(i.title.toLowerCase());
    // Prefer category match when available, else title match.
    const attempts = fromCat && fromCat.length > 0 ? fromCat : fromTitle;
    return attempts && attempts.length > 0 ? { ...i, priorAttempts: attempts } : i;
  });
}

function getOrCreate(address: string): LoopState {
  if (sessions.has(address)) return sessions.get(address)!;
  const existing = loadState(address);
  const state: LoopState = existing ?? {
    address,
    startedAt: new Date().toISOString(),
    runs: [],
    status: 'idle',
    statusMessage: 'Ready',
  };
  sessions.set(address, state);
  return state;
}

async function runAudit(state: LoopState): Promise<void> {
  const runNumber = state.runs.length + 1;

  state.status = 'capturing';
  state.statusMessage = `Capturing PDF for run ${runNumber}…`;
  saveState(state);
  emit({ phase: 'capturing', message: state.statusMessage, runNumber });

  const captured = await captureReport(state.address, pdfDir(), runNumber);

  state.status = 'auditing';
  state.statusMessage = `Running 3 audit agents…`;
  saveState(state);
  emit({ phase: 'auditing', message: state.statusMessage, runNumber });

  // Agent 2 (pure code) runs synchronously — emit start/done around it.
  emitAgent({ agent: 'consistency', phase: 'running', message: 'checking invariants…' });
  const consistency = runConsistencyAgent(captured.data);
  emitAgent({
    agent: 'consistency',
    phase: consistency.error ? 'error' : 'done',
    grade: consistency.grade,
    issueCount: consistency.issues.length,
    error: consistency.error,
  });

  emitAgent({ agent: 'market', phase: 'running', message: 'scraping fact sheet + web-searching comps…' });
  emitAgent({ agent: 'narrative', phase: 'running', message: 'fact-checking AI prose against the fact sheet…' });

  // Kick off (or reuse) a pre-scraped public fact sheet for the market agent.
  const factSheet = await scrapeFactSheet(state.address).catch(() => undefined);

  const [market, narrative] = await Promise.all([
    runMarketAgent(captured.data, (c) => emitAgent({ agent: 'market', phase: 'running', chunk: c }), factSheet).catch((e) => ({
      agent: 'market_accuracy' as const,
      grade: 'F' as const,
      issues: [],
      error: (e as Error).message,
    })),
    runNarrativeAgent(captured.data, (c) => emitAgent({ agent: 'narrative', phase: 'running', chunk: c })).catch((e) => ({
      agent: 'narrative_accuracy' as const,
      grade: 'F' as const,
      issues: [],
      error: (e as Error).message,
    })),
  ]);

  emitAgent({
    agent: 'market',
    phase: market.error ? 'error' : 'done',
    grade: market.grade,
    issueCount: market.issues.length,
    error: market.error,
  });
  emitAgent({
    agent: 'narrative',
    phase: narrative.error ? 'error' : 'done',
    grade: narrative.grade,
    issueCount: narrative.issues.length,
    error: narrative.error,
  });

  const reports: AgentReport[] = [market, consistency, narrative];
  const consolidated = consolidateReports(reports);
  const totals = countBySeverity(consolidated);

  state.runs.push({
    number: runNumber,
    timestamp: new Date().toISOString(),
    pdfPath: captured.pdfPath,
    reports,
    consolidated,
    totals,
  });
  state.status = 'awaiting_review';
  state.statusMessage = `Ready for review — ${consolidated.length} issue(s)`;
  saveState(state);
  emit({ phase: 'awaiting_review', message: state.statusMessage, runNumber });
}

ipcMain.handle('qa:start', async (_e, address: string) => {
  const state = getOrCreate(address);
  try {
    await runAudit(state);
  } catch (err) {
    state.status = 'idle';
    state.statusMessage = `Error: ${(err as Error).message}`;
    saveState(state);
    emit({ phase: 'idle', message: state.statusMessage });
  }
  return state;
});

ipcMain.handle(
  'qa:fix',
  async (_e, payload: { address: string; issues: ConsolidatedIssue[]; notes?: string }) => {
    const state = getOrCreate(payload.address);
    state.status = 'fixing';
    state.statusMessage = 'Developer agent applying fixes…';
    saveState(state);
    emit({ phase: 'fixing', message: state.statusMessage });

    // Attach prior-attempt history to each recurring issue so the dev agents
    // know the bug survived N previous fix passes and don't just repeat the
    // same surface-level patch.
    const enrichedIssues = attachPriorAttempts(payload.issues, state);

    // Update the current run's consolidated (record what user approved)
    if (state.runs.length > 0) {
      state.runs[state.runs.length - 1].consolidated = enrichedIssues;
      saveState(state);
    }

    try {
      const resolvedValues = extractResolvedValues(enrichedIssues);
      const devResult = await runTwoDeveloperAgents({
        address: payload.address,
        issues: enrichedIssues,
        resolvedValues,
        userNotes: payload.notes,
        repoRoot: REPO_ROOT,
        onTestWriterStart: () => {
          emitAgent({ agent: 'testwriter', phase: 'running', message: 'oscar: writing failing tests…' });
        },
        onTestWriterChunk: (chunk) => {
          emitAgent({ agent: 'testwriter', phase: 'running', chunk });
        },
        onTestWriterDone: (tw) => {
          emitAgent({
            agent: 'testwriter',
            phase: tw.error ? 'error' : 'done',
            message: `wrote ${tw.testsWritten.length}, skipped ${tw.skipped.length}`,
            error: tw.error,
          });
          // Now kick off the dev agents visually.
          emitAgent({ agent: 'developerA', phase: 'running', message: 'andy: making tests pass (data/calc)…' });
          emitAgent({ agent: 'developerB', phase: 'running', message: 'kevin: making tests pass (narrative)…' });
        },
        onChunkByAgent: (label, chunk) => {
          const key = label === 'ANDY' ? 'developerA' : 'developerB';
          emitAgent({ agent: key, phase: 'running', chunk });
          emit({ phase: 'fixing', message: `${label}: ${chunk.slice(-80)}` });
        },
        onReviewerStart: () => {
          emitAgent({ agent: 'reviewer', phase: 'running', message: 'toby: reviewing diff…' });
          emit({ phase: 'fixing', message: 'Toby reviewing the diff before tests run…' });
        },
        onReviewerChunk: (chunk) => {
          emitAgent({ agent: 'reviewer', phase: 'running', chunk });
        },
        onReviewerDone: (r) => {
          emitAgent({
            agent: 'reviewer',
            phase: r.error ? 'error' : 'done',
            message: `verdict: ${r.verdict} · ${r.concerns.length} concern${r.concerns.length === 1 ? '' : 's'}`,
            error: r.error,
          });
          emit({
            phase: 'fixing',
            message: `Toby: ${r.verdict.toUpperCase()} · ${r.concerns.length} concern${r.concerns.length === 1 ? '' : 's'}${r.summary ? ` — ${r.summary}` : ''}`,
          });
        },
        onTestsStart: () => {
          emit({ phase: 'fixing', message: 'Running shared npm test…' });
        },
        onTestsDone: (t) => {
          if (t.testsRun != null) {
            emit({
              phase: 'fixing',
              message: `Shared tests: ${t.testsPassed}/${t.testsRun} passed${t.testsFailed ? `, ${t.testsFailed} failed` : ''}`,
            });
          }
        },
      });
      const andy = devResult.perAgent?.ANDY;
      const kevin = devResult.perAgent?.KEVIN;
      emitAgent({
        agent: 'developerA',
        phase: 'done',
        message: `fixed ${andy?.fixesApplied.length ?? 0}, skipped ${andy?.skipped.length ?? 0}`,
      });
      emitAgent({
        agent: 'developerB',
        phase: 'done',
        message: `fixed ${kevin?.fixesApplied.length ?? 0}, skipped ${kevin?.skipped.length ?? 0}`,
      });
      const conflictMsg = devResult.conflicts?.length
        ? ` · CONFLICTS: ${devResult.conflicts.join(', ')}`
        : '';
      emit({
        phase: 'fixing',
        message: `Applied: ${devResult.fixesApplied.length}, skipped: ${devResult.skipped.length}${conflictMsg}`,
      });

      // Attach dev result to the run whose issues it fixed.
      if (state.runs.length > 0) {
        state.runs[state.runs.length - 1].devResult = devResult;
        saveState(state);
      }

      await runAudit(state);
      return { state, devResult };
    } catch (err) {
      state.status = 'idle';
      state.statusMessage = `Fix error: ${(err as Error).message}`;
      saveState(state);
      emit({ phase: 'idle', message: state.statusMessage });
      emitAgent({ agent: 'developerA', phase: 'error', error: (err as Error).message });
      emitAgent({ agent: 'developerB', phase: 'error', error: (err as Error).message });
      emitAgent({ agent: 'testwriter', phase: 'error', error: (err as Error).message });
      emitAgent({ agent: 'reviewer', phase: 'error', error: (err as Error).message });
      throw err;
    }
  }
);

ipcMain.handle('qa:accept', async (_e, address: string) => {
  const state = getOrCreate(address);
  state.status = 'done';
  state.statusMessage = 'Accepted — loop closed';
  saveState(state);
  emit({ phase: 'done', message: state.statusMessage });
  return state;
});

ipcMain.handle('qa:export', async (_e, address: string) => {
  const state = getOrCreate(address);
  return exportMarkdown(state);
});

ipcMain.handle('qa:list-sessions', async () => listSessions());

ipcMain.handle('qa:load-session', async (_e, address: string) => {
  return loadState(address);
});

ipcMain.handle('qa:read-pdf', async (_e, pdfPath: string) => {
  if (!fs.existsSync(pdfPath)) return null;
  const buf = fs.readFileSync(pdfPath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});
