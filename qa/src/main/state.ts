import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import type { LoopState } from '../shared/types';

function stateDir(): string {
  const dir = path.join(app.getPath('userData'), 'qa-sessions');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sessionFile(address: string): string {
  const slug = address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return path.join(stateDir(), `${slug || 'session'}.json`);
}

export function loadState(address: string): LoopState | null {
  const f = sessionFile(address);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8')) as LoopState;
  } catch {
    return null;
  }
}

export function saveState(state: LoopState): void {
  const f = sessionFile(state.address);
  fs.writeFileSync(f, JSON.stringify(state, null, 2), 'utf8');
}

export function listSessions(): Array<{ address: string; updatedAt: string; runs: number }> {
  const dir = stateDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as LoopState;
        return { address: s.address, updatedAt: s.startedAt, runs: s.runs.length };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<{ address: string; updatedAt: string; runs: number }>;
}

export function pdfDir(): string {
  const dir = path.join(app.getPath('userData'), 'qa-pdfs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function exportsDir(): string {
  const dir = path.join(app.getPath('userData'), 'qa-exports');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
