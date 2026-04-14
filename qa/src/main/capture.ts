import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { CapturedReport, ExtractedData } from '../shared/types';

const DEV_URL = process.env.DEALDOCTOR_URL || 'http://localhost:3000';

let browserPromise: Promise<Browser> | null = null;
let sharedContext: BrowserContext | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

async function getContext(): Promise<BrowserContext> {
  if (sharedContext && !(sharedContext as unknown as { _closed?: boolean })._closed) {
    return sharedContext;
  }
  const browser = await getBrowser();
  sharedContext = await browser.newContext({ viewport: { width: 1280, height: 1800 } });
  return sharedContext;
}

export async function closeBrowser() {
  if (sharedContext) {
    try { await sharedContext.close(); } catch { /* ignore */ }
    sharedContext = null;
  }
  if (browserPromise) {
    const b = await browserPromise;
    try { await b.close(); } catch { /* ignore */ }
    browserPromise = null;
  }
}

// ─── Per-address fact-sheet cache ──────────────────────────────────────────
// A fact sheet is a small JSON blob we scrape from public sources (Zillow,
// Redfin, Apartments.com) once per address and feed to the Market agent so
// it doesn't have to do 6+ web searches from scratch on every run. Cached
// in-memory across runs in the same Electron session.

export interface AddressFactSheet {
  address: string;
  scrapedAt: string;
  zillowUrl?: string;
  redfinUrl?: string;
  apartmentsUrl?: string;
  buildingName?: string;
  yearBuilt?: number;
  unitCount?: number;
  hoaMonthly?: number;
  zipMedianSale?: number;
  zipMedianRent?: number;
  comparableSalesSummary?: string;
  sources: string[]; // URLs we hit
}

const factSheetCache = new Map<string, AddressFactSheet>();

export function getFactSheet(address: string): AddressFactSheet | undefined {
  return factSheetCache.get(normalizeAddress(address));
}

export function setFactSheet(address: string, sheet: AddressFactSheet) {
  factSheetCache.set(normalizeAddress(address), sheet);
}

