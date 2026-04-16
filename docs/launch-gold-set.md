# Launch Gold Set

This is the small validation set that should be checked before broad launch.

The goal is not coverage. The goal is to lock page-one behavior on representative property classes.

## Manual Validation Addresses

| Address | Class | Expected page-one state | Notes |
| --- | --- | --- | --- |
| 8837 W Virginia Ave, Phoenix, AZ 85037 | clean SFR | `trusted` | baseline clean single-family case |
| 3000 Oasis Grand Blvd Apt 2502, Fort Myers, FL 33916 | Florida condo | `unsupported` or `caution`, with suppressed metrics when rent / HOA are weak | tests condo diligence, HOA sensitivity, and insurance modeling |
| 216 W Escalones, San Clemente, CA 92672 | multifamily / unsupported | `unsupported` | page one must refuse to look clean |
| 9812 S 11th Pl, Phoenix, AZ 85042 | source-conflict listing price | `caution` | tests manual ask confirmation |
| 13801 N 36th Dr, Phoenix, AZ 85053 | stale or fallback-priced SFR | `caution` | tests price freshness and fallback ask behavior |

## Synthetic Gold Set

The automated launch set lives in:

- `lib/launch-gold-set.ts`
- `lib/launch-gold-set.test.ts`

Those scenarios lock:

- clean trusted SFR behavior
- fallback listing-price caution behavior
- manual conflict caution behavior
- stale manual ask blocking
- Florida condo unsupported behavior
- building-average HOA caution behavior
- AVM-only property-facts unsupported behavior
- state-average tax plus fallback-insurance caution behavior

## Pass Criteria

Before launch, the gold set should hold these invariants:

- no unresolved listing price can produce a clean page one
- no AVM-only property facts can produce a clean page one
- no weak condo rent / HOA case can produce a clean page one
- no fallback or manual ask can produce `trusted`
- clean SFR baseline still renders `trusted`

