import { PrismaClient } from '@prisma/client'

interface LemonSqueezyOrderRecord {
  id: string
  createdAt: string | null
  refundedAt: string | null
}

interface ReconciliationSummary {
  ledgerOnlyPurchaseCount: number
  lemonsqueezyOnlyOrderCount: number
  statusMismatchCount: number
}

interface LemonSqueezyOrderPayloadRecord {
  attributes?: Record<string, unknown>
  id?: string | number
}

interface LemonSqueezyOrderPayload {
  data?: LemonSqueezyOrderPayloadRecord[]
  links?: { next?: string | null }
}

const DEFAULT_LOOKBACK_DAYS = 30
const MAX_PAGE_SIZE = 100
const LOOKBACK_FLAG = '--days='
const JWT_SEGMENT_COUNT = 3
const MASK_VISIBLE_PREFIX_LENGTH = 4
const MASK_VISIBLE_SUFFIX_LENGTH = 4

const databaseClient = new PrismaClient()

const parseLookbackDays = () => {
  const lookbackArgument = process.argv.find((argument) => argument.startsWith(LOOKBACK_FLAG))
  if (!lookbackArgument) {
    return DEFAULT_LOOKBACK_DAYS
  }

  const parsedValue = Number(lookbackArgument.slice(LOOKBACK_FLAG.length))
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : DEFAULT_LOOKBACK_DAYS
}

const fetchAllOrders = async (lookbackDays: number) => {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY
  const storeId = process.env.LEMONSQUEEZY_STORE_ID

  if (!apiKey || !storeId) {
    throw new Error('LEMONSQUEEZY_API_KEY and LEMONSQUEEZY_STORE_ID are required')
  }

  const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
  const orders = new Map<string, LemonSqueezyOrderRecord>()
  let nextPageUrl: string | null =
    `https://api.lemonsqueezy.com/v1/orders?page[number]=1&page[size]=${MAX_PAGE_SIZE}` +
    `&filter[store_id]=${storeId}`

  while (nextPageUrl) {
    const response = await fetch(nextPageUrl, {
      headers: {
        Accept: 'application/vnd.api+json',
        Authorization: `Bearer ${apiKey}`,
      },
    })

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(buildUnauthorizedMessage(apiKey, storeId))
      }

      throw new Error(`Failed to fetch LemonSqueezy orders: ${response.status}`)
    }

    const payload = (await response.json()) as LemonSqueezyOrderPayload
    const currentPageOrders = payload.data ?? []

    for (const order of currentPageOrders) {
      const id =
        typeof order.id === 'number'
          ? String(order.id)
          : typeof order.id === 'string'
            ? order.id
            : null

      if (!id) {
        continue
      }

      const createdAtValue = order.attributes?.created_at
      const refundedAtValue = order.attributes?.refunded_at
      const createdAt =
        typeof createdAtValue === 'string' ? new Date(createdAtValue) : null

      if (createdAt && createdAt < cutoffDate) {
        continue
      }

      orders.set(id, {
        id,
        createdAt: typeof createdAtValue === 'string' ? createdAtValue : null,
        refundedAt: typeof refundedAtValue === 'string' ? refundedAtValue : null,
      })
    }

    if (hasReachedLookbackBoundary(currentPageOrders, cutoffDate)) {
      break
    }

    nextPageUrl = payload.links?.next ?? null
  }

  return orders
}

const hasReachedLookbackBoundary = (
  currentPageOrders: LemonSqueezyOrderPayloadRecord[],
  cutoffDate: Date
) => {
  const lastOrderRecord = currentPageOrders.at(-1)
  const lastCreatedAtValue = lastOrderRecord?.attributes?.created_at

  if (typeof lastCreatedAtValue !== 'string') {
    return false
  }

  const lastCreatedAt = new Date(lastCreatedAtValue)
  return lastCreatedAt < cutoffDate
}

const buildUnauthorizedMessage = (apiKey: string, storeId: string) => {
  const maskedKey = maskSecret(apiKey)
  const tokenLooksLikeJwt = looksLikeJwt(apiKey)
  const tokenHint = tokenLooksLikeJwt
    ? ' The configured key looks like a JWT or session token, not a LemonSqueezy dashboard API key.'
    : ''

  return (
    `LemonSqueezy API returned 401 for store ${storeId}. ` +
    `Verify LEMONSQUEEZY_API_KEY is a valid API key from LemonSqueezy Settings > API and that it belongs to the same live/test account as LEMONSQUEEZY_STORE_ID. ` +
    `Current key: ${maskedKey}.${tokenHint}`
  )
}

const looksLikeJwt = (value: string) => {
  return value.startsWith('eyJ') || value.split('.').length === JWT_SEGMENT_COUNT
}

const maskSecret = (value: string) => {
  if (value.length <= MASK_VISIBLE_PREFIX_LENGTH + MASK_VISIBLE_SUFFIX_LENGTH) {
    return '[too-short]'
  }

  return (
    value.slice(0, MASK_VISIBLE_PREFIX_LENGTH) +
    '...' +
    value.slice(value.length - MASK_VISIBLE_SUFFIX_LENGTH)
  )
}

const main = async () => {
  const lookbackDays = parseLookbackDays()
  const lemonsqueezyOrders = await fetchAllOrders(lookbackDays)
  const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
  const ledgerPurchases = await databaseClient.purchase.findMany({
    where: {
      purchasedAt: { gte: cutoffDate },
    },
    select: {
      id: true,
      providerOrderId: true,
      source: true,
      status: true,
    },
  })

  const ledgerOnlyPurchases = ledgerPurchases.filter((purchase) => {
    if (purchase.source === 'backfill_migration') {
      return false
    }

    if (!purchase.providerOrderId) {
      return true
    }

    return !lemonsqueezyOrders.has(purchase.providerOrderId)
  })

  const lemonsqueezyOnlyOrders = Array.from(lemonsqueezyOrders.values()).filter(
    (order) =>
      !ledgerPurchases.some((purchase) => purchase.providerOrderId === order.id)
  )

  const statusMismatches = ledgerPurchases.filter((purchase) => {
    if (!purchase.providerOrderId) {
      return false
    }

    const lemonsqueezyOrder = lemonsqueezyOrders.get(purchase.providerOrderId)
    if (!lemonsqueezyOrder) {
      return false
    }

    const expectedLedgerStatus = lemonsqueezyOrder.refundedAt ? 'refunded' : null
    return expectedLedgerStatus !== null && purchase.status !== expectedLedgerStatus
  })

  const summary: ReconciliationSummary = {
    ledgerOnlyPurchaseCount: ledgerOnlyPurchases.length,
    lemonsqueezyOnlyOrderCount: lemonsqueezyOnlyOrders.length,
    statusMismatchCount: statusMismatches.length,
  }

  console.table(summary)

  if (ledgerOnlyPurchases.length > 0) {
    console.log('Ledger purchases missing from LemonSqueezy:')
    console.table(
      ledgerOnlyPurchases.map((purchase) => ({
        id: purchase.id,
        providerOrderId: purchase.providerOrderId,
        status: purchase.status,
        source: purchase.source,
      }))
    )
  }

  if (lemonsqueezyOnlyOrders.length > 0) {
    console.log('LemonSqueezy orders missing from ledger:')
    console.table(lemonsqueezyOnlyOrders)
  }

  if (statusMismatches.length > 0) {
    console.log('Status mismatches:')
    console.table(
      statusMismatches.map((purchase) => ({
        id: purchase.id,
        providerOrderId: purchase.providerOrderId,
        status: purchase.status,
      }))
    )
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await databaseClient.$disconnect()
  })
