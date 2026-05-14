import crypto from "crypto";
import type { BrokerageActivity, InsertBrokerageActivity } from "@shared/schema";

/** Robinhood-style activity statement parsing + position/P&L aggregation. */

export interface ParsedBrokerageRow {
  activityDate: Date;
  processDate: Date | null;
  settleDate: Date | null;
  instrument: string | null;
  description: string;
  transCode: string;
  quantity: number | null;
  price: number | null;
  amount: number;
  optionType: "call" | "put" | null;
  optionStrike: number | null;
  optionExpiration: Date | null;
}

const OPTION_REGEX = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(Call|Put|CALL|PUT)\s+\$?([\d,]+\.?\d*)/;

export function parseMoney(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/[()$,\s]/g, "");
  if (!cleaned || cleaned === "-") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

export function parseQuantity(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseDate(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Common formats: MM/DD/YYYY, M/D/YY, YYYY-MM-DD
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    const month = parseInt(m[1], 10) - 1;
    const day = parseInt(m[2], 10);
    const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const d = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), 12, 0, 0));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Extract option metadata from description text like "ASML 4/17/2026 Put $1,360.00". */
export function parseOptionFromDescription(description: string): {
  optionType: "call" | "put" | null;
  optionStrike: number | null;
  optionExpiration: Date | null;
} {
  const m = description.match(OPTION_REGEX);
  if (!m) {
    return { optionType: null, optionStrike: null, optionExpiration: null };
  }
  const expiration = parseDate(m[1]);
  const optionType = m[2].toLowerCase() as "call" | "put";
  const strike = Number(m[3].replace(/,/g, ""));
  return {
    optionType,
    optionStrike: Number.isFinite(strike) ? strike : null,
    optionExpiration: expiration,
  };
}

/** Find a header value across the common header aliases of brokerage CSVs. */
export function pickField(row: Record<string, string>, aliases: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const lower = alias.toLowerCase();
    const found = keys.find((k) => k.trim().toLowerCase() === lower);
    if (found != null) return row[found];
  }
  return undefined;
}

export function parseBrokerageCsvRows(records: Array<Record<string, string>>): ParsedBrokerageRow[] {
  const parsed: ParsedBrokerageRow[] = [];
  for (const record of records) {
    const activityDateRaw = pickField(record, ["Activity Date", "Activity_Date", "ActivityDate", "Date"]);
    const activityDate = parseDate(activityDateRaw);
    if (!activityDate) continue;

    const transCodeRaw = pickField(record, ["Trans Code", "Trans_Code", "TransCode", "Transaction Code", "Action"]);
    const transCode = (transCodeRaw ?? "").trim().toUpperCase();
    if (!transCode) continue;

    const description = (pickField(record, ["Description", "Memo"]) ?? "").trim();
    const instrumentRaw = (pickField(record, ["Instrument", "Symbol", "Ticker"]) ?? "").trim().toUpperCase();
    const instrument = instrumentRaw || null;
    const amountRaw = pickField(record, ["Amount", "Net Amount"]);
    const amount = parseMoney(amountRaw);
    if (amount == null) continue;
    const quantity = parseQuantity(pickField(record, ["Quantity", "Qty", "Shares"]));
    const price = parseMoney(pickField(record, ["Price", "Avg Price"]));
    const processDate = parseDate(pickField(record, ["Process Date", "Process_Date", "ProcessDate"]));
    const settleDate = parseDate(pickField(record, ["Settle Date", "Settle_Date", "SettleDate"]));

    const opt = parseOptionFromDescription(description);

    parsed.push({
      activityDate,
      processDate,
      settleDate,
      instrument,
      description,
      transCode,
      quantity,
      price,
      amount,
      optionType: opt.optionType,
      optionStrike: opt.optionStrike,
      optionExpiration: opt.optionExpiration,
    });
  }
  return parsed;
}

/**
 * Stable signature for "same transaction on same date". Description is intentionally
 * excluded because monthly statements occasionally re-emit the same row with slightly
 * different wording (e.g., extra spaces, "Recurring" tag added later).
 *
 * Two real transactions on the same day with identical (instrument, code, qty, price,
 * amount) will collapse to one — that matches the user-stated dedup intent.
 */
export interface DedupKeyInput {
  activityDate: Date | string;
  instrument: string | null;
  transCode: string;
  quantity: number | string | null;
  price: number | string | null;
  amount: number | string;
}

