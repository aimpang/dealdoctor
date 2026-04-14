// Structured JSON logger. Emits one line per event so Railway/Vercel log
// search can filter by `level`, `event`, and any attached context (route,
// uuid, error). No external dependencies — easy seam to swap in Sentry /
// Logtail / Datadog later by changing just this file.
//
// Usage:
//   logger.error('webhook.process_failed', { event: eventName, error: err })
//   logger.warn('rentcast.quota_hit', { address })
//   logger.info('report.generated', { uuid, ms: elapsed })

type Context = Record<string, unknown>

function normalizeError(err: unknown): Context {
  if (err instanceof Error) {
    return {
      errName: err.name,
      errMessage: err.message,
      // Stacks are noisy but useful for the first pass of debugging. Truncate
      // aggressively so a single error doesn't dominate the log stream.
      errStack: err.stack?.split('\n').slice(0, 8).join('\n'),
    }
  }
  if (err && typeof err === 'object') {
    const e = err as any
    return {
      errName: e?.constructor?.name,
      errMessage: e?.message,
      errStatus: e?.status ?? e?.response?.status,
    }
  }
  return { errMessage: String(err) }
}

function expandError(ctx: Context | undefined): Context {
  if (!ctx || !('error' in ctx)) return ctx ?? {}
  const { error, ...rest } = ctx
  return { ...rest, ...normalizeError(error) }
}

function emit(level: 'info' | 'warn' | 'error', event: string, ctx?: Context) {
  const line = JSON.stringify({
    level,
    event,
    ts: new Date().toISOString(),
    ...expandError(ctx),
  })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  info: (event: string, ctx?: Context) => emit('info', event, ctx),
  warn: (event: string, ctx?: Context) => emit('warn', event, ctx),
  error: (event: string, ctx?: Context) => emit('error', event, ctx),
}
