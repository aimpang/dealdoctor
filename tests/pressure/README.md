# DealDoctor Pressure Tests

Pressure tests that catch the classes of accuracy bugs that unit tests miss —
the integration-layer, orchestration, and data-quality issues surfaced by
repeated Grok audits. Every test here corresponds to a specific prior
production bug or a plausible neighbor of one.

## What's in here

```
tests/pressure/
├── fixtures/              # Recorded real-API responses (JSON)
│   ├── fort-myers-oasis.json
│   ├── bradley-dr.json
│   ├── escalones.json
│   ├── austin-baseline.json
│   └── record.ts          # Recorder script — regenerate fixtures
├── scenarios/             # Fixture-replay tests (accuracy regression)
│   ├── invariants.ts      # Shared assertions + stub-AI wiring + replay helper
│   ├── stub-ai.ts         # Deterministic AI stub (shared with E2E)
│   ├── fort-myers-oasis.test.ts
│   ├── bradley-dr.test.ts
│   ├── escalones.test.ts
│   └── austin-baseline.test.ts
├── fuzz/                  # Property-based invariants (fast-check)
│   ├── math-invariants.test.ts
│   ├── heuristic-invariants.test.ts
│   └── schema-snapshot.test.ts
├── e2e/                   # Playwright golden-path (opt-in, not pre-push)
│   ├── golden-path.spec.ts
│   ├── fetch-stubs.ts     # Route interceptors for /api/preview + /api/report
│   ├── build-stub-payload.ts  # Rebuild stub-payload.json from austin fixture
│   └── stub-payload.json
└── load/                  # Autocannon load burst (manual, pre-prod)
    └── preview.ts
```

## Running

```bash
# Run the full pressure suite (scenarios + fuzz + schema)
npm run pressure:accuracy

# Runs automatically on every push via the husky pre-push hook.
# `npm run check` chains: lint → unit tests → pressure:accuracy.

# Re-record a fixture (hits real APIs — costs a bit of quota)
npm run pressure:record -- --slug fort-myers-oasis \
  --address "3000 Oasis Grand Blvd, Apt 2502" \
  --city "Fort Myers" --state FL --zip 33916 \
  --strategy LTR --offer 275000

# Browser golden-path (chromium, ~8s, opt-in only — not in pre-push)
npm run pressure:e2e

# Load burst against /api/preview (requires dev server running locally)
npm run dev        # in one shell
npm run pressure:load
```

## What each scenario protects

| Scenario | Prior bug(s) caught |
|---|---|
| **fort-myers-oasis** | Sale comps median $21.5k (parking deed leak) · IRR "1000.0%" clamp ceiling · "Very Car-Dependent" on sparse Mapbox POI data |
| **bradley-dr** | Per-bedroom rent AVM used as whole-property rent (student-housing heuristic fires) |
| **escalones** | Student-housing heuristic false-positiving on luxury coastal SFR (tripled a legit $7k rent to $21k); wide AVM spread read as "high confidence" |
| **austin-baseline** | Regression canary — if anything breaks the normal happy-path flow, this test fails first |

## What the fuzz suite catches

| File | Focus |
|---|---|
| **math-invariants** | `findIRR` never returns Infinity or the clamp ceiling · `calculateMortgage` sanity · `calculateDealMetrics` produces finite monetary fields under random-but-bounded inputs |
| **heuristic-invariants** | Student-housing heuristic never fires on luxury properties (value ≥ $1M, no subdivision match) · always fires on known student-complex subdivisions with ≥3 BR · multiplication math self-consistent |
| **schema-snapshot** | Top-level `fullReportData` key set is stable — catches silent key removal that would produce blank UI sections |

## Always-on invariants

Every fixture scenario runs the full shared invariant set from
`scenarios/invariants.ts`:

1. Top-level `fullReportData` keys match the snapshot
2. No NaN numbers or "undefined"/"NaN" strings anywhere (except whitelisted IRR paths)
3. All monetary fields are finite and non-negative
4. IRR is finite or NaN (never the old "1000%" clamp value); if finite, in `(-1, 5)`
5. Comp median (with ≥3 comps) is in `[0.5×, 2×]` of subject AVM — catches parking-deed leaks
6. Insurance is `(0, 2%]` of annual value when climate is present
7. Walkability "Very Car-Dependent" not possible with ≥15 POIs at high confidence
8. `dealDoctor` null ⟺ `dealDoctorError` non-null
9. `rentAdjustment` shape is internally consistent when multiplied
10. Value triangulation has signals and a valid confidence label
11. Breakeven delta math: `delta === price − yourOffer`

