import Link from 'next/link'
import { ArrowLeftIcon } from 'lucide-react'
import { prisma } from '@/lib/db'

export const metadata = {
  title: 'Methodology — How DealDoctor runs the numbers',
  description:
    'Transparent breakdown of every calculation and data source used in a DealDoctor report.',
}

// Server component so we can hit Prisma directly for the latest backtest run
// without spinning up another route / client fetch.
async function getLatestBacktest() {
  try {
    return await prisma.backtestRun.findFirst({
      orderBy: { runAt: 'desc' },
    })
  } catch {
    return null
  }
}

export default async function MethodologyPage() {
  const backtest = await getLatestBacktest()

  return (
    <div className="mx-auto max-w-3xl px-5 py-14 sm:py-20">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-foreground/60 hover:text-foreground"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Back to DealDoctor
      </Link>

      <div className="mt-10 text-[10px] font-semibold uppercase tracking-[0.28em] text-[hsl(var(--primary))]">
        A Disclosure Circular
      </div>
      <h1 className="mt-4 font-[family-name:var(--font-fraunces)] text-[52px] font-medium leading-[0.98] tracking-tight text-foreground [font-variation-settings:'opsz'_144,'SOFT'_50] sm:text-[68px]">
        Methodology
      </h1>
      <p className="mt-6 max-w-2xl font-[family-name:var(--font-instrument)] text-[16px] leading-[1.6] text-foreground/70">
        Every number in your report is either a direct data-provider read, a
        deterministic computation we own, or a sanity-gated narrative. Here is
        the full breakdown — section by section.
      </p>

      <Section number="01" eyebrow="The flagship metric" title="Breakeven Offer Price">
        <p>
          We binary-search the purchase price at which monthly cash flow is
          approximately $0, given today&apos;s 30-year fixed rate and the
          property&apos;s estimated rent. It is the single number that answers
          the question most investor calculators sidestep: <em>at what price
          does this deal stop losing money?</em>
        </p>
        <p>
          Assumptions baked in: 20% down, 30-year amortization, 1.5% annual
          tax/insurance load on purchase price, $250/mo operating buffer, 5%
          vacancy. Jurisdiction-specific property tax overrides the flat load
          where we model it (see § 06).
        </p>
        <p className="text-[12px] text-foreground/50 font-mono">
          <code>lib/calculations.ts#calculateBreakEvenPrice</code>
        </p>
      </Section>

      <Section number="02" eyebrow="The mechanics" title="Mortgage & Cash Flow">
        <p>
          Standard US mortgage amortization, monthly compounding:{' '}
          <code>P × (r × (1+r)^n) / ((1+r)^n − 1)</code>. The same formula your
          bank uses — not an approximation.
        </p>
        <p>
          Monthly net cash flow = gross rent × (1 − vacancy) − mortgage payment
          − expenses. Cash-on-cash return = annual net cash flow ÷ (down
          payment + rehab budget). Five-year IRR solves the internal rate of
          return on cash contributed versus cash + equity at year five.
        </p>
      </Section>

      <Section number="03" eyebrow="Lender-grade sizing" title="DSCR (Debt Service Coverage Ratio)">
        <p>
          DSCR = annual NOI ÷ annual debt service. Most DSCR lenders require
          1.25× or higher; some will underwrite to 1.0× with pricing
          adjustments. Below 1.0× = negative-cashflow deal — the property
          cannot service its own debt.
        </p>
      </Section>

      <Section number="04" eyebrow="Triangulation" title="Value & Rent Cross-Checks">
        <p>
          A single AVM figure is the weakest link in any underwrite, so we
          triangulate. Value runs a cascade: Rentcast AVM → sale-comp median
          (same-bedroom, ~1 mile) → tax-assessment grown at jurisdictional
          rate → last sale price grown by market appreciation. When the spread
          between the highest and lowest estimate exceeds 50% of the subject
          price, we cap the verdict at <em>MARGINAL</em> — a confident-looking
          &quot;DEAL&quot; label on top of a wildly uncertain value is worse
          than the honest hedge.
        </p>
        <p>
          Rent gets the same treatment: the Rentcast rent AVM is compared
          against the median of live rent comps. Divergence of more than 25%
          attaches a visible warning so you can verify whole-unit rent with a
          local property manager before trusting the cash-flow math.
        </p>
      </Section>

      <Section number="05" eyebrow="State + city overlays" title="Jurisdictional Property Tax">
        <p>
          Flat &quot;1.2% of value&quot; tax math is the single biggest source
          of cash-flow error in generic calculators. We model state and city
          rules where they materially change the number: California Prop 13
          (tax basis resets at sale, then grows 2%/yr), Florida Save-Our-Homes
          (3% or CPI cap for homesteaded properties, reassessed at sale),
          Texas uncapped annual reassessment, Baltimore City composite rate,
          and NYC class-2 overlays for certain boroughs.
        </p>
        <p>
          States without a modeled rule fall back to the national average,
          and the report footer surfaces the caveat so you can verify against
          the county assessor.
        </p>
      </Section>

      <Section number="06" eyebrow="Condo normalization" title="HOA Building Averages">
        <p>
          Rentcast HOA captures are noisy at the unit level — one listing
          shows $400/mo, the unit next door shows $1,200, both in the same
          building. For known condominium buildings we maintain a small
          reference table of the building&apos;s observed monthly HOA range,
          and flag a listing HOA as an outlier when it reads more than 15%
          above the building average.
        </p>
        <p>
          When Rentcast returns an &quot;Apartment&quot; property type for a
          known condo building, we normalize it to &quot;Condo&quot; — you are
          buying a deeded unit, not a leasehold.
        </p>
      </Section>

      <Section number="07" eyebrow="Carrying costs" title="Insurance & Climate Risk">
        <p>
          Insurance estimate uses NAIC state-level homeowners premium
          averages, scaled linearly by dwelling value. A flood-zone add-on
          applies when the property sits in a FEMA Special Flood Hazard Area
          — queried live from the FEMA National Flood Hazard Layer REST API
          using the property&apos;s geocoded coordinates.
        </p>
        <p>
          Climate hazard scores (hurricane, wildfire, heat, drought, tornado)
          are state-level heuristics, not address-level. Use them as a
          starting point for insurance-shopping, not a final quote.
        </p>
      </Section>

      <Section number="08" eyebrow="Live feeds" title="Rates & Market Data">
        <p>
          30-year and 15-year fixed rates are pulled from the Freddie Mac
          Primary Mortgage Market Survey, refreshed weekly. Fed funds rate
          from the FRED API. An investor premium (typically +75 bps) is
          layered over the PMMS benchmark to reflect real DSCR-loan pricing,
          not owner-occupant pricing.
        </p>
        <p>
          Property details and rent estimates come from Rentcast. Sale
          comparables are filtered to same-bedroom-count properties within
          the same city, deduped by address key, and commercial-type records
          are excluded from the ARV pool.
        </p>
      </Section>

      <Section number="09" eyebrow="Post-math contradiction check" title="The Invariant Gate">
        <p>
          Before any AI touches the report, we run a pure-code gate over the
          structured output: does DSCR agree with the NOI and debt service we
          just computed? Does the breakeven delta equal{' '}
          <code>price − yourOffer</code>? Does deal score sit in [0, 100]? Is
          GRM in a plausible band?
        </p>
        <p>
          Contradictions at <em>FAIL</em> severity block report delivery — the
          API returns a 502 and the report is not shown. Suspicious-but-not-
          contradictory signals (<em>WARN</em>) are attached to the report as
          visible flags so you can see the model&apos;s own uncertainty.
          Zero API cost. Runs in under a millisecond.
        </p>
        <p className="text-[12px] text-foreground/50 font-mono">
          <code>lib/invariantCheck.ts#runInvariantCheck</code>
        </p>
      </Section>

      <Section number="10" eyebrow="Narrative layer" title="The Anthropic Layer">
        <p>
          The 3-fix diagnosis, negotiation scripts, and inspection red flags
          are written by Anthropic. The AI never calculates numbers — every
          financial value (breakeven price, STR revenue estimate, 70%-rule
          flip offer) is computed by our code and passed into the prompt as a
          fixed input. The model&apos;s job is narration and strategy
          ordering, not math.
        </p>
        <p>
          By the time Anthropic sees the data, it has already cleared the
          invariant gate (§ 09) and every value has been clamp-corrected
          against the triangulation cascade (§ 04). The narrator is
          effectively reviewing a pre-validated report before shaping it into
          prose — so a contradictory number can never reach the narrative,
          because it never reaches the narrator.
        </p>
        <p>
          Photo red-flag review uses the same Anthropic model with vision
          input. Findings are observational only — the model is instructed
          not to speculate about anything not directly visible in frame.
        </p>
        <p>
          Fix 1 = lowest-effort path. Fix 2 = value-add or structural change.
          Fix 3 = strategic pivot.
        </p>
      </Section>

      <Section number="11" eyebrow="Honesty" title="Accuracy — what we measure and publish">
        <p>
          We can&apos;t tell you any single report is correct — no AVM-based
          tool honestly can. What we can tell you:
        </p>
        <ol className="mt-2 space-y-2 border-l border-foreground/15 pl-5">
          <li>
            <span className="font-mono text-[11px] tabular-nums tracking-widest text-[hsl(var(--primary))]">01</span>
            {'  '}The math is exact and covered by the full test suite (currently 407 automated tests).
          </li>
          <li>
            <span className="font-mono text-[11px] tabular-nums tracking-widest text-[hsl(var(--primary))]">02</span>
            {'  '}Every input is sourced and dated in the report footer.
          </li>
          <li>
            <span className="font-mono text-[11px] tabular-nums tracking-widest text-[hsl(var(--primary))]">03</span>
            {'  '}When value estimates span more than 50% of the subject price, confidence is marked low and the verdict is capped at MARGINAL.
          </li>
          <li>
            <span className="font-mono text-[11px] tabular-nums tracking-widest text-[hsl(var(--primary))]">04</span>
            {'  '}Known-bad patterns (student rentals, multi-unit zoning, yield outliers, manufactured homes) are surfaced <em>before</em> the paywall, not after.
          </li>
          <li>
            <span className="font-mono text-[11px] tabular-nums tracking-widest text-[hsl(var(--primary))]">05</span>
            {'  '}Every paid report links to Zillow, Redfin, and Realtor for the same address so you can cross-check in one click.
          </li>
        </ol>

        {backtest ? (
          <div className="mt-6 border border-foreground/20 bg-[hsl(var(--card))]/60 backdrop-blur-sm p-5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-foreground/60">
              Latest Accuracy Backtest
            </p>
            <p className="mt-1.5 font-[family-name:var(--font-fraunces)] text-[18px] font-medium text-foreground [font-variation-settings:'opsz'_24,'SOFT'_30]">
              Run {new Date(backtest.runAt).toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric',
              })}{' '}· sample of {backtest.sampleSize} reports
            </p>
            {backtest.valueWithin10 != null && (
              <p className="mt-2 text-[14px] text-foreground/80">
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {(backtest.valueWithin10 * 100).toFixed(0)}%
                </span>{' '}
                of value predictions within 10% of the current market AVM.
              </p>
            )}
            {backtest.valueMedianErr != null && (
              <p className="mt-1 text-[13px] text-foreground/60">
                Median absolute value error:{' '}
                <span className="font-mono tabular-nums">{(backtest.valueMedianErr * 100).toFixed(1)}%</span>
              </p>
            )}
            {backtest.notes && (
              <p className="mt-3 text-[12px] text-foreground/55">{backtest.notes}</p>
            )}
          </div>
        ) : (
          <div className="mt-6 border border-dashed border-foreground/25 bg-[hsl(var(--card))]/30 p-5">
            <p className="text-[12px] text-foreground/60">
              Accuracy backtest results will publish here once we have enough
              historical reports to run a meaningful sample (target: quarterly
              after launch).
            </p>
          </div>
        )}
      </Section>

      <Section number="12" eyebrow="The plain truth" title="What DealDoctor is not">
        <p>
          Not financial advice. Not an appraisal. Not a substitute for a
          licensed inspection, a full underwriting review, or consultation
          with a qualified professional.
        </p>
        <p>
          Rent and value estimates have ranges of uncertainty inherent to any
          AVM. Before closing on a property, verify the numbers with a local
          agent, lender, or CPA.
        </p>
      </Section>

      {/* Footer CTA — editorial box with straight borders */}
      <div className="mt-16 border border-foreground/20 bg-[hsl(var(--card))]/60 backdrop-blur-sm p-8 text-center">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-[hsl(var(--primary))]">
          Colophon
        </div>
        <h3 className="mt-4 font-[family-name:var(--font-fraunces)] text-[26px] font-medium leading-tight text-foreground [font-variation-settings:'opsz'_48,'SOFT'_30]">
          Still have questions?
        </h3>
        <p className="mt-3 font-[family-name:var(--font-instrument)] text-[14px] leading-[1.6] text-foreground/70">
          The report is a starting point for diligence, not the end of it.
          If something looks off, email us — we&apos;ll walk through the
          numbers with you.
        </p>
      </div>
    </div>
  )
}

function Section({
  number,
  eyebrow,
  title,
  children,
}: {
  number: string
  eyebrow: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-12 border-t border-foreground/20 pt-8">
      <div className="flex items-baseline justify-between border-b border-foreground/15 pb-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-foreground/60">
          {eyebrow}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-foreground/40">
          § {number}
        </span>
      </div>
      <h2 className="mt-4 font-[family-name:var(--font-fraunces)] text-[28px] font-medium leading-tight tracking-tight text-foreground [font-variation-settings:'opsz'_48,'SOFT'_30] sm:text-[32px]">
        {title}
      </h2>
      <div className="mt-4 space-y-3 font-[family-name:var(--font-instrument)] text-[15px] leading-[1.65] text-foreground/75 [&_code]:rounded-sm [&_code]:bg-foreground/5 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-foreground [&_em]:not-italic [&_em]:font-semibold [&_em]:text-foreground">
        {children}
      </div>
    </section>
  )
}
