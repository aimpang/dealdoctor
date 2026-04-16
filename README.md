# DealDoctor

DealDoctor is a trust-first real estate underwriting app built for investors who want a fast first-pass answer on whether to run away, think harder, or lean in.

## North Star

DealDoctor's north star is:

> Provide as close to 100% accurate underwritings and information that someone will pay $24.99 for before they invest on a property.

That principle drives the current launch posture:

- accuracy over coverage
- fewer reports over shaky reports
- no silent substitution of weak data as if it were verified
- the first page of the PDF must be the safest, clearest investor decision surface

## Product Summary

User enters a US property address and DealDoctor:

1. creates a free preview
2. resolves or blocks on critical listing-price issues
3. offers paid unlock through LemonSqueezy
4. generates a full underwriting report
5. exports to PDF / Excel
6. supports restore via cookie, magic link, or recovery code

The main decision surface is page one of the full report. It is intentionally trust-aware and can suppress headline deal metrics when core inputs are weak.

## Current Launch Philosophy

DealDoctor is no longer trying to underwrite every address equally.

Current launch posture is:

- trusted inputs can drive a normal page-one decision
- caution inputs can still render a report, but with downgraded trust and suppressed headline metrics when needed
- unsupported inputs should not be allowed to masquerade as clean investor-grade numbers

The system especially protects:

- listing price
- property facts and classification
- rent signal quality
- HOA and tax reliability
- first-page score / recommendation confidence

The explicit launch contract is documented in:

- `docs/launch-trust-contract.md`
- `docs/launch-gold-set.md`

## User Flow

### 1. Landing

- User lands on `/`
- Enters a US address
- Client submits to `POST /api/preview`

### 2. Preview

Preview is generated from:

- property record search
- rent estimate
- rate snapshot
- lightweight heuristics and quality checks

Preview can end in one of four states:

1. clean listing price
   - preview succeeds immediately
2. missing listing price
   - user must confirm the current ask before continuing
3. conflicted listing price
   - user sees both source prices and must confirm the live ask
4. unsupported address
   - preview can stop before checkout if critical inputs are too weak

### 3. Checkout

- `POST /api/checkout`
- LemonSqueezy checkout session is created
- checkout is blocked if listing price is unresolved
- checkout is also blocked if a manual listing-price confirmation is stale

### 4. Payment + Entitlement

- LemonSqueezy webhook hits `POST /api/webhook`
- report is marked paid
- entitlement is credited to the customer
- full report generation starts

Supported pricing tiers:

- `single`
- `5pack`
- `unlimited`

### 5. Full Report

Full report is loaded at `/report/[uuid]`

It includes:

- first-page investor verdict
- breakeven and offer framing
- LTR metrics
- financing alternatives
- sensitivity analysis
- wealth projection
- value triangulation
- rent comps and sale comps
- climate / insurance
- market and quality audits
- AI narrative

### 6. Export + Recovery

- Excel export: `GET /api/report/[uuid]/export`
- PDF export: browser print / save flow from the report page
- restore flow: `/retrieve`
- magic link claim: `/api/auth/claim`
- recovery code restore: `/api/auth/recover`

## Technical Flow

### High-Level Request Path

1. `app/page.tsx` + `components/AddressInput.tsx`
2. `app/api/preview/route.ts`
3. `lib/propertyApi.ts`
4. `lib/listing-price-resolution.ts`
5. `lib/reportGenerator.ts`
6. `app/api/checkout/route.ts`
7. `app/api/webhook/route.ts`
8. `app/api/report/[uuid]/route.ts`
9. `components/FullReport.tsx`

### Preview Flow

`POST /api/preview`

- property search resolves the subject
- listing price is resolved through primary / fallback / user-confirmed flow
- teaser row is created in Prisma
- if entitlement is already active, preview may auto-unlock
- otherwise user stays in teaser/paywall flow

### Listing Price Resolution Flow

Implemented as trust-first infrastructure.

Source of truth:

- `lib/listing-price-resolution.ts`

Rules:

- if primary source has a sane listing price, use it
- if primary is missing, try fallback
- if both exist and materially conflict, do not average them
- require manual confirmation for conflict
- do not allow checkout on unresolved ask
- do not allow checkout on stale manual confirmation

Persisted fields:

- `listingPrice`
- `listingPriceSource`
- `listingPriceStatus`
- `listingPriceCheckedAt`
- `listingPriceUserSupplied`
- `primaryListingPrice`
- `fallbackListingPrice`

### Full Report Composition

Source of truth:

- `lib/reportGenerator.ts`

Responsibilities:

