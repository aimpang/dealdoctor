export type AuditFindingSeverity = 'hard-fail' | 'warn' | 'info'

export interface AuditFinding {
  code: string
  severity: AuditFindingSeverity
  source: 'math' | 'authority' | 'market' | 'review'
  message: string
}

export interface AuthorityCitation {
  label: string
  url: string
}

export interface AuthorityAudit {
  status: 'passed' | 'blocked'
  checkedAt: string
  hardFailures: AuditFinding[]
  warnings: AuditFinding[]
  citations: AuthorityCitation[]
  summary: string
}

export interface MarketAudit {
  status: 'pending' | 'clean' | 'warning'
  checkedAt: string | null
  findings: AuditFinding[]
  summary: string
  crossCheckLinks: {
    zillow: string
    redfin: string
    realtor: string
  } | null
}

export interface QualityAuditStage {
  status: 'passed' | 'blocked'
  checkedAt: string
  hardFailures: AuditFinding[]
  warnings: AuditFinding[]
  summary: string
}

export interface QualityAudit {
  status: 'passed' | 'blocked'
  checkedAt: string
  hardFailures: AuditFinding[]
  warnings: AuditFinding[]
  stages: {
    propertyProfile: QualityAuditStage
    math: QualityAuditStage
    authority: AuthorityAudit
    review?: {
      status: 'passed' | 'blocked'
      checkedAt: string
      summary: string
      reviewerErrored: boolean
      failClosed: boolean
      verdict: 'clean' | 'rewrite' | 'block'
      confidence: number
      concernCount: number
    }
  }
  summary: string
}

export function isUnsupportedPropertyType(propertyType?: string | null): boolean {
  const normalized = (propertyType || '').trim().toLowerCase()
  if (!normalized) return false

  const supportedResidential = [
    'single family',
    'single-family',
    'townhouse',
    'condo',
    'apartment',
    'manufactured',
    'mobile home',
    'duplex',
    'triplex',
    'quadruplex',
    'multi-family',
    'multi family',
  ]
  if (supportedResidential.some((label) => normalized === label)) {
    return false
  }

  return [
    'land',
    'lot',
    'acreage',
    'farm',
    'ranch',
    'commercial',
    'industrial',
    'office',
    'retail',
    'warehouse',
    'mixed use',
    'mixed-use',
    'hospitality',
    'hotel',
    'self storage',
  ].some((label) => normalized.includes(label))
}

export function buildPropertyProfileAudit(input: {
  propertyType?: string | null
  estimatedValue?: number | null
  squareFeet?: number | null
  monthlyRent?: number | null
  valueSource?: string | null
  checkedAt?: string
}): QualityAuditStage {
  const checkedAt = input.checkedAt ?? new Date().toISOString()
  const hardFailures: AuditFinding[] = []
  if (isUnsupportedPropertyType(input.propertyType)) {
    hardFailures.push({
      code: 'unsupported-property-type',
      severity: 'hard-fail',
      source: 'authority',
      message: `Property type "${input.propertyType}" is outside DealDoctor's current residential underwriting model. Block the report instead of pretending the LTR/STR math is trustworthy on land or commercial parcels.`,
    })
  }

  const estimatedValue = input.estimatedValue ?? null
  const monthlyRent = input.monthlyRent ?? null
  const squareFeet = input.squareFeet ?? null
  const annualYield =
    estimatedValue && monthlyRent && estimatedValue > 0
      ? (monthlyRent * 12) / estimatedValue
      : null
  const valuePerSqft =
    estimatedValue && squareFeet && squareFeet > 0
      ? estimatedValue / squareFeet
      : null

  if (
    hardFailures.length === 0 &&
    input.valueSource === 'tax-assessment' &&
    annualYield != null &&
    annualYield < 0.01 &&
    valuePerSqft != null &&
    valuePerSqft > 5000
  ) {
    hardFailures.push({
      code: 'residential-profile-mismatch',
      severity: 'hard-fail',
      source: 'authority',
      message:
        `This looks like a provider-resolved mismatch, not a real residential rental profile: ` +
        `tax-assessment-derived value with <1% gross yield and >$5,000/sqft implied value. ` +
        `Block it instead of presenting fake precision.`,
    })
  }

  return {
    status: hardFailures.length > 0 ? 'blocked' : 'passed',
    checkedAt,
    hardFailures,
    warnings: [],
    summary:
      hardFailures.length > 0
        ? 'Property profile is unsupported for residential underwriting.'
        : 'Property profile is supported.',
  }
}

