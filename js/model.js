// Data model, defaults and settings for the Trade Journal data file (one JSON file in Google Drive).
// Raise APP_VERSION with EVERY release that goes live: the first time a new version opens the data file,
// a "before update" backup is made (B5).
export const APP_VERSION = '1.3.2';
export const SCHEMA = 1;

export function defaultSettings() {
  return {
    // Stops check (G1): percent distance between last price and Current stop
    stopBelowBuy: { raiseAbove: '6', closeWithin: '1' },
    stopAboveBuy: { raiseAbove: '9', closeWithin: '2' },
    // Next report (G2)
    reportedAgoDays: 6, reportStaleDays: 30,
    // G3..G8
    highestToStop: '10', emaNear: '1.5', stopFarBelowBuy: '5.5', stopFarBelowBuyRisk: '0.2', profitLocked: '15',
    riskWarn: '0.2', riskRed: '0.56',
    posTooBig: '12.01', posNear: '11', posSmallFrom: '1', posSmallTo: '5',
    histLoss: '0.5', histGain: '1',
    stockLoss1: '1', stockLoss2: '1.5', stockGain1: '1', stockGain2: '1.5',
    // F6 labels
    rCategories: [['3', 'BIG WINNER'], ['1.5', 'GOOD WINNER'], ['0.5', 'WINNER'], ['0', 'SMALL GAIN'], ['-0.5', 'CONTROLLED LOSS'], ['-1.11', 'STOP LOSS']],
    rCategoryElse: 'BAD LOSS',
    stopDistance: [['3', 'Tight'], ['7', 'Good'], ['10', 'Wide']], stopDistanceElse: 'High Risk',
    // saving
    saveDelaySec: 3,
    // weekly Excel copy in the Backups folder (readable copy; restore always uses the JSON backups)
    excelCopyDays: 7, excelCopyKeep: 4,
    // price jump check on typed prices. NOT yet decided by the owner: value below is a starting value, shown in Settings.
    bigJumpPct: '20',
  };
}

export function emptyState(now = new Date().toISOString()) {
  return {
    meta: { app: 'trade-journal', schema: SCHEMA, version: APP_VERSION, createdAt: now, savedAt: null, envelope: null },
    counters: { trade: 0, seq: 0, id: 0 },
    settings: defaultSettings(),
    capital: { start: null, flows: [] },
    stocks: [], setups: [], errors: [],
    trades: [], dividends: [],
    trash: [], changeLog: [], stopHistory: [], splits: [],
    reports: [], layouts: {}, columnTemplates: {},
  };
}

export function nextId(state, prefix = 'x') { state.counters.id += 1; return prefix + state.counters.id.toString(36); }
export function nextSeq(state) { state.counters.seq += 1; return state.counters.seq; }
export function nextTradeId(state) { state.counters.trade += 1; return 'T-' + String(state.counters.trade).padStart(4, '0'); }

// A file written by a newer program is refused (the old program can never damage it).
export function checkFile(data) {
  if (!data || data.meta?.app !== 'trade-journal') return { ok: false, reason: 'This is not a Trade Journal data file.' };
  if (data.meta.schema > SCHEMA) return { ok: false, reason: 'This data file was saved by a newer version of the program. Update the program first.' };
  return { ok: true };
}
// Migration hook: each future structure change is one step. Returns the (possibly upgraded) data.
export function migrate(data) {
  const out = structuredClone(data);
  const base = emptyState();
  for (const k of Object.keys(base)) if (out[k] === undefined) out[k] = base[k];
  out.settings = { ...base.settings, ...out.settings };
  out.meta.schema = SCHEMA; out.meta.version = APP_VERSION;
  return out;
}

// B5: a new program version (or a structure change) is opening this file for the first time -> back up first
export function needsUpdateBackup(data) { return !!data && (data.meta?.version !== APP_VERSION || (data.meta?.schema ?? 0) < SCHEMA); }