- hydrate property + market inputs
- resolve taxes, HOA, insurance, rent, comps, and financing assumptions
- generate structured report payload
- run quality audit
- run AI review / rewrite pass
- emit `firstPageTrust`

### First-Page Trust Layer

Source of truth:

- `lib/first-page-trust.ts`

This is the critical launch-safety layer for the PDF.

It evaluates field-level trust for:

- listing price
- property facts
- rent
- HOA
- property tax
- insurance
- value

It outputs:

- `status`: `trusted | caution | unsupported`
- `investorSignal`: `invest | think | run`
- `adjustedScore`
- `suppressBreakevenSignal`
- `suppressForwardProjection`
- field-level explanations

Important current behavior:

- manually confirmed / conflict-resolved listing prices no longer get `trusted`
- stale manual listing prices are treated as weak and blocked at checkout
- page one can hide breakeven and 5-year projection when core inputs are weak

### Insurance Modeling

Sources:

- `lib/climateRisk.ts`
- `lib/property-insurance.ts`

Current behavior:

- base estimate comes from state/climate model
- condos and townhouses with HOA now receive HOA-aware insurance adjustments
- first page still treats insurance as modeled, not quoted

This was added because raw homeowners modeling was overstating condo carry on page one.

### Access / Entitlements

Main files:

- `lib/entitlements.ts`
- `lib/report-access.ts`
- `app/api/auth/*`
- `app/api/webhook/route.ts`

Notes:

- no full account system is required for launch
- `Customer.accessToken` backs the owner cookie
- recovery works through magic link or recovery code
- refunded access is revoked through shared access logic

## Data Model

Prisma schema lives in `prisma/schema.prisma`.

Primary models:

- `Customer`
  - email-keyed buyer record
  - access token, recovery code, entitlement state
- `Report`
  - teaser data, user inputs, full report payload, payment state
- `WebhookEvent`
  - webhook dedupe
- `ReportFeedback`
  - post-report user quality feedback
- `BacktestRun`
  - periodic accuracy backtests
- `RateLimitBucket`
  - durable server-side rate limiting

## Core App Surface

### Public Pages

- `/`
- `/pricing`
- `/methodology`
- `/privacy`
- `/terms`
- `/retrieve`
- `/portfolio`

### API Routes

- `/api/preview`
- `/api/refine`
- `/api/checkout`
- `/api/webhook`
- `/api/report/[uuid]`
- `/api/report/[uuid]/export`
- `/api/report/[uuid]/feedback`
- `/api/report/[uuid]/retry-ai`
- `/api/photos/analyze`
- `/api/share-token`
- `/api/auth/claim`
- `/api/auth/recover`
- `/api/auth/send-magic-link`
- `/api/stats`
- `/api/admin/backtest`

## Key Libraries by Responsibility

### Underwriting / Math

- `lib/calculations.ts`
- `lib/rates.ts`
- `lib/dealDoctor.ts`
- `lib/reportGenerator.ts`

### Property / Market Data

- `lib/propertyApi.ts`
- `lib/property-value-signals.ts`
- `lib/buildingHoa.ts`
- `lib/studentHousing.ts`
- `lib/locationSignals.ts`
- `lib/climateRisk.ts`
- `lib/property-insurance.ts`

### Trust / Accuracy Infrastructure

- `lib/listing-price-resolution.ts`
- `lib/first-page-trust.ts`
- `lib/qualityAudit.ts`
- `lib/invariantCheck.ts`
- `lib/reviewReport.ts`

### Access / Payments / Sharing

- `lib/entitlements.ts`
- `lib/report-access.ts`
- `lib/shareToken.ts`
- `lib/claim-token.ts`
- `lib/email-service.ts`

## Recent Hardening Work

This repo now includes the recent launch-hardening changes below.

### 1. Trust-First Listing Price Resolution

- listing price separated from estimated value
- fallback price support added
- manual confirmation required on conflict
- unresolved or stale manual ask blocks checkout

Main files:

- `lib/listing-price-resolution.ts`
- `app/api/preview/route.ts`
- `app/api/checkout/route.ts`
- `lib/reportGenerator.ts`

### 2. First-Page Trust Framework

- page-one verdict is no longer raw math only
- weak inputs can suppress breakeven and forward projection
- first-page trust is explicit in report payload

Main files:

- `lib/first-page-trust.ts`
- `components/FullReport.tsx`
- `lib/reportGenerator.ts`

### 3. HOA-Aware Condo / Townhouse Insurance

- condo insurance is no longer treated like a detached-home policy by default
- townhouse insurance is softened when HOA likely carries shared-structure coverage