function normalizeAddress(a: string): string {
  return a.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Scrape a lightweight public fact sheet for the address using the shared
 * Playwright browser. Best-effort — every field is optional. Called once
 * per address and cached for the rest of the session.
 */
export async function scrapeFactSheet(address: string): Promise<AddressFactSheet> {
  const cached = getFactSheet(address);
  if (cached) return cached;

  const ctx = await getContext();
  const page = await ctx.newPage();
  const sheet: AddressFactSheet = {
    address,
    scrapedAt: new Date().toISOString(),
    sources: [],
  };

  // Helper: attempt a scrape and swallow errors.
  const tryScrape = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      console.error(`[qa] factSheet ${name} failed:`, (err as Error).message);
    }
  };

  await tryScrape('google', async () => {
    const q = encodeURIComponent(`"${address}" site:zillow.com OR site:redfin.com OR site:apartments.com`);
    await page.goto(`https://www.google.com/search?q=${q}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const links = await page.$$eval('a[href]', (as) =>
      (as as HTMLAnchorElement[]).map((a) => a.href).filter((h) => /zillow|redfin|apartments/i.test(h))
    );
    for (const l of links.slice(0, 10)) {
      sheet.sources.push(l);
      if (/zillow/i.test(l) && !sheet.zillowUrl) sheet.zillowUrl = l;
      if (/redfin/i.test(l) && !sheet.redfinUrl) sheet.redfinUrl = l;
      if (/apartments\.com/i.test(l) && !sheet.apartmentsUrl) sheet.apartmentsUrl = l;
    }
  });

  await tryScrape('apartments', async () => {
    if (!sheet.apartmentsUrl) return;
    await page.goto(sheet.apartmentsUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const text = await page.evaluate(() => document.body.innerText.slice(0, 8000));
    const hoaMatch = text.match(/HOA[^\n]{0,40}\$\s*([\d,]+)/i);
    if (hoaMatch) {
      const n = parseInt(hoaMatch[1].replace(/,/g, ''), 10);
      if (n >= 0 && n < 5000) sheet.hoaMonthly = n;
    }
    const yearMatch = text.match(/(?:built|year built)[:\s]+(\d{4})/i);
    if (yearMatch) sheet.yearBuilt = parseInt(yearMatch[1], 10);
    const nameMatch = text.match(/^([A-Z][\w\s]+(?:Condominium|Apartments|House|Tower|Place|Court))/m);
    if (nameMatch) sheet.buildingName = nameMatch[1].trim();
  });

  await page.close();
  setFactSheet(address, sheet);
  return sheet;
}

/**
 * Submit an address on the landing page, ride through the teaser, reach the
 * full report, save a PDF, and extract structured data for downstream agents.
 */
export async function captureReport(
  address: string,
  outDir: string,
  runNumber: number
): Promise<CapturedReport> {
  fs.mkdirSync(outDir, { recursive: true });
  const ctx = await getContext();
  const page = await ctx.newPage();
  try {
    // Intercept the /api/preview response before navigation — its body has
    // the UUID DealDoctor stashes only in React state.
    let uuidFromPreview: string | null = null;
    page.on('response', async (resp) => {
      const url = resp.url();
      if (url.includes('/api/')) {
        console.log('[qa] api response:', resp.status(), url.replace(DEV_URL, ''));
      }
      if (/\/api\/preview\b/.test(url) && resp.ok()) {
        try {
          const body = await resp.json();
          console.log('[qa] preview body keys:', Object.keys(body ?? {}));
          if (body?.uuid) uuidFromPreview = body.uuid as string;
        } catch (err) {
          console.error('[qa] preview json parse failed:', (err as Error).message);
        }
      }
    });

    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const addressInput = page.getByPlaceholder(/evergreen terrace/i);
    await addressInput.waitFor({ timeout: 15_000 });
    await addressInput.fill(address);
    await addressInput.press('Enter');

    // Teaser renders inline; wait for Breakeven tile to confirm.
    await page.getByText(/breakeven/i).first().waitFor({ timeout: 60_000 });
    // Give the preview response a beat to land in our interceptor.
    for (let i = 0; i < 20 && !uuidFromPreview; i++) {
      await page.waitForTimeout(150);
    }

    const uuid = uuidFromPreview ?? (await resolveReportUuid(page));
    console.log('[qa] resolved uuid:', uuid, 'via', uuidFromPreview ? 'preview-intercept' : 'dom-fallback');
    if (!uuid) {
      throw new Error('Could not resolve report UUID from teaser — /api/preview did not return { uuid }');
    }

    await page.goto(`${DEV_URL}/report/${uuid}?debug=1`, { waitUntil: 'domcontentloaded' });
    await page.getByText(/offer vs breakeven/i).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(500); // let charts settle

    const pdfPath = path.join(outDir, `run-${runNumber}.pdf`);
    await page.pdf({
      path: pdfPath,
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.4in', bottom: '0.4in', left: '0.4in', right: '0.4in' },
    });

    // Prefer fetching the structured report JSON from DealDoctor's own API —
    // that's the source of truth the page was rendered from. DOM scraping is
    // the fallback if the API shape isn't what we expect.
    const apiData = await fetchReportJson(page, uuid);
    const domData = await extractReportData(page, address);
    const data = apiData ? mergeData(apiData, domData, address) : domData;

    return { pdfPath, data, capturedAt: new Date().toISOString() };
  } finally {
    // Only close the page — the shared browser context stays alive across
    // captures for reuse (saves ~4-6s per call).
    await page.close().catch(() => undefined);
  }
}

async function fetchReportJson(page: Page, uuid: string): Promise<Record<string, unknown> | null> {
  try {
    const resp = await page.request.get(`${DEV_URL}/api/report/${uuid}?debug=1`);
    console.log('[qa] /api/report status:', resp.status());
    if (!resp.ok()) return null;
    const body = (await resp.json()) as Record<string, unknown>;
    console.log('[qa] /api/report keys:', Object.keys(body));
    console.log(
      '[qa] /api/report fullReportData type:',
      typeof body.fullReportData,
      'length:',
      typeof body.fullReportData === 'string' ? body.fullReportData.length : 'n/a'
    );
    return body;
  } catch (err) {
    console.error('[qa] /api/report fetch failed:', (err as Error).message);
    return null;
  }
}

function mergeData(api: Record<string, unknown>, dom: ExtractedData, address: string): ExtractedData {
  // DealDoctor's /api/report/[uuid] returns:
  //   { id, address, paid, debug, teaserData, fullReportData (JSON STRING), ... }
  // fullReportData is the output of composeFullReport — see lib/reportGenerator.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = api as any;
  let full: any = null;
  try {
    full = typeof a.fullReportData === 'string' ? JSON.parse(a.fullReportData) : a.fullReportData ?? null;
  } catch {
    full = null;
  }
  let teaser: any = null;
  try {
    teaser = typeof a.teaserData === 'string' ? JSON.parse(a.teaserData) : a.teaserData ?? null;
  } catch {
    teaser = null;
  }

  if (!full) {
    return { ...dom, address, raw: api };
  }

  const prop = full.property ?? {};
  const be = full.breakeven ?? {};
  const wp = full.wealthProjection ?? {};
  const hero = wp.hero ?? {};
  const years = wp.years ?? [];
  const sens = full.sensitivity ?? {};
  const vt = full.valueTriangulation ?? {};
  const ltr = full.ltr ?? {};
  const offers = full.recommendedOffers ?? {};
  const dd = full.dealDoctor ?? {};
  const exp = full.expenses ?? {};
  const inputs = full.inputs ?? {};

  // Year-1 monthly cash flow isn't stored directly — it's the first wealth-
  // projection year's monthlyCashFlow if present, otherwise derivable from
  // rent − expenses − debt service. Pull the cheap path; the invariant check
  // tolerates undefined.
  const year1 = years[0] ?? null;
  const monthlyCashFlow = year1?.monthlyCashFlow ?? year1?.cashFlowMonthly ?? offers?.baseCashFlow;

  const saleMedian = (() => {
    const sales = (full.comparableSales ?? []).map((c: any) => Number(c?.price)).filter((n: number) => n > 0);
    if (sales.length === 0) return undefined;
    const sorted = [...sales].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  })();

  // Narrative prose — dealDoctor block contains AI-generated content.
  const narrativeBits: string[] = [];
  for (const key of ['whatsWrong', 'whatsWorking', 'negotiation', 'inspectorShouldCheck', 'bottomLine', 'text', 'summary', 'narrative']) {
    const v = dd?.[key];
    if (typeof v === 'string' && v.trim()) narrativeBits.push(`## ${key}\n${v}`);
    else if (Array.isArray(v)) narrativeBits.push(`## ${key}\n${v.filter((x) => typeof x === 'string').join('\n')}`);
  }
  const narrativeText = narrativeBits.join('\n\n') || dom.narrativeText;

  return {
    address,
    propertyType: prop.propertyType ?? dom.propertyType,
    yearBuilt: prop.yearBuilt ?? dom.yearBuilt,
    squareFeet: prop.sqft ?? dom.squareFeet,
    bedrooms: prop.bedrooms ?? dom.bedrooms,
    avm: prop.askPrice ?? vt.primaryValue ?? dom.avm,
    avmLow: vt.valueRangeLow ?? dom.avmLow,
    avmHigh: vt.valueRangeHigh ?? dom.avmHigh,
    compsMedian: saleMedian ?? dom.compsMedian,
    rentEstimate: inputs.monthlyRent ?? full.rentAdjustment?.effectiveRent ?? dom.rentEstimate,
    hoa: exp.monthlyHOA ?? dom.hoa,
    dscr: ltr.dscr ?? offers.dscr ?? dom.dscr,
    score: full.score ?? dom.score,
    verdict: full.verdict ?? dom.verdict,
    showsDivergenceWarning: vt.spreadPct != null ? vt.spreadPct > 25 : undefined,
    spreadLabel: vt.spreadPct,
    summaryCard: {
      irr: hero.irr5yr,
      cashFlow: monthlyCashFlow,
      breakeven: be.price,
    },
    sensitivity: {
      baseCase: {
        irr: sens.baseCase?.irr ?? sens.baseCase?.irr5yr ?? hero.irr5yr,
        cashFlow: sens.baseCase?.cashFlow ?? sens.baseCase?.monthlyCashFlow ?? monthlyCashFlow,
      },
    },
    instantCard: { breakeven: teaser?.breakeven ?? teaser?.breakevenPrice ?? be.price },
    fullReport: { breakeven: be.price },
    wealthTable: {
      years: years.map((y: any, i: number) => ({
        number: y.year ?? i + 1,
        cumulativeCashFlow: y.cumulativeCashFlow ?? 0,
        cumulativeTaxShield: y.cumulativeTaxShield ?? 0,
        // Combined equity = principal paydown + appreciation. DealDoctor
        // splits these correctly (per the spec's fix), so the invariant
        // should sum both.
        cumulativeEquityBuilt: (y.equityFromPaydown ?? 0) + (y.equityFromAppreciation ?? 0),
        equityBuilt: y.equityFromPaydown ?? 0, // principal-only; must be ≥ 0
        wealth: y.totalWealthBuilt ?? 0,
      })),
    },
    saleComps: (full.comparableSales ?? []).map((c: any) => ({
      address: c.address ?? c.formattedAddress ?? '',
      price: c.price,
      sqft: c.squareFootage ?? c.square_feet ?? c.sqft,
      pricePerSqft: c.pricePerSqft,
      yearBuilt: c.yearBuilt ?? c.year_built,
    })),
    rentComps: (full.rentComps ?? []).map((c: any) => ({
      address: c.address ?? c.formattedAddress ?? '',
      rent: c.rent,
      sqft: c.squareFootage ?? c.sqft,
    })),
    narrativeText,
    raw: full,
  };
}

async function resolveReportUuid(page: Page): Promise<string | null> {
  // Strategy 1: body data attribute (if exposed)
  const attr = await page.evaluate(() => document.body.dataset.reportUuid || null);
  if (attr) return attr;
  // Strategy 2: any <a href="/report/<uuid>">
  const href = await page
    .locator('a[href^="/report/"]')
    .first()
    .getAttribute('href')
    .catch(() => null);
  if (href) {
    const m = href.match(/\/report\/([a-f0-9-]+)/i);
    if (m) return m[1];
  }
  // Strategy 3: localStorage / sessionStorage key DealDoctor may set
  const fromStorage = await page.evaluate(() => {
    const keys = ['dd:lastReportUuid', 'dealdoctor:lastUuid', 'lastReportUuid'];
    for (const k of keys) {
      const v = localStorage.getItem(k) || sessionStorage.getItem(k);
      if (v) return v;
    }
    return null;
  });
  return fromStorage;
}

/**
 * Extract structured data from the rendered full-report page. Uses a best-
 * effort DOM scrape + a DealDoctor-exposed global if available. Returns
 * partial data on failure — Agent 2 handles undefineds gracefully.
 */
async function extractReportData(page: Page, address: string): Promise<ExtractedData> {
  const scraped = await page.evaluate(() => {
    const readNumber = (text: string | null | undefined): number | undefined => {
      if (!text) return undefined;
      const cleaned = text.replace(/[$,%\s]/g, '');
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? n : undefined;
    };

    // If DealDoctor exposes a debug global, use it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbg = (window as any).__DD_REPORT__;
    if (dbg && typeof dbg === 'object') {
      return { raw: dbg, source: 'window.__DD_REPORT__' };
    }

    const findByLabel = (labels: string[]): string | null => {
      const all = Array.from(document.querySelectorAll('*'));
      for (const label of labels) {
        const re = new RegExp(label, 'i');
        const el = all.find((e) => re.test(e.textContent || ''));
        if (!el) continue;
        // look at next sibling with a number, or child with large text
        const parent = el.parentElement;
        if (!parent) continue;
        const numText = Array.from(parent.querySelectorAll('*'))
          .map((c) => c.textContent || '')
          .find((t) => /\$?[\d,]+\.?\d*/.test(t) && t.length < 40);
        if (numText) return numText;
      }
      return null;
    };

    const bodyText = document.body.innerText;

    return {
      raw: { bodyText, source: 'dom_scrape' },
      scraped: {
        breakeven: readNumber(findByLabel(['break\\s*even'])),
        irr: readNumber(findByLabel(['IRR', 'Investor Rate'])),
        avm: readNumber(findByLabel(['Est\\. Value', 'Estimated Value', 'AVM'])),
        rentEstimate: readNumber(findByLabel(['Est\\. Rent', 'Estimated Rent'])),
        cashFlow: readNumber(findByLabel(['Cash Flow'])),
        dscr: readNumber(findByLabel(['DSCR'])),
        score: readNumber(findByLabel(['Score'])),
      },
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (scraped as any).raw ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: any = (scraped as any).scraped ?? {};

  return {
    address,
    avm: raw.avm ?? s.avm,
    rentEstimate: raw.rentEstimate ?? s.rentEstimate,
    dscr: raw.dscr ?? s.dscr,
    score: raw.score ?? s.score,
    verdict: raw.verdict,
    propertyType: raw.propertyType,
    yearBuilt: raw.yearBuilt,
    squareFeet: raw.squareFeet,
    bedrooms: raw.bedrooms,
    hoa: raw.hoa,
    compsMedian: raw.compsMedian,
    avmLow: raw.avmLow,
    avmHigh: raw.avmHigh,
    showsDivergenceWarning: raw.showsDivergenceWarning,
    spreadLabel: raw.spreadLabel,
    summaryCard: raw.summaryCard ?? { irr: s.irr, cashFlow: s.cashFlow, breakeven: s.breakeven },
    sensitivity: raw.sensitivity,
    instantCard: raw.instantCard ?? { breakeven: s.breakeven },
    fullReport: raw.fullReport ?? { breakeven: s.breakeven },
    wealthTable: raw.wealthTable,
    saleComps: raw.saleComps,
    rentComps: raw.rentComps,
    narrativeText: raw.narrativeText,
    raw,
  };
}