## Fixture refresh cadence

**Quarterly** — first week of Apr / Jul / Oct / Jan. Rentcast and Mapbox
response shapes drift over time; fixtures lie silently within ~2 months.

```bash
for slug in fort-myers-oasis bradley-dr escalones austin-baseline; do
  case "$slug" in
    fort-myers-oasis) ARGS='--address "3000 Oasis Grand Blvd, Apt 2502" --city "Fort Myers" --state FL --zip 33916 --offer 275000' ;;
    bradley-dr)        ARGS='--address "1324 Bradley Dr" --city Harrisonburg --state VA --zip 22801' ;;
    escalones)         ARGS='--address "216 W Escalones, San Clemente, CA 92672" --city "San Clemente" --state CA --zip 92672' ;;
    austin-baseline)   ARGS='--address "1500 W Anderson Ln" --city Austin --state TX --zip 78757' ;;
  esac
  eval "npm run pressure:record -- --slug $slug --strategy LTR $ARGS"
done

# Review the JSON diffs — verify changes are intentional before committing.
git diff tests/pressure/fixtures/
```

## Pre-push budget

Target: `pressure:accuracy` runs in ≤10 seconds. Total pre-push (lint + unit +
pressure) ≤30 seconds. If this ever creeps, diagnose and restore — developers
will start `--no-verify` and the suite becomes worthless.

Current baseline: **~0.5s** for the full pressure suite (32 tests across
scenarios + fuzz + schema).

## Adding new scenarios

1. Pick an address that reveals a new class of bug (e.g., commercial,
   coastal, rural, multi-unit).
2. `npm run pressure:record -- --slug my-slug --address "..." --city "..." --state XX --zip ...`
3. Add `tests/pressure/scenarios/my-slug.test.ts` modeled on the existing
   files. Use `replayFixture('my-slug')` + `assertAlwaysOnInvariants(data)`.
4. Add scenario-specific bounds as needed (e.g., `assertRentYield`).
5. Update `fuzz/schema-snapshot.test.ts` `slugs` array to include the new
   fixture.

## Architectural limitation

Fixture-replay tests exercise **compose-layer** logic (the math, triangulation,
warnings, assembly) but **not service-layer filters** (e.g., the sale-comps
`>$30k` floor, the walkability `dataConfidence` bucketing). Those run at
fetch time in `lib/propertyApi.ts` and `lib/locationSignals.ts`, so by the
time the response lands in a fixture, the filter has already applied.

That means a regression in a service filter won't fail a scenario replay —
the fixture would silently encode the broken output. Mitigation: service
filter logic needs **unit tests on the service module directly** (see
`lib/studentHousing.test.ts` as the existing pattern).

The pressure suite catches: math bugs, orchestration bugs, schema drift,
compose-layer invariant violations, heuristic edge cases.
The pressure suite does NOT catch: service-layer filter regressions that
produce a technically-valid-but-wrong response.

## E2E browser flow (phase 2)

`npm run pressure:e2e` walks a headless Chromium through:
1. Landing renders, address submit produces an inline teaser (no URL nav)
2. Direct `/report/{uuid}?debug=1` → core FullReport sections render
3. Nonexistent report UUID degrades gracefully (no crash)

All three network paths (`/api/preview`, `/api/report/[uuid]`, `/api/stats`)
are stubbed from `e2e/stub-payload.json`, which is pre-composed via
`npx tsx tests/pressure/e2e/build-stub-payload.ts` off the austin-baseline
fixture. Console + pageerror hooks assert zero unexpected errors.

Not on the pre-push path — Chromium download is ~300MB. Opt-in only.

## Load burst (phase 3)

`npm run pressure:load` fires `autocannon` at `POST /api/preview` for 10s
(override with `--duration`, `--connections`, `--address`, `--url`). Each
connection spoofs a distinct `x-forwarded-for` to bypass the per-IP rate
limit on localhost. Reports req/s, p50/p95/p99 latency, non-2xx count.
Fails the run if >10% of requests returned non-2xx or zero connected.

Manual, pre-deploy only. Requires the dev server running in another shell.

## Not covered (intentionally)

- **AI prose assertions.** The AI's output is non-deterministic; we assert
  structure (sections present, no empty strings) via a deterministic stub
  (`STUB_DEAL_DOCTOR` in `scenarios/stub-ai.ts`) rather than calling the
  real model.
