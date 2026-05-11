/**
 * Strategic leverage & sector bucket mapping (Yahoo sector + industry heuristics).
 * Used by the quality screener ENTRY/HOLD/EXIT rules — not investment advice.
 */
import type { Fundamentals } from "./fundamentalsService";

export type StrategicBucketId =
  | "TIER1_INDUSTRIAL"
  | "TIER2_DEFENSIVE_SAAS"
  | "TIER3_AI_INFRA"
  | "TIER4_AI_APPS"
  | "OTHER";

export interface StrategicBucket {
  id: StrategicBucketId;
  /** Short UI label */
  label: string;
  /** Net debt / EBITDA entry cap (before modifiers) */
  baseEntryCap: number;
  baseExitCap: number;
  /** Minimum DSCR proxy = FCF / interest expense */
  dscrFloor: number;
  /** Require FCF/EBITDA >= this for ENTRY (null = no rule) */
  fcfConversionEntryMin: number | null;
  /** Require debt/FCF payback <= years for ENTRY (null = no rule) */
  paybackMaxYears: number | null;
  /** If |CapEx|/EBITDA > this, subtract maintenanceCapPenalty from entry cap */
  maintenanceCapexToEbitdaThreshold: number;
  maintenanceCapPenalty: number;
  /** Floor for entry cap after penalties */
  entryCapFloor: number;
}

function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase().trim();
}

/**
 * Map Yahoo `assetProfile.sector` + `industry` into a strategic bucket.
 * Order: most specific first (AI infra vs semis vs apps).
 */
export function mapStrategicBucket(f: Pick<Fundamentals, "sector" | "industry">): StrategicBucket {
  const sector = norm(f.sector);
  const industry = norm(f.industry);

  const has = (sub: string) => industry.includes(sub) || sector.includes(sub);

  const dcStyleReit =
    sector === "real estate" &&
    (has("data center") || has("colocation") || has("digital infrastructure") || has("tower"));

  const tier3Compute =
    has("semiconductor") ||
    has("computer hardware") ||
    has("communication equipment");

  // ── Tier 3: AI infra / data centers / heavy compute supply chain
  if (dcStyleReit || tier3Compute) {
    return {
      id: "TIER3_AI_INFRA",
      label: "AI infra / DC / semis",
      baseEntryCap: 4.5,
      baseExitCap: 5.5,
      dscrFloor: 1.5,
      fcfConversionEntryMin: null,
      paybackMaxYears: 5,
      maintenanceCapexToEbitdaThreshold: 0.4,
      maintenanceCapPenalty: 0.5,
      entryCapFloor: 2.5,
    };
  }

  // ── Tier 4: AI apps / consumer / ad-led / volatile software
  if (
    sector === "communication services" ||
    has("internet content") ||
    has("interactive media") ||
    has("advertising") ||
    has("software — application") ||
    has("application software") ||
    (sector === "technology" && has("software") && !has("infrastructure"))
  ) {
    return {
      id: "TIER4_AI_APPS",
      label: "AI apps / consumer tech",
      baseEntryCap: 2.5,
      baseExitCap: 3.5,
      dscrFloor: 1.5,
      fcfConversionEntryMin: null,
      paybackMaxYears: null,
      maintenanceCapexToEbitdaThreshold: 0.25,
      maintenanceCapPenalty: 0.5,
      entryCapFloor: 2.0,
    };
  }

  // ── Tier 2: defensive SaaS / services / insurance / waste
  if (
    (sector === "financial services" && (has("insurance") || has("capital markets") || has("broker"))) ||
    has("waste") ||
    has("environmental services") ||
    has("software — infrastructure") ||
    has("infrastructure software") ||
    (sector === "technology" && has("software") && has("infrastructure"))
  ) {
    return {
      id: "TIER2_DEFENSIVE_SAAS",
      label: "Defensive SaaS / services",
      baseEntryCap: 5.5,
      baseExitCap: 6.5,
      dscrFloor: 1.3,
      fcfConversionEntryMin: null,
      paybackMaxYears: null,
      maintenanceCapexToEbitdaThreshold: 0.05,
      maintenanceCapPenalty: 0.5,
      entryCapFloor: 3.5,
    };
  }

  // ── Tier 1: industrial / cyclical / tangible-heavy
  if (
    sector === "industrials" ||
    sector === "basic materials" ||
    sector === "energy" ||
    sector === "utilities" ||
    (sector === "consumer cyclical" &&
      (has("auto") || has("airlines") || has("marine") || has("trucking") || has("logistics") || has("machinery")))
  ) {
    return {
      id: "TIER1_INDUSTRIAL",
      label: "Industrial / cyclical",
      baseEntryCap: 3.5,
      baseExitCap: 5.0,
      dscrFloor: 2.0,
      fcfConversionEntryMin: 0.5,
      paybackMaxYears: null,
      maintenanceCapexToEbitdaThreshold: 0.25,
      maintenanceCapPenalty: 0.5,
      entryCapFloor: 2.5,
    };
  }

  // Default: middle path
  return {
    id: "OTHER",
    label: "Other / blended",
    baseEntryCap: 3.5,
    baseExitCap: 5.0,
    dscrFloor: 1.4,
    fcfConversionEntryMin: null,
    paybackMaxYears: null,
    maintenanceCapexToEbitdaThreshold: 0.25,
    maintenanceCapPenalty: 0.5,
    entryCapFloor: 2.5,
  };
}

/** Effective entry/exit caps after maintenance modifier (CapEx intensity). */
export function effectiveLeverageCaps(
  f: Fundamentals,
  bucket: StrategicBucket
): { entryMaxLeverage: number; exitLeverage: number; maintenanceApplied: boolean; capexToEbitda: number | null } {
  let entry = bucket.baseEntryCap;
  const exit = bucket.baseExitCap;

  const ebitda = f.ttmEbitda;
  const capex = f.ttmCapex;
  let capexToEbitda: number | null = null;
  let maintenanceApplied = false;
  if (ebitda != null && ebitda !== 0 && capex != null) {
    capexToEbitda = Math.abs(capex) / Math.abs(ebitda);
    if (capexToEbitda > bucket.maintenanceCapexToEbitdaThreshold) {
      entry -= bucket.maintenanceCapPenalty;
      maintenanceApplied = true;
    }
  }
  entry = Math.max(bucket.entryCapFloor, entry);

  return { entryMaxLeverage: entry, exitLeverage: exit, maintenanceApplied, capexToEbitda };
}
