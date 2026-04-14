import { spawn, spawnSync } from 'node:child_process';
import * as os from 'node:os';
import * as fs from 'node:fs';

/**
 * Spawn the `claude` CLI (Claude Code) with a system prompt and a user input
 * payload, capture stdout until exit, and return the transcript.
 *
 * Uses `claude -p <prompt>` (print mode) for non-interactive execution. The
 * --append-system-prompt flag layers the agent's behavior on top of the
 * default Claude Code instructions. --permission-mode bypassPermissions lets
 * the dev agent touch files without prompting; for the read-only audit
 * agents we fall back to the default mode.
 *
 * On Windows the CLI is usually `claude.cmd`.
 */
export interface ClaudeSpawnOptions {
  systemPrompt: string;
  userPrompt: string;
  cwd?: string;
  allowWrite?: boolean;
  allowedTools?: string[];
  timeoutMs?: number;
  onChunk?: (chunk: string) => void;
}

// Resolve the Claude Code CLI once at module load. Windows installs can show
// up as claude.cmd, claude.exe, or claude.ps1 depending on the installer.
function resolveClaudeBin(): string {
  if (os.platform() !== 'win32') return 'claude';
  // Try PATH lookups via `where` first — respects whatever the user installed.
  try {
    const res = spawnSync('where', ['claude'], { encoding: 'utf8' });
    if (res.status === 0) {
      const first = res.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
      if (first && fs.existsSync(first)) return first;
    }
  } catch {
    /* ignore */
  }
  for (const name of ['claude.cmd', 'claude.exe', 'claude']) {
    const res = spawnSync('where', [name], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout.trim()) return name;
  }
  return 'claude'; // last resort
}

const CLAUDE_BIN = resolveClaudeBin();
console.log('[qa] claude bin resolved:', CLAUDE_BIN);

export async function runClaude(opts: ClaudeSpawnOptions): Promise<string> {
  // Pipe user prompt via stdin to avoid Windows cmd's 8191-char argv limit.
  const args: string[] = ['-p', '--append-system-prompt', opts.systemPrompt];
  if (opts.allowWrite) {
    args.push('--permission-mode', 'bypassPermissions');
  }
  if (opts.allowedTools && opts.allowedTools.length > 0) {
    args.push('--allowedTools', opts.allowedTools.join(','));
  }
  args.push('--output-format', 'text');

  return new Promise<string>((resolve, reject) => {
    // shell:true on Windows ONLY when the binary is a .cmd/.bat (those can't
    // spawn directly). For .exe we use shell:false so stdin piping is reliable.
    const needsShell = os.platform() === 'win32' && /\.(cmd|bat)$/i.test(CLAUDE_BIN);
    const proc = spawn(CLAUDE_BIN, args, {
      cwd: opts.cwd,
      env: process.env,
      shell: needsShell,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          proc.kill('SIGTERM');
          reject(new Error(`claude CLI timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;

    proc.stdout.on('data', (d: Buffer) => {
      const s = d.toString('utf8');
      stdout += s;
      opts.onChunk?.(s);
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    proc.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`Failed to spawn claude CLI (is it installed?): ${err.message}`));
    });
    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`claude CLI exited ${code}: ${(stderr || stdout).slice(-500)}`));
    });

    // Feed the prompt via stdin and close — safer than argv on Windows.
    proc.stdin.write(opts.userPrompt, 'utf8');
    proc.stdin.end();
  });
}

/**
 * Ask Claude to return a JSON object. Tolerates surrounding prose / markdown
 * fences — extracts the first `{…}` block and parses it.
 */
export async function runClaudeJson<T = unknown>(opts: ClaudeSpawnOptions): Promise<T> {
  let buffer = '';
  const out = await runClaude({
    ...opts,
    onChunk: (c) => {
      buffer += c;
      opts.onChunk?.(c);
    },
  });
  void buffer;
  const match = out.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`claude returned no JSON: ${out.slice(0, 500)}`);
  }
  try {
    return JSON.parse(match[0]) as T;
  } catch (err) {
    throw new Error(`claude returned invalid JSON: ${(err as Error).message}\nraw: ${match[0].slice(0, 500)}`);
  }
}