export function buildSignature(row: DedupKeyInput): string {
  const dateIso = (row.activityDate instanceof Date
    ? row.activityDate
    : new Date(row.activityDate)
  )
    .toISOString()
    .slice(0, 10);
  const qty = row.quantity == null || row.quantity === "" ? "" : Number(row.quantity).toFixed(8);
  const price = row.price == null || row.price === "" ? "" : Number(row.price).toFixed(6);
  const amount = Number(row.amount).toFixed(2);
  return [
    dateIso,
    (row.instrument ?? "").toUpperCase(),
    String(row.transCode).toUpperCase(),
    qty,
    price,
    amount,
  ].join("|");
}

export function buildRowHash(row: DedupKeyInput): string {
  return crypto.createHash("sha256").update(buildSignature(row)).digest("hex");
}

export function toInsertRow(
  userId: string,
  row: ParsedBrokerageRow,
  sourceFileName: string | null
): InsertBrokerageActivity {
  return {
    userId,
    activityDate: row.activityDate,
    processDate: row.processDate,
    settleDate: row.settleDate,
    instrument: row.instrument,
    description: row.description,
    transCode: row.transCode,
    quantity: row.quantity != null ? String(row.quantity) : null,
    price: row.price != null ? String(row.price) : null,
    amount: row.amount.toFixed(2),
    optionType: row.optionType,
    optionStrike: row.optionStrike != null ? String(row.optionStrike) : null,
    optionExpiration: row.optionExpiration,
    rowHash: buildRowHash(row),
    sourceFileName,
  };
}

// ---------- Aggregation ----------

interface OpenOptionLeg {
  side: "short" | "long";
  type: "call" | "put";
  strike: number;
  expiration: string;
  contracts: number;
  netCashAtOpen: number; // signed: +credit for short, -debit for long
  activityDate: string;
}

/** FIFO lot for stock; ACATI lots use unitCost 0 (no basis in CSV). */
interface StockLot {
  qty: number;
  unitCost: number;
}

interface SymbolAccumulator {
  symbol: string;
  lots: StockLot[];
  stockInvestedExclACATI: number;
  totalBuyCostEver: number;
  stockRealizedPnl: number;
  dividends: number;
  optionPremiumCollectedGross: number;
  /** Net opening premium: sum(STO amount) + sum(BTO amount) as signed cash flows. */
  optionOpeningPremiumNet: number;
  optionRealizedPnl: number;
  optionPremiumOpenCredit: number;
  optionOpenDebit: number;
  openOptionLegs: OpenOptionLeg[];
  hasACATI: boolean;
}

export interface SymbolSummary {
  symbol: string;
  shares: number;
  avgCost: number;
  currentBasis: number;
  /** Sum of Buy cash outflows (absolute), excluding ACATI — per spec Section 2. */
  stockInvestedExclACATI: number;
  totalBuyCostEver: number;
  stockRealizedPnl: number;
  dividends: number;
  /** Sum of STO amounts only (gross short credits) — header card + gross label. */
  optionPremiumCollectedGross: number;
  /** STO + BTO opening cash, signed — per spec "option premium" column. */
  optionOpeningPremiumNet: number;
  optionRealizedPnl: number;
  optionPremiumOpenCredit: number;
  optionOpenDebit: number;
  optionsGainPct: number | null;
  /** Stock realized + option realized only (dividends excluded). */
  totalRealizedPnl: number;
  totalGainPct: number | null;
  hasOpenStock: boolean;
  hasOpenOptions: boolean;
  hasACATIBasisUnknown: boolean;
  openOptionLegs: OpenOptionLeg[];
}

export interface PeriodBucket {
  /** ISO key: YYYY-MM for month, YYYY for year. */
  period: string;
  label: string;
  stockBuyAmount: number;
  stockSellProceeds: number;
  stockRealizedPnl: number;
  optionPremiumCollected: number;
  optionRealizedPnl: number;
  dividends: number;
  cashDeposits: number;
  /** ACH deposit inflows only (positive amounts). */
  bankDeposits: number;
  cashWithdrawals: number;
  /** MINT — margin interest charged (typically negative). */
  marginInterest: number;
  /** INT — cash / sweep interest (typically positive). */
  cashInterest: number;
  /** Running sum of `bankDeposits` (ACH inflows) through this period. */
  cumulativeDeposited: number;
  netCashFlow: number;
}

