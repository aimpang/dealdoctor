#!/usr/bin/env tsx
/**
 * Load test for POST /api/preview.
 *
 * Drives a brief autocannon burst against a locally running dev server
 * (http://localhost:3000) and reports request-rate + latency percentiles.
 * Each request spoofs a unique x-forwarded-for so the per-IP rate limit
 * (3/day in lib/rateLimit.ts) doesn't clip the burst prematurely —
 * acceptable because this only targets localhost.
 *
 * Usage:
 *   # Start dev server first
 *   npm run dev
 *   # In another shell:
 *   npm run pressure:load
 *
 * Flags (optional):
 *   --url <url>         Override target (default: http://localhost:3000/api/preview)
 *   --duration <sec>    Run length in seconds (default: 10)
 *   --connections <n>   Concurrent connections (default: 5)
 *   --address <string>  Address payload (default: 1500 W Anderson Ln, Austin, TX 78757)
 *
 * Caveats:
 *   - Rentcast is cached 24h per address, so only the first request of the
 *     chosen address hits the real API. Results reflect cached-hit latency.
 *     For cold-path timing, vary --address between runs.
 *   - Not for CI — use before prod deploys when validating a perf-sensitive
 *     change (rate model, composition pipeline, DB queries).
 */

import autocannon from 'autocannon'

interface Args {
  url: string
  duration: number
  connections: number
  address: string
}

function parseArgs(): Args {
  const a = process.argv.slice(2)
  const pick = (flag: string) => {
    const i = a.indexOf(flag)
    return i >= 0 ? a[i + 1] : undefined
  }
  return {
    url: pick('--url') ?? 'http://localhost:3000/api/preview',
    duration: pick('--duration') ? Number(pick('--duration')) : 10,
    connections: pick('--connections') ? Number(pick('--connections')) : 5,
    address: pick('--address') ?? '1500 W Anderson Ln, Austin, TX 78757',
  }
}

function formatMs(n: number | undefined): string {
  return n == null || !Number.isFinite(n) ? 'n/a' : `${n.toFixed(1)}ms`
}

async function main() {
  const args = parseArgs()
  console.log(`→ ${args.url}  (${args.duration}s, ${args.connections} connections)`)
  console.log(`  address: ${args.address}\n`)

  const body = JSON.stringify({ address: args.address })

  // Callback form returns an Instance (EventEmitter) that can be passed to
  // autocannon.track. The no-callback form returns Promise<Result> which
  // doesn't expose the EventEmitter surface.
  const result = await new Promise<autocannon.Result>((resolve, reject) => {
    const instance = autocannon(
      {
        url: args.url,
        method: 'POST',
        duration: args.duration,
        connections: args.connections,
        headers: {
          'Content-Type': 'application/json',
        },
        body,
        // Rotate x-forwarded-for so the per-IP rate limit can't kill the burst.
        // Each connection spoofs a deterministic fake IP; the rate limiter
        // treats them as distinct callers.
        setupClient(client) {
          const id = Math.floor(Math.random() * 1_000_000)
          client.setHeaders({
            'Content-Type': 'application/json',
            'x-forwarded-for': `10.${(id >> 16) & 0xff}.${(id >> 8) & 0xff}.${id & 0xff}`,
          })
        },
      },
      (err, r) => (err ? reject(err) : resolve(r))
    )
    autocannon.track(instance, { renderProgressBar: true, renderResultsTable: false })
  })
  const non2xx = result.non2xx
  const total = result.requests.total

  console.log('\n=== Results ===')
  console.log(`Requests total:   ${total}`)
  console.log(`Req/s (mean):     ${result.requests.mean.toFixed(1)}`)
  console.log(`Latency p50:      ${formatMs(result.latency.p50)}`)
  console.log(`Latency p95:      ${formatMs(result.latency.p97_5)}`)
  console.log(`Latency p99:      ${formatMs(result.latency.p99)}`)
  console.log(`Latency max:      ${formatMs(result.latency.max)}`)
  console.log(`Throughput:       ${(result.throughput.mean / 1024).toFixed(1)} KB/s`)
  console.log(`Errors:           ${result.errors}`)
  console.log(`Timeouts:         ${result.timeouts}`)
  console.log(`Non-2xx:          ${non2xx}${non2xx ? '  ← investigate' : ''}`)

  if (total === 0) {
    console.error('\n✗ Zero successful connections — is the server running at that URL?')
    process.exit(1)
  }
  // Fail the process if >10% of requests returned non-2xx — something
  // broke badly enough that the load number isn't meaningful.
  if (non2xx / total > 0.1) {
    console.error('\n✗ >10% non-2xx responses — load results not trustworthy')
    process.exit(1)
  }
  console.log('\n✓ Load run complete')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
