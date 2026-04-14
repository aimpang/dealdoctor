# DealDoctor QA Loop

Electron app that runs a continuous QA loop on DealDoctor reports.

```
address → DealDoctor PDF → 3 audit agents → review → dev agent fixes → re-audit
```

## Setup

```bash
cd qa
npm install       # also runs `playwright install chromium`
npm start         # launches Electron in dev mode with HMR
```

**Prerequisites:**

- **DealDoctor running locally** at `http://localhost:3000` (from repo root: `npm run dev`). Override with `DEALDOCTOR_URL=http://…`.
- **Claude Code CLI** on `PATH` — the three LLM agents + developer agent shell out to `claude`. Verify with `claude --version`. All agent work is billed against your Claude Max plan, not the Anthropic API.

## Controls

Everything is keyboard-first (lazygit vibes).

| key          | action                          |
| ------------ | ------------------------------- |
| `/`          | focus address input             |
| `j` / `k`    | navigate issues                 |
| `space`      | toggle issue checked            |
| `enter`      | expand issue detail             |
| `A` / `D`    | select all / deselect all       |
| `tab`        | switch active pane              |
| `f`          | fix checked issues              |
| `a`          | accept report (close loop)      |
| `e`          | export markdown audit trail     |

## Architecture

```
qa/
├── src/
│   ├── main/                    ← Electron main process (Node)
│   │   ├── index.ts             ← window + IPC handlers
│   │   ├── capture.ts           ← Playwright → PDF + data extraction
│   │   ├── claude.ts            ← spawn `claude` CLI
│   │   ├── agents/
│   │   │   ├── consistency.ts   ← Agent 2 (pure code, instant)
│   │   │   ├── market.ts        ← Agent 1 (Claude + web search)
│   │   │   ├── narrative.ts     ← Agent 3 (Claude, no tools)
│   │   │   └── developer.ts     ← developer (Claude + Read/Edit/Bash)
│   │   ├── consolidate.ts
│   │   ├── state.ts             ← persist per-address loop state
│   │   └── export.ts            ← markdown audit trail
│   ├── preload/index.ts         ← contextBridge IPC API
│   ├── renderer/                ← React UI (sandboxed)
│   │   ├── App.tsx
│   │   ├── styles.css           ← retro lazygit aesthetic
│   │   └── main.tsx
│   └── shared/types.ts
├── forge.config.ts
├── vite.main.config.ts
├── vite.preload.config.ts
└── vite.renderer.config.ts
```

Agents 1 + 3 + developer spawn `claude -p <prompt> --append-system-prompt <agent system>`. The developer agent gets `--permission-mode bypassPermissions` and runs with `cwd` set to the DealDoctor repo root so it can edit files directly. All audit agents run in parallel (`Promise.all`); Agent 2 (consistency) is pure code and returns instantly even if Claude is unreachable.

## Data extraction

`capture.ts` prefers a `window.__DD_REPORT__` global if DealDoctor exposes one. Otherwise falls back to DOM scraping from the rendered full-report page (`/report/<uuid>?debug=1`). To improve signal, add this in DealDoctor's full-report client component:

```ts
useEffect(() => {
  (window as any).__DD_REPORT__ = reportData;
}, [reportData]);
```

That gives Agent 2 the exact IRR/breakeven/wealth-table numbers it needs for its invariants.

## Session state

Each address gets its own JSON file under Electron's `userData` dir (`qa-sessions/<slug>.json`). PDFs live under `qa-pdfs/`. Exports land in `qa-exports/`.