export class QualityAuditError extends Error {
  readonly audit: QualityAudit

  constructor(message: string, audit: QualityAudit) {
    super(message)
    this.name = 'QualityAuditError'
    this.audit = audit
  }
}

const STATE_AUTHORITY_URLS: Record<string, AuthorityCitation[]> = {
  AZ: [
    { label: 'Arizona Department of Revenue property tax overview', url: 'https://azdor.gov/business/property-tax' },
    { label: 'Arizona Department of Revenue TPT for lodging', url: 'https://azdor.gov/transaction-privilege-tax' },
  ],
  CA: [
    { label: 'California State Board of Equalization property taxes', url: 'https://www.boe.ca.gov/proptaxes/' },
    { label: 'California Department of Tax and Fee Administration', url: 'https://www.cdtfa.ca.gov/' },
  ],
  DC: [
    { label: 'DC Office of Tax and Revenue real property tax', url: 'https://otr.cfo.dc.gov/page/real-property-tax' },
    { label: 'DC short-term rental rules', url: 'https://dlcp.dc.gov/' },
  ],
  FL: [
    { label: 'Florida Department of Revenue property tax', url: 'https://floridarevenue.com/property' },
    { label: 'Florida Department of Revenue discretionary sales surtax', url: 'https://floridarevenue.com/taxes/taxesfees/Pages/discretionary.aspx' },
  ],
  IL: [
    { label: 'Illinois Department of Revenue property tax overview', url: 'https://tax.illinois.gov/localgovernments/propertytax.html' },
  ],
  IN: [
    { label: 'Indiana Department of Local Government Finance property tax', url: 'https://www.in.gov/dlgf/' },
    { label: 'Indiana Department of Revenue innkeeper tax', url: 'https://www.in.gov/dor/' },
  ],
  MD: [
    { label: 'Maryland Department of Assessments and Taxation', url: 'https://dat.maryland.gov/' },
    { label: 'Maryland tax and fee guidance', url: 'https://www.marylandtaxes.gov/' },
  ],
  NY: [
    { label: 'New York State property tax resources', url: 'https://www.tax.ny.gov/pit/property/' },
    { label: 'New York State short-term rental guidance', url: 'https://dos.ny.gov/' },
  ],
  TX: [
    { label: 'Texas Comptroller property tax assistance', url: 'https://comptroller.texas.gov/taxes/property-tax/' },
    { label: 'Texas hotel occupancy tax overview', url: 'https://comptroller.texas.gov/taxes/hotel/' },
  ],
  VA: [
    { label: 'Virginia Department of Taxation property tax overview', url: 'https://www.tax.virginia.gov/local-tax-rates' },
  ],
}

const CITY_AUTHORITY_URLS: Record<string, AuthorityCitation[]> = {
  'AUSTIN, TX': [
    { label: 'City of Austin short-term rentals', url: 'https://www.austintexas.gov/department/short-term-rentals' },
    { label: 'Travis Central Appraisal District', url: 'https://traviscad.org/' },
  ],
  'BALTIMORE, MD': [
    { label: 'Baltimore City short-term rental licensing', url: 'https://dhcd.baltimorecity.gov/' },
    { label: 'Baltimore City Department of Finance real property tax', url: 'https://finance.baltimorecity.gov/' },
  ],
  'PHOENIX, AZ': [
    { label: 'City of Phoenix transaction privilege tax', url: 'https://www.phoenix.gov/' },
    { label: 'Maricopa County Assessor', url: 'https://mcassessor.maricopa.gov/' },
  ],
}