Main files:

- `lib/property-insurance.ts`
- `lib/reportGenerator.ts`

### 4. SEO / Crawlability Pass

Recent SEO improvements include:

- canonical `.us` domain cleanup
- robots and sitemap routes
- route-level noindex rules for non-indexable surfaces

Main files:

- `lib/seo.ts`
- `app/layout.tsx`
- `app/robots.ts`
- `app/sitemap.ts`
- `next.config.mjs`

## Testing and Validation

### Main Commands

Scripts from `package.json`:

- `build`
- `start`
- `lint`
- `test`
- `check`
- `pressure:accuracy`
- `pressure:e2e`
- `pressure:load`

### Pressure Suite

Pressure tests live in `tests/pressure`.

They exist to catch:

- orchestration regressions
- schema drift
- scenario-specific accuracy failures
- fuzz-level math invariant failures

Read `tests/pressure/README.md` before expanding the scenario set.

### Important Regression Files

- `lib/first-page-trust.test.ts`
- `lib/launch-trust-contract.test.ts`
- `lib/launch-gold-set.test.ts`
- `lib/listing-price-resolution.test.ts`
- `lib/property-insurance.test.ts`
- `tests/listing-price-route-flow.test.ts`
- `lib/reportGenerator.test.ts`

## Real-Address Validation Notes

Recent manual validation focused on whether the first page of the PDF is safe enough to inform an investor decision.

Addresses recently spot-checked:

- `8837 W Virginia Ave, Phoenix, AZ 85037`
- `3000 Oasis Grand Blvd Apt 2502, Fort Myers, FL 33916`
- `216 W Escalones, San Clemente, CA 92672`
- `9812 S 11th Pl, Phoenix, AZ 85042`
- `13801 N 36th Dr, Phoenix, AZ 85053`

Current pattern:

- the first page is materially safer than before
- `trusted` is now stricter for manual/conflicted listing prices
- condo insurance is closer to public-market expectations
- AI narrative still needs continued scrutiny for hallucinated specifics

## Known Gaps / Follow-Up Work

These are the main areas still worth attention:

- AI narrative can still hallucinate specific supporting facts even when the structured math is sound
- rate limiting still deserves continued hardening review
- privacy / legal copy should stay aligned with real processor stack and data sharing
- support/domain consistency should remain unified to `.us`
- more real-address validation is still useful before broadening coverage

## Launch Blockers vs Roadmap

### Before broad launch

- keep the page-one trust contract aligned with real product behavior
- keep the gold set green
- tighten rent / HOA / tax / insurance trust before widening coverage
- keep customer-facing trust copy narrower than the actual system behavior

### After launch

- broaden coverage beyond the launch trust subset
- add user-confirmable overrides for more expense anchors
- add deeper condo diligence workflows
- keep improving the narrative layer without letting it weaken structured trust rules

## Review Guide for the Next Model

If you are onboarding a new model into this repo, start here:

1. `lib/listing-price-resolution.ts`
2. `lib/first-page-trust.ts`
3. `lib/property-insurance.ts`
4. `lib/reportGenerator.ts`
5. `components/FullReport.tsx`
6. `app/api/preview/route.ts`
7. `app/api/checkout/route.ts`
8. `tests/pressure/README.md`
9. `lib/reportGenerator.test.ts`
10. `tests/listing-price-route-flow.test.ts`

That path will show:

- how the current trust-first report pipeline works
- where pricing / preview / checkout gating lives
- how page-one suppression works
- what has already been tested

## Local Development

### Run Locally

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm start
```

For development:

```bash
corepack pnpm dev
```

### Environment

At minimum, local and production setups commonly rely on:

- `DATABASE_URL`
- `PROPERTY_API_KEY`
- `LEMONSQUEEZY_*`
- `NEXT_PUBLIC_BASE_URL`
- `NEXT_PUBLIC_MAPBOX_TOKEN`
- AI provider keys

Check `.env.example` and the route/lib call sites before adding or changing providers.

## Deployment Notes

- app is built on Next.js App Router
- Prisma uses PostgreSQL
- `build` runs `prisma generate && next build`
- production site is `https://dealdoctor.us`

Before launch or after major underwriting changes:

1. run `build`
2. run focused regressions
3. run `pressure:accuracy`
4. run real-address PDF checks on representative property types

## Bottom Line

DealDoctor should not optimize for "report count."

It should optimize for:

- trustworthy first-page investor signals
- explicit handling of uncertainty
- clean paid outputs on addresses it chooses to support

That is the current direction of the codebase and the standard future changes should preserve.
