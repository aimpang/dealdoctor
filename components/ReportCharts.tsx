'use client'

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  ReferenceLine,
} from 'recharts'

const fmtShort = (n: number): string => {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`
  return `${sign}$${Math.round(abs)}`
}
const fmtFull = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)

const COMPONENT_COLORS = {
  cashFlow: '#0ea5e9',     // sky (primary)
  paydown: '#10b981',      // emerald
  appreciation: '#8b5cf6', // violet
  taxShield: '#f59e0b',    // amber
}

/* ───── 5-Year Wealth Area Chart ───── */
export function WealthAreaChart({ years }: { years: any[] }) {
  const data = years.map((y) => ({
    year: `Y${y.year}`,
    'Cash flow': y.cumulativeCashFlow,
    'Principal paydown': y.equityFromPaydown,
    Appreciation: y.equityFromAppreciation,
    'Tax shield': y.cumulativeTaxShield,
  }))

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {(Object.keys(COMPONENT_COLORS) as Array<keyof typeof COMPONENT_COLORS>).map((k) => (
            <linearGradient id={`grad-${k}`} key={k} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COMPONENT_COLORS[k]} stopOpacity={0.4} />
              <stop offset="100%" stopColor={COMPONENT_COLORS[k]} stopOpacity={0.05} />
            </linearGradient>
          ))}
        </defs>
        <XAxis
          dataKey="year"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          width={56}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          tickFormatter={fmtShort}
        />
        <Tooltip
          contentStyle={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(value, name) => [fmtFull(Number(value) || 0), String(name)]}
        />
        <Area
          type="monotone"
          dataKey="Cash flow"
          stackId="1"
          stroke={COMPONENT_COLORS.cashFlow}
          fill="url(#grad-cashFlow)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="Principal paydown"
          stackId="1"
          stroke={COMPONENT_COLORS.paydown}
          fill="url(#grad-paydown)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="Appreciation"
          stackId="1"
          stroke={COMPONENT_COLORS.appreciation}
          fill="url(#grad-appreciation)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="Tax shield"
          stackId="1"
          stroke={COMPONENT_COLORS.taxShield}
          fill="url(#grad-taxShield)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/* ───── Wealth Composition Pie Chart ───── */
export function WealthCompositionPie({
  hero,
}: {
  hero: {
    cumulativeCashFlow5yr: number
    equityFromPaydown5yr: number
    equityFromAppreciation5yr: number
    cumulativeTaxShield5yr: number
  }
}) {
  // A pie chart cannot faithfully represent negative contributions — using
  // Math.abs() makes a -$110k appreciation drag look like a +12% wealth
  // component, which is actively misleading. Split the components into
  // positive drivers (rendered as pie slices, proportional to positive total)
  // and negative drags (rendered below in a separate list so the signed
  // magnitude is unambiguous).
  const components = [
    { name: 'Cash flow', value: hero.cumulativeCashFlow5yr, color: COMPONENT_COLORS.cashFlow },
    { name: 'Principal paydown', value: hero.equityFromPaydown5yr, color: COMPONENT_COLORS.paydown },
    { name: 'Appreciation', value: hero.equityFromAppreciation5yr, color: COMPONENT_COLORS.appreciation },
    { name: 'Tax shield', value: hero.cumulativeTaxShield5yr, color: COMPONENT_COLORS.taxShield },
  ]
  const positives = components.filter((c) => c.value > 0)
  const negatives = components.filter((c) => c.value < 0)
  const positiveTotal = positives.reduce((s, c) => s + c.value, 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {positives.length > 0 ? (
          <ResponsiveContainer width={180} height={180}>
            <PieChart>
              <Pie
                data={positives}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                strokeWidth={0}
              >
                {positives.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(_value, _name, entry: any) =>
                  fmtFull(Number(entry?.payload?.value) || 0)
                }
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[180px] w-[180px] items-center justify-center rounded-full border border-dashed border-border text-xs text-muted-foreground">
            No positive wealth drivers
          </div>
        )}
        <div className="flex flex-1 flex-col gap-2 text-sm">
          {positives.map((d) => {
            const pct = positiveTotal > 0 ? (d.value / positiveTotal) * 100 : 0
            return (
              <div key={d.name} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: d.color }} />
                  <span className="text-muted-foreground">{d.name}</span>
                </div>
                <div className="tabular-nums">
                  <span className="font-semibold text-foreground">{pct.toFixed(0)}%</span>
                  <span className="ml-2 text-muted-foreground">{fmtShort(d.value)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Wealth drags — components with negative 5yr contribution.
          Rendered separately so they don't distort the percentage math on
          the pie chart above. */}
      {negatives.length > 0 && (
        <div className="rounded-md border border-red-500/25 bg-red-500/5 px-4 py-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
            Wealth drags
          </div>
          <div className="flex flex-col gap-1 text-sm">
            {negatives.map((d) => (
              <div key={d.name} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-sm"
                    style={{ backgroundColor: d.color, opacity: 0.5 }}
                  />
                  <span className="text-muted-foreground">{d.name}</span>
                </div>
                <span className="tabular-nums font-semibold text-red-700 dark:text-red-400">
                  {fmtShort(d.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ───── Sensitivity Tornado Chart ───── */
// Shows how 5-year wealth moves under each scenario relative to base case.
// Horizontal bars make it easy to spot which variable carries the most risk.
export function SensitivityTornado({
  rows,
}: {
  rows: Array<{ scenario: string; wealthDelta: number; fiveYrWealth: number }>
}) {
  // Sort non-base rows by absolute delta, keep base first if present
  const baseRow = rows.find((r) => r.scenario.toLowerCase().includes('base'))
  const others = rows
    .filter((r) => r !== baseRow)
    .sort((a, b) => Math.abs(b.wealthDelta) - Math.abs(a.wealthDelta))

  const data = others.map((r) => ({
    scenario: r.scenario,
    delta: r.wealthDelta,
  }))

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 32)}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
        <XAxis
          type="number"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          tickFormatter={fmtShort}
        />
        <YAxis
          type="category"
          dataKey="scenario"
          width={110}
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }}
        />
        <ReferenceLine x={0} stroke="hsl(var(--border))" />
        <Tooltip
          contentStyle={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(value) => [fmtFull(Number(value) || 0), 'Δ 5yr wealth vs base']}
        />
        <Bar dataKey="delta" radius={[2, 2, 2, 2]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.delta >= 0 ? '#10b981' : '#ef4444'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