export function buildAuthorityAudit(input: {
  state: string
  city?: string | null
  stateRulesMissing: boolean
  propertyTaxSource: 'county-record' | 'city-override' | 'state-average'
  checkedAt?: string
}): AuthorityAudit {
  const checkedAt = input.checkedAt ?? new Date().toISOString()
  const key =
    input.city && input.city.trim()
      ? `${input.city.trim().toUpperCase()}, ${input.state.trim().toUpperCase()}`
      : null
  const citations = [
    ...(key ? CITY_AUTHORITY_URLS[key] ?? [] : []),
    ...(STATE_AUTHORITY_URLS[input.state.trim().toUpperCase()] ?? []),
  ]
  const hardFailures: AuditFinding[] = []
  const warnings: AuditFinding[] = []

  if (input.stateRulesMissing) {
    hardFailures.push({
      code: 'state-rules-missing',
      severity: 'hard-fail',
      source: 'authority',
      message:
        `No jurisdiction rules are configured for ${input.state}. ` +
        `Blocking the report avoids silently falling back to TX defaults for taxes and landlord rules.`,
    })
  }

  if (input.propertyTaxSource !== 'county-record') {
    warnings.push({
      code: 'property-tax-fallback',
      severity: 'warn',
      source: 'authority',
      message:
        input.propertyTaxSource === 'city-override'
          ? 'Property tax is using a local jurisdiction override rather than a county record. Verify before relying on exact carrying costs.'
          : 'Property tax is using a state-average fallback estimate rather than a county record. Verify the local assessor before relying on exact carrying costs.',
    })
  }

  if (citations.length === 0) {
    warnings.push({
      code: 'authority-citations-missing',
      severity: 'warn',
      source: 'authority',
      message: `No official tax or STR citation is bundled yet for ${input.state}. Verify the local authority before relying on jurisdiction-specific rules.`,
    })
  }

  return {
    status: hardFailures.length > 0 ? 'blocked' : 'passed',
    checkedAt,
    hardFailures,
    warnings,
    citations,
    summary:
      hardFailures.length > 0
        ? 'Authority audit blocked the report.'
        : warnings.length > 0
        ? 'Authority audit passed with manual-verification warnings.'
        : 'Authority audit passed.',
  }
}

export function buildQualityAudit(input: {
  checkedAt?: string
  propertyProfileAudit?: QualityAuditStage
  mathWarnings?: Array<{ code: string; message: string }>
  authorityAudit: AuthorityAudit
}): QualityAudit {
  const checkedAt = input.checkedAt ?? new Date().toISOString()
  const propertyProfileAudit =
    input.propertyProfileAudit ??
    buildPropertyProfileAudit({ checkedAt })
  const mathWarnings = (input.mathWarnings ?? []).map<AuditFinding>((warning) => ({
    code: warning.code,
    severity: 'warn',
    source: 'math',
    message: warning.message,
  }))
  const mathStage: QualityAuditStage = {
    status: 'passed',
    checkedAt,
    hardFailures: [],
    warnings: mathWarnings,
    summary:
      mathWarnings.length > 0
        ? 'Math audit passed with warnings.'
        : 'Math audit passed.',
  }
  const hardFailures = [
    ...propertyProfileAudit.hardFailures,
    ...mathStage.hardFailures,
    ...input.authorityAudit.hardFailures,
  ]
  const warnings = [...mathWarnings, ...input.authorityAudit.warnings]
  return {
    status: hardFailures.length > 0 ? 'blocked' : 'passed',
    checkedAt,
    hardFailures,
    warnings,
    stages: {
      propertyProfile: propertyProfileAudit,
      math: mathStage,
      authority: input.authorityAudit,
    },
    summary:
      hardFailures.length > 0
        ? 'Blocking quality audit failed.'
        : warnings.length > 0
        ? 'Blocking quality audit passed with warnings.'
        : 'Blocking quality audit passed.',
  }
}