export interface PortfolioTotals {
  symbols: SymbolSummary[];
  totalCurrentlyInvested: number;
  totalStockBasis: number;
  totalOpenOptionDebit: number;
  totalOpenOptionCredit: number;
  /** Stocks + options + CDIV/MDIV/DTAX net (all-time). */
  totalRealizedPnl: number;
  totalDividends: number;
  totalOptionRealizedPnl: number;
  totalStockRealizedPnl: number;
  totalOptionPremiumCollectedGross: number;
  /** Distinct non-empty instruments ever seen (any trans). */
  symbolsEverActive: number;
  /** Sum of MINT amounts (margin interest; usually negative). */
  totalMarginInterest: number;
  /** Sum of INT amounts (cash sweep interest). */
  totalCashInterest: number;
  rowCount: number;
  lastActivityDate: string | null;
  cashFlow: number;
  byMonth: PeriodBucket[];
  byYear: PeriodBucket[];
}

const STOCK_BUY_CODES = new Set(["BUY", "REINV", "DRIP"]);
const STOCK_SELL_CODES = new Set(["SELL"]);
const OPTION_OPEN_SHORT = new Set(["STO"]);
const OPTION_OPEN_LONG = new Set(["BTO"]);
const OPTION_CLOSE_SHORT = new Set(["BTC"]);
const OPTION_CLOSE_LONG = new Set(["STC"]);
const OPTION_EXPIRE = new Set(["OEXP", "EXP"]);
const OPTION_ASSIGN = new Set(["OASGN", "ASGN"]);
const SYMBOL_DIVIDEND_CODES = new Set(["CDIV", "MDIV", "DIV"]);
const DTAX_CODE = "DTAX";
/** Account-level cash / fees — never attribute to symbol P&L (spec Section 2 / bugs). */
const ACCOUNT_ONLY_CODES = new Set([
  "ACH",
  "MINT",
  "MISC",
  "ABIP",
  "DTAX",
  "INT",
  "WIRE",
  "ACATS",
]);
const CASH_FLOW_CODES = new Set(Array.from(ACCOUNT_ONLY_CODES));
const ACH_DEPOSIT_CODE = "ACH";

