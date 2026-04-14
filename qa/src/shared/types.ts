export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type AgentSource = 'market_accuracy' | 'internal_consistency' | 'narrative_accuracy';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

// Canonical issue categories — every audit agent tags each issue with one.
// Used for stable recurrence matching (no fuzzy title compare) and smarter
// dev-agent routing. Matches the spec's bucket list from part1.
export type IssueCategory =
  // data/calc bucket
  | 'sale_comps'
  | 'rent_comps'
  | 'value_estimate'
  | 'hoa'
  | 'zip_market'
  | 'property_metadata'
  | 'irr_mismatch'
  | 'breakeven_mismatch'
  | 'cashflow_mismatch'
  | 'false_warning'
  | 'misleading_label'
  | 'wealth_math'
  | 'duplicate_comps'
  | 'dscr_range'
  | 'grm_range'
  | 'ppsf_divergence'
  | 'str_cap'
  | 'growth_model'
  // narrative/display bucket
  | 'narrative_accuracy'
  | 'property_type_drift'
  | 'hallucinated_figure'
  | 'inspector_guidance'
  | 'negotiation_mismatch'
  | 'verdict_questionable'
  | 'str_math'
  | 'prose_factual'
  // meta
  | 'extraction_failed'
  | 'other';

export interface Issue {
  severity: Severity;
  title: string;
  category?: IssueCategory;
  confidence?: 'high' | 'medium' | 'low';
  reportSays?: string;
  actuallyFound?: string;
  conflict?: string;
  narrativeText?: string;
  structuredData?: string;
  source?: string;
  fix: string;
}

export interface ConsolidatedIssue extends Issue {
  id: number;
  checked: boolean;
  source: AgentSource;
  priorAttempts?: PriorAttempt[];
}

export interface PriorAttempt {
  runNumber: number;
  outcome: 'applied' | 'skipped';
  fixedBy?: DeveloperLabel;
  file?: string;
  change?: string;   // one-line summary of what was done
  reason?: string;   // populated for skipped
}

export interface MissedData {
  type: string;
  data: string;
  source?: string;
}

export interface AgentReport {
  agent: AgentSource;
  grade: Grade;
  issues: Issue[];
  missedData?: MissedData[];
  error?: string;
}

export interface CapturedReport {
  pdfPath: string;
  data: ExtractedData;
  capturedAt: string;
}

export interface ExtractedData {
  address: string;
  propertyType?: string;
  yearBuilt?: number;
  squareFeet?: number;
  bedrooms?: number;
  avm?: number;
  avmLow?: number;
  avmHigh?: number;
  compsMedian?: number;
  rentEstimate?: number;
  hoa?: number;
  dscr?: number;
  score?: number;
  verdict?: string;
  showsDivergenceWarning?: boolean;
  spreadLabel?: number;
  summaryCard?: { irr?: number; cashFlow?: number; breakeven?: number };
  sensitivity?: { baseCase?: { irr?: number; cashFlow?: number } };
  instantCard?: { breakeven?: number };
  fullReport?: { breakeven?: number };
  wealthTable?: { years: Array<{ number: number; cumulativeCashFlow: number; cumulativeTaxShield: number; cumulativeEquityBuilt: number; wealth: number; equityBuilt: number }> };
  saleComps?: Array<{ address: string; price?: number; sqft?: number; pricePerSqft?: number; yearBuilt?: number }>;
  rentComps?: Array<{ address: string; rent?: number; sqft?: number }>;
  narrativeText?: string;
  raw?: Record<string, unknown>;
}

export interface RunResult {
  number: number;
  timestamp: string;
  pdfPath: string;
  reports: AgentReport[];
  consolidated: ConsolidatedIssue[];
  totals: { critical: number; high: number; medium: number; low: number };
  // Developer-agent result that ran AFTER this run (patches, skipped, tests).
  // Populated only if the operator pressed "fix" on this run.
  devResult?: DeveloperResult;
}

export interface LoopState {
  address: string;
  startedAt: string;
  runs: RunResult[];
  status: 'idle' | 'capturing' | 'auditing' | 'awaiting_review' | 'fixing' | 'done';
  statusMessage: string;
}

export interface StatusEvent {
  phase: LoopState['status'];
  message: string;
  runNumber?: number;
}

export type AgentKey =
  | 'market'
  | 'consistency'
  | 'narrative'
  | 'testwriter'
  | 'developerA'
  | 'developerB'
  | 'reviewer';
export type AgentPhase = 'idle' | 'running' | 'done' | 'error';
export type DeveloperLabel = 'ANDY' | 'KEVIN';

export interface TestWriterResult {
  testsWritten: Array<{ bug: string; testFile: string; description?: string }>;
  skipped: Array<{ bug: string; reason: string }>;
  rawTranscript?: string;
  error?: string;
}

export interface ReviewerResult {
  verdict: 'ship' | 'block' | 'warn';
  concerns: Array<{ severity: Severity; file?: string; line?: number; title: string; detail?: string }>;
  summary?: string;
  rawTranscript?: string;
  error?: string;
}

export interface AgentEvent {
  agent: AgentKey;
  phase: AgentPhase;
  chunk?: string;       // live output fragment
  message?: string;     // human-readable status (e.g. "auditing comps via web search")
  grade?: Grade;
  issueCount?: number;
  error?: string;
}

export interface DeveloperResult {
  fixesApplied: Array<{ bug: string; file?: string; change: string; linesChanged?: number; fixedBy?: DeveloperLabel; testsAdded?: string[] }>;
  skipped: Array<{ bug: string; reason: string; skippedBy?: DeveloperLabel }>;
  testsRun?: number;
  testsPassed?: number;
  testsFailed?: number;
  newPdfPath?: string;
  rawTranscript?: string;
  conflicts?: string[]; // files modified by both devs
  resolvedValues?: ResolvedValues;
  perAgent?: Record<DeveloperLabel, SingleDeveloperResult>;
  testWriter?: TestWriterResult;
  reviewer?: ReviewerResult;
}

export interface SingleDeveloperResult {
  label: DeveloperLabel;
  fixesApplied: Array<{ bug: string; file?: string; change: string; linesChanged?: number; testsAdded?: string[] }>;
  skipped: Array<{ bug: string; reason: string }>;
  testsRun?: number;
  testsPassed?: number;
  testsFailed?: number;
  rawTranscript?: string;
}

export interface ResolvedValues {
  rentEstimate?: number;
  propertyType?: string;
  hoa?: number;
  avm?: number;
  breakeven?: number;
  dscr?: number;
  bedrooms?: number;
  squareFeet?: number;
  yearBuilt?: number;
  [key: string]: unknown;
}