export function attachReviewStage(
  qualityAudit: QualityAudit,
  input: {
    checkedAt?: string
    blocked: boolean
    summary: string
    reviewerErrored: boolean
    failClosed: boolean
    verdict: 'clean' | 'rewrite' | 'block'
    confidence: number
    concernCount: number
  }
): QualityAudit {
  const checkedAt = input.checkedAt ?? new Date().toISOString()
  const reviewStage = {
    status: input.blocked ? 'blocked' : 'passed',
    checkedAt,
    summary: input.summary,
    reviewerErrored: input.reviewerErrored,
    failClosed: input.failClosed,
    verdict: input.verdict,
    confidence: input.confidence,
    concernCount: input.concernCount,
  } as const
  const hardFailures = input.blocked
    ? [
        ...qualityAudit.hardFailures,
        {
          code: input.reviewerErrored ? 'reviewer-unavailable' : 'review-blocked',
          severity: 'hard-fail' as const,
          source: 'review' as const,
          message: input.summary,
        },
      ]
    : qualityAudit.hardFailures

  return {
    ...qualityAudit,
    status: hardFailures.length > 0 ? 'blocked' : qualityAudit.status,
    hardFailures,
    stages: {
      ...qualityAudit.stages,
      review: reviewStage,
    },
    summary:
      hardFailures.length > 0
        ? 'Blocking quality audit failed.'
        : qualityAudit.warnings.length > 0
        ? 'Blocking quality audit passed with warnings.'
        : 'Blocking quality audit passed.',
  }
}

export function createPendingMarketAudit(): MarketAudit {
  return {
    status: 'pending',
    checkedAt: null,
    findings: [],
    summary: 'Market cross-check pending.',
    crossCheckLinks: null,
  }
}

export function buildMarketAudit(input: {
  checkedAt?: string
  valueConfidence?: 'high' | 'medium' | 'low' | null
  valueSpread?: number | null
  reportWarnings?: Array<{ code: string; message: string }>
  rentWarnings?: string[]
  crossCheckLinks?: {
    zillow: string
    redfin: string
    realtor: string
  } | null
}): MarketAudit {
  const checkedAt = input.checkedAt ?? new Date().toISOString()
  const findings: AuditFinding[] = []
  const reportWarnings = input.reportWarnings ?? []
  const rentWarnings = input.rentWarnings ?? []

  if (input.valueConfidence === 'low') {
    findings.push({
      code: 'value-confidence-low',
      severity: 'warn',
      source: 'market',
      message:
        input.valueSpread != null && Number.isFinite(input.valueSpread)
          ? `Value signals diverge materially (${Math.round(input.valueSpread * 100)}% spread). Cross-check against local market sources before relying on the headline value.`
          : 'Value signals are low confidence. Cross-check against local market sources before relying on the headline value.',
    })
  }

  for (const warning of reportWarnings) {
    if (
      warning.code === 'avm-wide-range' ||
      warning.code === 'avm-extremely-wide' ||
      warning.code === 'value-triangulation-single-signal' ||
      warning.code === 'thin-comp-set'
    ) {
      findings.push({
        code: warning.code,
        severity: 'warn',
        source: 'market',
        message: warning.message,
      })
    }
  }

  if (rentWarnings.length > 0) {
    findings.push({
      code: 'rent-cross-check-recommended',
      severity: 'warn',
      source: 'market',
      message: rentWarnings.join(' '),
    })
  }

  return {
    status: findings.length > 0 ? 'warning' : 'clean',
    checkedAt,
    findings,
    summary:
      findings.length > 0
        ? 'Async market cross-check found issues worth verifying.'
        : 'Async market cross-check found no additional warnings.',
    crossCheckLinks: input.crossCheckLinks ?? null,
  }
}
