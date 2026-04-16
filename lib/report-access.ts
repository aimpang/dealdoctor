import { prisma } from './db'
import { verifyShareToken } from './shareToken'
import { isDebugAccessAuthorized } from './debugAccess'

export interface ReportAccessOptions {
  allowDebug?: boolean
  cookieAccessToken?: string | null
  debugKey?: string | null
  debugRequested?: boolean
  reportCustomerId?: string | null
  reportId: string
  reportPurchaseId?: string | null
  resolvedCookieCustomerId?: string | null
  resolvedTokenValid?: boolean
  tokenCandidate?: string | null
}

export interface ReportAccessResult {
  accessGrantedVia: 'debug' | 'owner' | 'share-token' | 'none'
  effectiveTokenValid: boolean
  hasAccess: boolean
  isDebug: boolean
  isOwner: boolean
  tokenRevokedByRefund: boolean
  tokenValid: boolean
}

export const resolveReportAccess = async (
  options: ReportAccessOptions
): Promise<ReportAccessResult> => {
  const tokenValid =
    typeof options.resolvedTokenValid === 'boolean'
      ? options.resolvedTokenValid
      : verifyShareToken(options.reportId, options.tokenCandidate)

  let resolvedCookieCustomerId = options.resolvedCookieCustomerId ?? null
  if (resolvedCookieCustomerId === null && options.cookieAccessToken && options.reportCustomerId) {
    const cookieCustomer = await prisma.customer.findUnique({
      where: { accessToken: options.cookieAccessToken },
      select: { id: true },
    })
    resolvedCookieCustomerId = cookieCustomer?.id ?? null
  }

  const isOwner = Boolean(
    resolvedCookieCustomerId &&
      options.reportCustomerId &&
      resolvedCookieCustomerId === options.reportCustomerId
  )

  let purchaseRevokedByRefund = false
  let legacyRefundRevokedToken = false
  if (options.reportPurchaseId) {
    const reportPurchase = await prisma.purchase.findUnique({
      where: { id: options.reportPurchaseId },
      select: { status: true },
    })
    purchaseRevokedByRefund = reportPurchase?.status === 'refunded'
  } else if (options.reportCustomerId) {
    const reportOwner = await prisma.customer.findUnique({
      where: { id: options.reportCustomerId },
      select: { subscriptionStatus: true },
    })
    legacyRefundRevokedToken = reportOwner?.subscriptionStatus === 'refunded'
  }

  const effectiveTokenValid = tokenValid && !purchaseRevokedByRefund && !legacyRefundRevokedToken
  const effectiveOwner = options.reportPurchaseId ? isOwner && !purchaseRevokedByRefund : isOwner
  const isDebug = Boolean(
    options.allowDebug &&
      options.debugRequested &&
      isDebugAccessAuthorized(options.debugKey)
  )
  const hasAccess = isDebug || effectiveOwner || effectiveTokenValid
  const accessGrantedVia = isDebug
    ? 'debug'
    : effectiveOwner
    ? 'owner'
    : effectiveTokenValid
    ? 'share-token'
    : 'none'

  return {
    accessGrantedVia,
    effectiveTokenValid,
    hasAccess,
    isDebug,
    isOwner,
    tokenRevokedByRefund: purchaseRevokedByRefund || legacyRefundRevokedToken,
    tokenValid,
  }
}