function consolidateOpenOptionLegs(legs: OpenOptionLeg[]): OpenOptionLeg[] {
  const map = new Map<string, OpenOptionLeg>();
  for (const leg of legs) {
    const key = `${leg.side}|${leg.type}|${leg.strike}|${leg.expiration}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...leg });
    } else {
      existing.contracts += leg.contracts;
      existing.netCashAtOpen += leg.netCashAtOpen;
      if (leg.activityDate < existing.activityDate) existing.activityDate = leg.activityDate;
    }
  }
  return Array.from(map.values());
}

function lotShares(lots: StockLot[]): number {
  return lots.reduce((s, l) => s + l.qty, 0);
}

function lotCostBasis(lots: StockLot[]): number {
  return lots.reduce((s, l) => s + l.qty * l.unitCost, 0);
}

function fifoSellStock(
  lots: StockLot[],
  qtyToSell: number,
  proceeds: number
): { realized: number; costRemoved: number } {
  let remaining = qtyToSell;
  let costConsumed = 0;
  const next: StockLot[] = [];
  for (const lot of lots) {
    if (remaining <= 0) {
      next.push(lot);
      continue;
    }
    if (lot.qty <= remaining) {
      costConsumed += lot.qty * lot.unitCost;
      remaining -= lot.qty;
    } else {
      costConsumed += remaining * lot.unitCost;
      next.push({ qty: lot.qty - remaining, unitCost: lot.unitCost });
      remaining = 0;
    }
  }
  lots.length = 0;
  lots.push(...next);
  const realized = proceeds - costConsumed;
  return { realized, costRemoved: costConsumed };
}

function applyStockSplit(lots: StockLot[], splQty: number): void {
  if (splQty <= 0) return;
  const before = lotShares(lots);
  if (before <= 0) return;
  const factor = (before + splQty) / before;
  for (const lot of lots) {
    lot.qty *= factor;
  }
}

function closeContracts(
  legs: OpenOptionLeg[],
  match: { type: "call" | "put"; strike: number; expiration: string; side: "short" | "long" },
  contractsToClose: number,
  closingCash: number
): { realized: number; releasedOpenCredit: number; releasedOpenDebit: number } {
  if (!Number.isFinite(contractsToClose) || contractsToClose <= 0) {
    return { realized: 0, releasedOpenCredit: 0, releasedOpenDebit: 0 };
  }
  let remaining = contractsToClose;
  let realized = 0;
  let releasedOpenCredit = 0;
  let releasedOpenDebit = 0;
  const filtered: OpenOptionLeg[] = [];
  for (const leg of legs) {
    if (
      remaining > 0 &&
      leg.side === match.side &&
      leg.type === match.type &&
      leg.strike === match.strike &&
      leg.expiration === match.expiration
    ) {
      const take = Math.min(leg.contracts, remaining);
      const fraction = take / leg.contracts;
      const cashFraction = leg.netCashAtOpen * fraction;
      const closingCashFraction = (closingCash * take) / contractsToClose;
      realized += cashFraction + closingCashFraction;
      if (leg.side === "short") releasedOpenCredit += Math.max(0, cashFraction);
      if (leg.side === "long") releasedOpenDebit += Math.max(0, -cashFraction);
      const remainingContracts = leg.contracts - take;
      remaining -= take;
      if (remainingContracts > 0) {
        filtered.push({
          ...leg,
          contracts: remainingContracts,
          netCashAtOpen: leg.netCashAtOpen * (remainingContracts / leg.contracts),
        });
      }
    } else {
      filtered.push(leg);
    }
  }
  legs.length = 0;
  legs.push(...filtered);
  return { realized, releasedOpenCredit, releasedOpenDebit };
}

function contractsToCloseOnLeg(
  legs: OpenOptionLeg[],
  side: "short" | "long",
  type: "call" | "put",
  strike: number,
  expiration: string,
  qty: number | null
): number {
  const fromRow = qty != null && Math.abs(qty) > 1e-9 ? Math.abs(qty) : 0;
  if (fromRow > 0) return fromRow;
  let sum = 0;
  for (const leg of legs) {
    if (
      leg.side === side &&
      leg.type === type &&
      leg.strike === strike &&
      leg.expiration === expiration
    ) {
      sum += leg.contracts;
    }
  }
  return sum;
}

export function aggregateActivities(activities: BrokerageActivity[]): PortfolioTotals {
  const sorted = [...activities].sort((a, b) => {
    const da = new Date(a.activityDate).getTime();
    const db = new Date(b.activityDate).getTime();
    if (da !== db) return da - db;
    const codeA = a.transCode.toUpperCase();
    const codeB = b.transCode.toUpperCase();
    const order = (code: string) => {
      if (OPTION_OPEN_SHORT.has(code) || OPTION_OPEN_LONG.has(code)) return 0;
      if (STOCK_BUY_CODES.has(code) || code === "ACATI") return 0;
      if (code === "SPL") return 1;
      return 2;
    };
    return order(codeA) - order(codeB);
  });

  const accumulators = new Map<string, SymbolAccumulator>();
  let cashFlow = 0;
  let lastActivityDate: string | null = null;
  const symbolsEverActive = new Set<string>();

  const monthBuckets = new Map<string, PeriodBucket>();
  const yearBuckets = new Map<string, PeriodBucket>();

  const ensureBucket = (
    map: Map<string, PeriodBucket>,
    period: string,
    label: string
  ): PeriodBucket => {
    let b = map.get(period);
    if (!b) {
      b = {
        period,
        label,
        stockBuyAmount: 0,
        stockSellProceeds: 0,
        stockRealizedPnl: 0,
        optionPremiumCollected: 0,
        optionRealizedPnl: 0,
        dividends: 0,
        cashDeposits: 0,
        bankDeposits: 0,
        cashWithdrawals: 0,
        marginInterest: 0,
        cashInterest: 0,
        cumulativeDeposited: 0,
        netCashFlow: 0,
      };
      map.set(period, b);
    }
    return b;
  };

  const getAcc = (symbol: string): SymbolAccumulator => {
    let acc = accumulators.get(symbol);
    if (!acc) {
      acc = {
        symbol,
        lots: [],
        stockInvestedExclACATI: 0,
        totalBuyCostEver: 0,
        stockRealizedPnl: 0,
        dividends: 0,
        optionPremiumCollectedGross: 0,
        optionOpeningPremiumNet: 0,
        optionRealizedPnl: 0,
        optionPremiumOpenCredit: 0,
        optionOpenDebit: 0,
        openOptionLegs: [],
        hasACATI: false,
      };
      accumulators.set(symbol, acc);
    }
    return acc;
  };

  /** CDIV + MDIV + DIV + DTAX (DTAX already negative in CSV) — header + realized. */
  let portfolioDividendsNet = 0;
  let totalMarginInterest = 0;
  let totalCashInterest = 0;

  for (const row of sorted) {
    cashFlow += Number(row.amount);
    lastActivityDate = new Date(row.activityDate).toISOString();
    const code = row.transCode.toUpperCase();
    const symbol = (row.instrument ?? "").trim().toUpperCase();
    if (symbol) symbolsEverActive.add(symbol);
    const qty = row.quantity != null ? Number(row.quantity) : null;
    const amount = Number(row.amount);

    const dt = new Date(row.activityDate);
    const monthKey = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
    const yearKey = String(dt.getUTCFullYear());
    const monthLabel = dt.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    const monthBucket = ensureBucket(monthBuckets, monthKey, monthLabel);
    const yearBucket = ensureBucket(yearBuckets, yearKey, yearKey);
    monthBucket.netCashFlow += amount;
    yearBucket.netCashFlow += amount;

    if (CASH_FLOW_CODES.has(code)) {
      if (code === "MINT") {
        monthBucket.marginInterest += amount;
        yearBucket.marginInterest += amount;
        totalMarginInterest += amount;
      } else if (code === "INT") {
        monthBucket.cashInterest += amount;
        yearBucket.cashInterest += amount;
        totalCashInterest += amount;
      } else if (amount >= 0) {
        monthBucket.cashDeposits += amount;
        yearBucket.cashDeposits += amount;
        if (code === ACH_DEPOSIT_CODE) {
          monthBucket.bankDeposits += amount;
          yearBucket.bankDeposits += amount;
        }
      } else {
        monthBucket.cashWithdrawals += amount;
        yearBucket.cashWithdrawals += amount;
      }
      if (code === DTAX_CODE) {
        monthBucket.dividends += amount;
        yearBucket.dividends += amount;
        portfolioDividendsNet += amount;
      }
      continue;
    }

    if (!symbol) continue;
    const acc = getAcc(symbol);

    if (SYMBOL_DIVIDEND_CODES.has(code)) {
      acc.dividends += amount;
      monthBucket.dividends += amount;
      yearBucket.dividends += amount;
      portfolioDividendsNet += amount;
      continue;
    }

    if (code === "ACATI" && qty != null && qty > 0 && !row.optionType) {
      acc.hasACATI = true;
      acc.lots.push({ qty, unitCost: 0 });
      continue;
    }

    if (code === "SPL" && qty != null && qty > 0 && !row.optionType) {
      applyStockSplit(acc.lots, qty);
      continue;
    }

    const isStockRow = !row.optionType;

    if (STOCK_BUY_CODES.has(code) && qty != null && qty > 0 && isStockRow) {
      const cost = Math.abs(amount);
      acc.lots.push({ qty, unitCost: cost / qty });
      acc.stockInvestedExclACATI += cost;
      acc.totalBuyCostEver += cost;
      monthBucket.stockBuyAmount += cost;
      yearBucket.stockBuyAmount += cost;
      continue;
    }

    if (STOCK_SELL_CODES.has(code) && qty != null && qty > 0 && isStockRow) {
      const proceeds = amount;
      const held = lotShares(acc.lots);
      const sellQty = Math.min(qty, held);
      if (sellQty > 0) {
        const proceedsPortion = qty > 0 ? (proceeds * sellQty) / qty : proceeds;
        const { realized } = fifoSellStock(acc.lots, sellQty, proceedsPortion);
        acc.stockRealizedPnl += realized;
        monthBucket.stockSellProceeds += proceedsPortion;
        yearBucket.stockSellProceeds += proceedsPortion;
        monthBucket.stockRealizedPnl += realized;
        yearBucket.stockRealizedPnl += realized;
      }
      continue;
    }

    const rawType = (row.optionType ?? "").toLowerCase();
    if ((rawType !== "call" && rawType !== "put") || row.optionStrike == null || !row.optionExpiration) {
      continue;
    }

    const type: "call" | "put" = rawType;
    const strike = Number(row.optionStrike);
    const expiration = new Date(row.optionExpiration).toISOString().slice(0, 10);
    const actDateStr = new Date(row.activityDate).toISOString().slice(0, 10);

    if (OPTION_OPEN_SHORT.has(code)) {
      const contracts = qty != null ? Math.abs(qty) : 1;
      acc.openOptionLegs.push({
        side: "short",
        type,
        strike,
        expiration,
        contracts,
        netCashAtOpen: amount,
        activityDate: actDateStr,
      });
      acc.optionPremiumCollectedGross += amount;
      acc.optionOpeningPremiumNet += amount;
      acc.optionPremiumOpenCredit += Math.max(0, amount);
      monthBucket.optionPremiumCollected += amount;
      yearBucket.optionPremiumCollected += amount;
      continue;
    }

    if (OPTION_OPEN_LONG.has(code)) {
      const contracts = qty != null ? Math.abs(qty) : 1;
      acc.openOptionLegs.push({
        side: "long",
        type,
        strike,
        expiration,
        contracts,
        netCashAtOpen: amount,
        activityDate: actDateStr,
      });
      acc.optionOpeningPremiumNet += amount;
      acc.optionOpenDebit += Math.max(0, -amount);
      monthBucket.optionPremiumCollected += amount;
      yearBucket.optionPremiumCollected += amount;
      continue;
    }

    if (OPTION_CLOSE_SHORT.has(code)) {
      const contracts = qty != null ? Math.abs(qty) : 1;
      const result = closeContracts(
        acc.openOptionLegs,
        { type, strike, expiration, side: "short" },
        contracts,
        amount
      );
      acc.optionRealizedPnl += result.realized;
      acc.optionPremiumOpenCredit = Math.max(0, acc.optionPremiumOpenCredit - result.releasedOpenCredit);
      monthBucket.optionRealizedPnl += result.realized;
      yearBucket.optionRealizedPnl += result.realized;
      continue;
    }

    if (OPTION_CLOSE_LONG.has(code)) {
      const contracts = qty != null ? Math.abs(qty) : 1;
      const result = closeContracts(
        acc.openOptionLegs,
        { type, strike, expiration, side: "long" },
        contracts,
        amount
      );
      acc.optionRealizedPnl += result.realized;
      acc.optionOpenDebit = Math.max(0, acc.optionOpenDebit - result.releasedOpenDebit);
      monthBucket.optionRealizedPnl += result.realized;
      yearBucket.optionRealizedPnl += result.realized;
      continue;
    }

    if (OPTION_EXPIRE.has(code) || OPTION_ASSIGN.has(code)) {
      const cShort = contractsToCloseOnLeg(acc.openOptionLegs, "short", type, strike, expiration, qty);
      const result = closeContracts(
        acc.openOptionLegs,
        { type, strike, expiration, side: "short" },
        cShort,
        amount
      );
      acc.optionRealizedPnl += result.realized;
      acc.optionPremiumOpenCredit = Math.max(0, acc.optionPremiumOpenCredit - result.releasedOpenCredit);

      const cLong = contractsToCloseOnLeg(acc.openOptionLegs, "long", type, strike, expiration, qty);
      const longResult = closeContracts(
        acc.openOptionLegs,
        { type, strike, expiration, side: "long" },
        cLong,
        amount
      );
      acc.optionRealizedPnl += longResult.realized;
      acc.optionOpenDebit = Math.max(0, acc.optionOpenDebit - longResult.releasedOpenDebit);
      monthBucket.optionRealizedPnl += result.realized + longResult.realized;
      yearBucket.optionRealizedPnl += result.realized + longResult.realized;
      continue;
    }
  }

  const symbols: SymbolSummary[] = [];
  let totalCurrentlyInvested = 0;
  let totalStockBasis = 0;
  let totalOpenOptionDebit = 0;
  let totalOpenOptionCredit = 0;
  let totalRealizedStocksOptions = 0;
  let totalOptionRealizedPnl = 0;
  let totalStockRealizedPnl = 0;
  let totalOptionPremiumCollectedGross = 0;

  for (const acc of Array.from(accumulators.values())) {
    const shares = roundShares(lotShares(acc.lots));
    const currentBasis = roundMoney(lotCostBasis(acc.lots));
    const avgCost = shares > 0 ? currentBasis / shares : 0;
    const stockRealized = acc.stockRealizedPnl;
    const optionRealized = acc.optionRealizedPnl;
    const dividends = acc.dividends;
    const totalRealizedNoDiv = stockRealized + optionRealized;
    const premNet = acc.optionOpeningPremiumNet;
    const absPrem = Math.abs(premNet);
    const investedDenom = acc.stockInvestedExclACATI + absPrem;
    const openLegs = consolidateOpenOptionLegs(acc.openOptionLegs);

    symbols.push({
      symbol: acc.symbol,
      shares,
      avgCost,
      currentBasis,
      stockInvestedExclACATI: acc.stockInvestedExclACATI,
      totalBuyCostEver: acc.totalBuyCostEver,
      stockRealizedPnl: stockRealized,
      dividends,
      optionPremiumCollectedGross: acc.optionPremiumCollectedGross,
      optionOpeningPremiumNet: premNet,
      optionRealizedPnl: optionRealized,
      optionPremiumOpenCredit: acc.optionPremiumOpenCredit,
      optionOpenDebit: acc.optionOpenDebit,
      optionsGainPct: absPrem > 1e-6 ? (optionRealized / absPrem) * 100 : null,
      totalRealizedPnl: totalRealizedNoDiv,
      totalGainPct: investedDenom > 1e-6 ? (totalRealizedNoDiv / investedDenom) * 100 : null,
      hasOpenStock: shares > 0,
      hasOpenOptions: openLegs.length > 0,
      hasACATIBasisUnknown: acc.hasACATI,
      openOptionLegs: openLegs,
    });

    totalCurrentlyInvested += currentBasis + acc.optionOpenDebit;
    totalStockBasis += currentBasis;
    totalOpenOptionDebit += acc.optionOpenDebit;
    totalOpenOptionCredit += acc.optionPremiumOpenCredit;
    totalRealizedStocksOptions += totalRealizedNoDiv;
    totalOptionRealizedPnl += optionRealized;
    totalStockRealizedPnl += stockRealized;
    totalOptionPremiumCollectedGross += acc.optionPremiumCollectedGross;
  }

  const totalDividends = portfolioDividendsNet;
  const totalRealizedPnl = totalRealizedStocksOptions + portfolioDividendsNet;

  symbols.sort((a, b) => {
    const aActive = a.hasOpenStock || a.hasOpenOptions ? 1 : 0;
    const bActive = b.hasOpenStock || b.hasOpenOptions ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const valueA = a.currentBasis + a.optionOpenDebit;
    const valueB = b.currentBasis + b.optionOpenDebit;
    if (valueA !== valueB) return valueB - valueA;
    return a.symbol.localeCompare(b.symbol);
  });

  const byMonth = Array.from(monthBuckets.values()).sort((a, b) =>
    a.period.localeCompare(b.period)
  );
  const byYear = Array.from(yearBuckets.values()).sort((a, b) =>
    a.period.localeCompare(b.period)
  );
  applyCumulativeDeposited(byMonth);
  applyCumulativeDeposited(byYear);

  return {
    symbols,
    totalCurrentlyInvested,
    totalStockBasis,
    totalOpenOptionDebit,
    totalOpenOptionCredit,
    totalRealizedPnl,
    totalDividends,
    totalOptionRealizedPnl,
    totalStockRealizedPnl,
    totalOptionPremiumCollectedGross,
    symbolsEverActive: symbolsEverActive.size,
    totalMarginInterest,
    totalCashInterest,
    rowCount: activities.length,
    lastActivityDate,
    cashFlow,
    byMonth,
    byYear,
  };
}

function roundShares(n: number): number {
  // Fractional shares can drift due to floating math; trim near-zero balances.
  if (Math.abs(n) < 1e-6) return 0;
  return Math.round(n * 1e8) / 1e8;
}

function roundMoney(n: number): number {
  if (Math.abs(n) < 1e-6) return 0;
  return Math.round(n * 100) / 100;
}

/** Running sum of ACH inflows (`bankDeposits`) for each bucket in order. */
function applyCumulativeDeposited(buckets: PeriodBucket[]): void {
  let cum = 0;
  for (const b of buckets) {
    cum += b.bankDeposits;
    b.cumulativeDeposited = cum;
  }
}
