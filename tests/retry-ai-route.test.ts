import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGenerateDealDoctor = vi.fn()
const mockRateLimit = vi.fn()
const mockReviewLoop = vi.fn()
const mockResolveReportAccess = vi.fn()
const mockVerifyShareToken = vi.fn()
const mockIsStrProhibitedForInvestor = vi.fn()
const mockReportFindUnique = vi.fn()
const mockReportUpdate = vi.fn()
const mockCustomerFindUnique = vi.fn()

vi.mock('@/lib/dealDoctor', () => ({
  generateDealDoctor: mockGenerateDealDoctor,
}))

vi.mock('@/lib/rateLimit', () => ({
  rateLimit: mockRateLimit,
}))

vi.mock('@/lib/reviewReport', () => ({
  runReviewLoop: mockReviewLoop,
}))

vi.mock('@/lib/report-access', () => ({
  resolveReportAccess: mockResolveReportAccess,
}))

vi.mock('@/lib/shareToken', () => ({
  verifyShareToken: mockVerifyShareToken,
}))

vi.mock('@/lib/calculations', () => ({
  isStrProhibitedForInvestor: mockIsStrProhibitedForInvestor,
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/lib/entitlements', () => ({
  CUSTOMER_COOKIE: 'dealdoctor_customer',
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    report: {
      findUnique: mockReportFindUnique,
      update: mockReportUpdate,
    },
    customer: {
      findUnique: mockCustomerFindUnique,
    },
  },
}))

const createRequest = (uuid: string) =>
  new NextRequest(`http://localhost/api/report/${uuid}/retry-ai`, {
    method: 'POST',
  })

const createFullReportData = (overrides: Record<string, unknown> = {}) => ({
  property: {
    address: '123 Main St',
    city: 'Austin',
    state: 'TX',
    askPrice: 295000,
    propertyType: 'Single Family',
    bedrooms: 3,
    year_built: 2005,
    square_feet: 1800,
    rehabBudget: 15000,
  },
  rates: {
    mortgage30yrInvestor: 0.0725,
  },
  inputs: {
    monthlyRent: 2200,
  },
  ltr: {
    monthlyNetCashFlow: 125,
  },
  comparableSales: [
    { estimated_value: 310000 },
    { estimated_value: 320000 },
    { estimated_value: 315000 },
  ],
  invariantWarnings: [],
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()

  mockVerifyShareToken.mockReturnValue(false)
  mockRateLimit.mockResolvedValue(false)
  mockResolveReportAccess.mockResolvedValue({
    effectiveTokenValid: false,
    isOwner: true,
  })
  mockReviewLoop.mockImplementation(async (_data, narrative) => ({
    narrative,
    outcome: {
      blocked: false,
      finalConfidence: 0.95,
      finalConcerns: [],
      finalSummary: 'clean',
      finalVerdict: 'clean',
      history: [],
      rounds: 1,
    },
  }))
  mockGenerateDealDoctor.mockResolvedValue({
    bottomLine: 'Bottom line: pass.',
    cons: [],
    diagnosis: 'Not a fit.',
    fixes: [],
    inspectionRedFlags: [],
    negotiationLevers: [],
    pros: [],
    tonePositive: false,
  })
  mockCustomerFindUnique.mockResolvedValue(null)
  mockReportUpdate.mockResolvedValue(undefined)
  mockIsStrProhibitedForInvestor.mockReturnValue(false)
})

describe('retry-ai route', () => {
  it('reuses persisted dealDoctorInputs when retrying AI narration', async () => {
    mockReportFindUnique.mockResolvedValue({
      city: 'Austin',
      customerId: 'customer-1',
      fullReportData: JSON.stringify(
        createFullReportData({
          breakeven: { price: 250000 },
          dealDoctorInputs: {
            canonicalBreakEvenPrice: 251000,
            strNetMonthlyCashFlow: -225,
            strProhibited: true,
          },
        })
      ),
      id: 'report-1',
      paid: true,
      state: 'TX',
    })

    const { POST } = await import('../app/api/report/[uuid]/retry-ai/route')
    const response = await POST(createRequest('report-1'), {
      params: { uuid: 'report-1' },
    })

    expect(response.status).toBe(200)
    expect(mockGenerateDealDoctor).toHaveBeenCalledTimes(1)
    const generateDealDoctorArguments = mockGenerateDealDoctor.mock.calls[0]
    expect(generateDealDoctorArguments[12]).toBe(251000)
    expect(generateDealDoctorArguments[16]).toBe(true)
    expect(generateDealDoctorArguments[17]).toBe(-225)
    expect(mockIsStrProhibitedForInvestor).not.toHaveBeenCalled()
  })

  it('falls back to persisted report sections when dealDoctorInputs are absent', async () => {
    mockReportFindUnique.mockResolvedValue({
      city: 'Baltimore',
      customerId: 'customer-1',
      fullReportData: JSON.stringify(
        createFullReportData({
          breakeven: { price: 244000 },
          strProjection: { monthlyNetCashFlow: -480 },
        })
      ),
      id: 'report-2',
      paid: true,
      state: 'MD',
    })
    mockIsStrProhibitedForInvestor.mockReturnValue(true)

    const { POST } = await import('../app/api/report/[uuid]/retry-ai/route')
    const response = await POST(createRequest('report-2'), {
      params: { uuid: 'report-2' },
    })

    expect(response.status).toBe(200)
    const generateDealDoctorArguments = mockGenerateDealDoctor.mock.calls[0]
    expect(generateDealDoctorArguments[12]).toBe(244000)
    expect(generateDealDoctorArguments[16]).toBe(true)
    expect(generateDealDoctorArguments[17]).toBe(-480)
    expect(mockIsStrProhibitedForInvestor).toHaveBeenCalledWith('MD', 'Baltimore')
  })
})
