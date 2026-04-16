# Launch Trust Contract

DealDoctor's launch contract is narrow on purpose:

> A paid report is only allowed to look clean on page one when the inputs that drive the investor decision are trustworthy enough to defend.

This contract separates page-one inputs into three categories:

- exact facts
- modeled estimates
- diligence-only unknowns

## Page-One Field Contract

| Field | Launch role | Clean enough for `trusted` | Allowed caution states | Weak-state action |
| --- | --- | --- | --- | --- |
| Listing price | required underwriting anchor | primary listing price only | fallback source, manual confirmation | unresolved or stale ask makes page one `unsupported`; checkout blocks |
| Property facts | required underwriting anchor | direct record with no profile warnings | none | AVM-only / ambiguous facts make page one `unsupported` |
| Rent | required underwriting anchor | same-building or strong nearby comp support | thin but non-contradictory comp support | weak / contradictory rent makes page one `unsupported` |
| HOA | required expense anchor for condo / townhouse / co-op stock | listing-captured HOA only | building-average HOA | inferred or missing HOA on HOA-sensitive property makes page one `unsupported` |
| Property tax | required expense anchor | county record, local override | state-average estimate | owner-exemption suspicion forces caution and suppression as needed |
| Insurance | modeled expense | climate-model or HOA-adjusted estimate | fallback national estimate | flood / Florida condo fragility forces caution or contributes to `unsupported` |
| Value | supporting context only | high-confidence triangulation | medium-confidence triangulation | low-confidence valuation cannot drive a clean headline narrative |

## Trusted / Caution / Unsupported

### Trusted

Page one can be `trusted` only when:

- listing price is primary-source verified
- property facts are direct-record clean
- rent is at least supported by comps
- HOA and tax clear the trusted threshold for the property type
- no secondary field is weak

### Caution

Page one should be `caution` when:

- one or more key inputs are usable but not clean enough for `trusted`
- a fallback or user-confirmed listing price is carrying the ask
- rent, insurance, tax, HOA, or value rely on modeled or downgraded inputs

### Unsupported

Page one should be `unsupported` when:

- listing price is unresolved or stale
- property facts are AVM-only or classification-ambiguous
- rent is contradictory or too thin for the property type
- HOA is inferred or missing on HOA-sensitive stock

`Unsupported` does not mean the app knows nothing. It means page one cannot present a clean investor-grade decision without overclaiming certainty.

## Metric Suppression Rules

### Offer vs Breakeven

Suppress when weak inputs exist in:

- listing price
- property facts
- rent
- HOA
- property tax
- insurance

### 5-Year Projection

Suppress when weak inputs exist in:

- property facts
- rent
- HOA
- property tax

## Launch Scope

Before broadening coverage, DealDoctor is optimizing for:

- fewer clean reports
- explicit caution states
- unsupported page-one states when key anchors are weak

It is not optimizing for:

- maximum address coverage
- optimistic headline metrics on thin data
- silently filling unknowns with modeled defaults

## Roadmap After Launch

The next layers after this contract are:

- richer rent trust logic for more markets and property classes
- user-confirmable HOA / tax overrides
- condo diligence uploads and reserve-study workflows
- broader market-relative trust heuristics

