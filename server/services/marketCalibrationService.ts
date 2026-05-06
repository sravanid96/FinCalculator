/**
 * Re-calibrates rule-of-thumb multiples and DCF discount from:
 * - 10Y Treasury (^TNX)
 * - Sector ETF forward P/E (SMH, IGV, XLI, …) when the theme maps to an anchor
 * - Residual semis-style tilt only when no valid sector forward P/E (avoids double-counting)
 */

export interface SectorIndexSnapshot {
  etf: string;
  forwardPE: number | null;
  trailingPE: number | null;
}

export interface MarketCalibration {
  treasury10yPct: number | null;
  treasury10yEffectivePct: number;
  treasurySource: "yahoo^TNX" | "fallback";
  dcfDiscountRate: number;
  equityRiskPremium: number;
  multiples: { bear: number; base: number; bull: number };
  sectorPremium: string;
  notes: string[];

  /** ETF used as sector “re-rating” anchor, if any. */
  sectorEtf: string | null;
  sectorForwardPE: number | null;
  sectorTrailingPE: number | null;
  /** Base multiple implied only from the 10Y curve (before sector blend). */
  baseFromYield: number;
  /** Base multiple implied from ETF forward P/E × 0.9 (cap/floor), or null if skipped. */
  baseFromSector: number | null;
}

const SEMI_STYLE_UNIVERSES = new Set([
  "AI_INFRA",
  "SEMIS",
  "MEMORY",
  "PHOTONICS",
  "AI_TESTING",
]);

/** Map screener universe → Yahoo sector ETF for forward P/E anchor. */
export function getAnchorEtfForUniverse(universeId: string | null): string | null {
  if (!universeId) return null;
  const id = universeId.toUpperCase();
  if (SEMI_STYLE_UNIVERSES.has(id)) return "SMH"; // VanEck semis — forward P/E tracks semis re-rating
  if (id === "SOFTWARE_DISCOUNT" || id === "CYBERSEC") return "IGV";
  if (id === "RESHORING") return "XLI";
  if (id === "DEFENSE") return "ITA";
  if (id === "CARDS") return "XLF";
  if (id === "GLP1") return "XLV";
  return null;
}

/**
 * @param sector — live snapshot from getEtfValuationSnapshot(etf); null if custom universe / no ETF
 */
export function buildMarketCalibration(
  universeId: string | null,
  treasury10yPct: number | null,
  sector: SectorIndexSnapshot | null
): MarketCalibration {
  const notes: string[] = [];
  const tnxObserved = treasury10yPct;
  let source: "yahoo^TNX" | "fallback" = "yahoo^TNX";
  let tnx = treasury10yPct;

  if (tnx === null || !Number.isFinite(tnx) || tnx <= 0 || tnx > 20) {
    tnx = 4.25;
    source = "fallback";
    notes.push("10Y Treasury (^TNX) missing or invalid — using 4.25% for calibration.");
  }

  const t = Math.min(8, Math.max(1.5, tnx));

  const baseFromYield = Math.round(Math.min(26, Math.max(14, 15 + (5.25 - t) * 1.4)));

  let base = baseFromYield;
  let baseFromSector: number | null = null;
  const fpe = sector?.forwardPE ?? null;

  if (sector?.etf && fpe !== null && fpe >= 8 && fpe <= 70) {
    // ETF forward P/E → rough “market base” for single-stock forward EPS bands (~90% of index multiple).
    baseFromSector = Math.round(Math.min(34, Math.max(12, fpe * 0.9)));
    base = Math.round(0.38 * baseFromYield + 0.62 * baseFromSector);
    notes.push(
      `Sector ${sector.etf}: forward P/E ${fpe.toFixed(1)} → anchor ${baseFromSector}×; blended with yield base ${baseFromYield}× (38%/62%) → ${base}×.`,
    );
  } else if (sector?.etf) {
    notes.push(`Sector ETF ${sector.etf}: forward P/E missing or out of range — multiples use yield curve only.`);
  }

  let bear = Math.max(8, base - 7);
  let bull = Math.min(42, base + 11);

  let sectorPremium = "Custom / general (no sector ETF anchor)";
  const sectorAnchorUsed = sector?.etf && fpe !== null && fpe >= 8 && fpe <= 70;

  if (sectorAnchorUsed && universeId && sector?.etf) {
    sectorPremium = `${universeId}: base multiple blends ^TNX with ${sector.etf} forward P/E (semis/software re-rate proxy).`;
  } else if (universeId && SEMI_STYLE_UNIVERSES.has(universeId)) {
    bear += 1;
    bull += 2;
    sectorPremium = `${universeId}: +1 bear / +2 bull (semis tilt — no live sector forward P/E).`;
    notes.push("Semis-style universe: manual band tilt because sector ETF forward P/E was unavailable.");
  }

  const erp = 0.045;
  const rf = tnx / 100;
  let dcfR = rf + erp;
  dcfR = Math.min(0.135, Math.max(0.082, dcfR));

  notes.push(
    `Calibration: 10Y = ${tnx.toFixed(2)}% (${source}), DCF discount ≈ ${(dcfR * 100).toFixed(2)}%. EPS bands: ${bear}× / ${base}× / ${bull}× forward.`,
  );

  return {
    treasury10yPct:
      tnxObserved !== null && Number.isFinite(tnxObserved) && tnxObserved > 0 && tnxObserved <= 20
        ? tnxObserved
        : null,
    treasury10yEffectivePct: tnx,
    treasurySource: source,
    dcfDiscountRate: dcfR,
    equityRiskPremium: erp,
    multiples: { bear, base, bull },
    sectorPremium,
    notes,
    sectorEtf: sector?.etf ?? null,
    sectorForwardPE: sector?.forwardPE ?? null,
    sectorTrailingPE: sector?.trailingPE ?? null,
    baseFromYield,
    baseFromSector,
  };
}
