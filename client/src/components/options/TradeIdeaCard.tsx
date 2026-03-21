import { useState, useMemo } from "react";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Calendar,
  Target,
  DollarSign,
  Percent,
  Clock,
  ChevronDown,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TradeIdea, OptionStrategy } from "@shared/optionsSchema";

interface TradeIdeaCardProps {
  idea: TradeIdea;
  selected?: boolean;
  parityThreshold?: number;
  onClick?: () => void;
}

const recommendationConfig = {
  strong_buy: {
    label: "Strong Buy",
    color: "bg-green-500 text-white",
    icon: CheckCircle,
  },
  buy: {
    label: "Buy",
    color: "bg-green-400 text-white",
    icon: TrendingUp,
  },
  neutral: {
    label: "Neutral",
    color: "bg-yellow-500 text-white",
    icon: Target,
  },
  avoid: {
    label: "Avoid",
    color: "bg-red-500 text-white",
    icon: AlertTriangle,
  },
};

function getParityBadgeInfo(
  deviation: number,
  threshold: number
): { color: string; icon: string; label: string } {
  const absDeviation = Math.abs(deviation);
  const threshold2 = 0.2;

  if (absDeviation > threshold) {
    return { color: "bg-red-100 text-red-700", icon: "🔴", label: "Arbitrage" };
  } else if (absDeviation > threshold2) {
    return { color: "bg-yellow-100 text-yellow-700", icon: "🟡", label: "Fair" };
  } else {
    return { color: "bg-green-100 text-green-700", icon: "🟢", label: "Tight" };
  }
}

function getPremiumQualityForStrategy(
  strategy: OptionStrategy,
  parityDeviation: { callDev?: number | null; putDev?: number | null },
  threshold: number
): { label: string; detail: string; color: string } | null {
  const { callDev, putDev } = parityDeviation;

  // Only apply to premium-selling strategies the user cares about
  const isPutPremiumStrategy =
    strategy === "put_credit_spread" || strategy === "cash_secured_put" || strategy === "iron_condor";
  const isCallPremiumStrategy =
    strategy === "call_credit_spread" || strategy === "covered_call" || strategy === "iron_condor";

  if (!isPutPremiumStrategy && !isCallPremiumStrategy) return null;
  if (callDev == null && putDev == null) return null;

  const th = threshold; // user slider, e.g. 0.5%+

  const classify = (dev?: number | null): "great" | "good" | "thin" | "cheap" | "na" => {
    if (dev == null || !Number.isFinite(dev)) return "na";
    // tighter bands: cheap <= 0, thin 0–th, good th–2*th, great >2*th
    if (dev > th * 2) return "great";
    if (dev > th) return "good";
    if (dev > 0) return "thin";
    return "cheap"; // negative vs parity
  };

  const putQuality = classify(putDev);
  const callQuality = classify(callDev);

  // Iron condor: consider both sides
  if (strategy === "iron_condor") {
    const scores = [putQuality, callQuality];
    if (scores.includes("great")) {
      return {
        label: "Great credit",
        detail: "Both wings rich vs parity",
        color: "text-green-700",
      };
    }
    if (scores.includes("good")) {
      return {
        label: "Good credit",
        detail: "At least one wing rich vs parity",
        color: "text-green-600",
      };
    }
    if (scores.includes("thin")) {
      return {
        label: "Thin credit",
        detail: "Only slight edge vs parity",
        color: "text-amber-600",
      };
    }
    return {
      label: "Weak credit",
      detail: "Premium under parity on both sides",
      color: "text-red-600",
    };
  }

  // Put credit / CSP
  if (isPutPremiumStrategy && !isCallPremiumStrategy) {
    switch (putQuality) {
      case "great":
      case "good":
        return {
          label: "Good premium",
          detail: "Short put rich vs parity",
          color: "text-green-600",
        };
      case "thin":
        return {
          label: "Okay premium",
          detail: "Slight edge vs parity",
          color: "text-amber-600",
        };
      case "cheap":
        return {
          label: "Thin premium",
          detail: "Put cheap vs parity (lower credit)",
          color: "text-red-600",
        };
      default:
        return null;
    }
  }

  // Call credit / covered call
  if (isCallPremiumStrategy && !isPutPremiumStrategy) {
    switch (callQuality) {
      case "great":
      case "good":
        return {
          label: "Good premium",
          detail: "Short call rich vs parity",
          color: "text-green-600",
        };
      case "thin":
        return {
          label: "Okay premium",
          detail: "Slight edge vs parity",
          color: "text-amber-600",
        };
      case "cheap":
        return {
          label: "Thin premium",
          detail: "Call cheap vs parity (lower credit)",
          color: "text-red-600",
        };
      default:
        return null;
    }
  }

  return null;
}

export function TradeIdeaCard({
  idea,
  selected,
  parityThreshold = 0.5,
  onClick,
}: TradeIdeaCardProps) {
  const [showParityDetails, setShowParityDetails] = useState(false);
  const rec = recommendationConfig[idea.recommendation];
  const RecIcon = rec.icon;

  // Calculate parity info if available - properly memoized to update with threshold
  const hasParity = useMemo(
    () => idea.parityMetrics !== undefined,
    [idea.parityMetrics]
  );

  const parityBadgeInfo = useMemo(() => {
    let badgeInfo = { color: "", icon: "", label: "" };
    if (hasParity && idea.parityMetrics) {
      const maxDeviation = Math.max(
        Math.abs(idea.parityMetrics.callPriceDeviation),
        Math.abs(idea.parityMetrics.putPriceDeviation)
      );
      badgeInfo = getParityBadgeInfo(maxDeviation, parityThreshold);
    }
    return badgeInfo;
  }, [hasParity, idea.parityMetrics, parityThreshold]);

  const premiumQuality = useMemo(
    () =>
      hasParity && idea.parityMetrics
        ? getPremiumQualityForStrategy(
            idea.strategy,
            {
              callDev: idea.parityMetrics.callPriceDeviation,
              putDev: idea.parityMetrics.putPriceDeviation,
            },
            parityThreshold
          )
        : null,
    [hasParity, idea.parityMetrics, idea.strategy, parityThreshold]
  );

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        selected && "ring-2 ring-primary shadow-md"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h4 className="font-semibold">{idea.strategyName}</h4>
            <p className="text-sm text-muted-foreground">
              {idea.daysToExpiration} DTE | Exp: {idea.expirationDate}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge className={cn("flex items-center gap-1", rec.color)}>
              <RecIcon className="h-3 w-3" />
              {rec.label}
            </Badge>
            {hasParity && (
              <Badge
                className={cn(
                  "flex items-center gap-1 cursor-pointer hover:shadow-md",
                  parityBadgeInfo.color
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowParityDetails(!showParityDetails);
                }}
                title="Click to see put-call parity details"
              >
                <span className="text-lg">{parityBadgeInfo.icon}</span>
                <span className="text-xs font-medium">{parityBadgeInfo.label}</span>
              </Badge>
            )}
          </div>
        </div>

        {/* Trade Legs */}
        <div className="mb-3 space-y-1 text-sm">
          {idea.legs.map((leg, index) => (
            <div key={index} className="flex items-center justify-between text-muted-foreground">
              <span>
                {leg.action === "sell" ? "Sell" : "Buy"} ${leg.strike} {leg.type}
              </span>
              <span className={leg.action === "sell" ? "text-green-600" : "text-red-600"}>
                {leg.action === "sell" ? "+" : "-"}${leg.price.toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex items-center gap-1">
            <DollarSign className="h-3 w-3 text-green-500" />
            <span className="text-muted-foreground">Max Profit:</span>
            <span className="font-medium text-green-600">${idea.maxProfit.toFixed(0)}</span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingDown className="h-3 w-3 text-red-500" />
            <span className="text-muted-foreground">Max Loss:</span>
            <span className="font-medium text-red-600">${Math.abs(idea.maxLoss).toFixed(0)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Percent className="h-3 w-3 text-blue-500" />
            <span className="text-muted-foreground">POP:</span>
            <span className="font-medium">{idea.probabilityOfProfit}%</span>
          </div>
          <div className="flex items-center gap-1">
            <Target className="h-3 w-3 text-purple-500" />
            <span className="text-muted-foreground">R:R:</span>
            <span className="font-medium">1:{(1 / idea.riskRewardRatio).toFixed(1)}</span>
          </div>
        </div>

        {/* Premium quality from parity for credit strategies */}
        {premiumQuality && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <Percent className="h-3 w-3 text-teal-500" />
            <span className="text-muted-foreground">Premium quality:</span>
            <span className={`font-semibold ${premiumQuality.color}`}>
              {premiumQuality.label}
            </span>
            <span className="text-muted-foreground">• {premiumQuality.detail}</span>
          </div>
        )}

        {/* Breakeven */}
        <div className="mt-2 text-sm">
          <span className="text-muted-foreground">Breakeven: </span>
          <span className="font-medium">
            {idea.breakeven.map((b) => `$${b.toFixed(2)}`).join(" / ")}
          </span>
        </div>

        {/* Parity Details (Expandable) */}
        {hasParity && idea.parityMetrics && showParityDetails && (
          <div className="mt-3 border-t pt-3 space-y-2 bg-blue-50 dark:bg-blue-950 p-2 rounded">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <h5 className="font-semibold text-sm text-blue-900 dark:text-blue-100">
                Put-Call Parity Analysis
              </h5>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Call Price (Parity Says):</span>
                <span className="font-medium">
                  Market: ${idea.parityMetrics.parityImpliedCallPrice.toFixed(2)} |{" "}
                  <span
                    className={
                      idea.parityMetrics.callPriceDeviation > 0
                        ? "text-red-600"
                        : "text-green-600"
                    }
                  >
                    {idea.parityMetrics.callPriceDeviation > 0 ? "+" : ""}
                    {idea.parityMetrics.callPriceDeviation.toFixed(2)}%
                  </span>
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted-foreground">Put Price (Parity Says):</span>
                <span className="font-medium">
                  Market: ${idea.parityMetrics.parityImpliedPutPrice.toFixed(2)} |{" "}
                  <span
                    className={
                      idea.parityMetrics.putPriceDeviation > 0
                        ? "text-red-600"
                        : "text-green-600"
                    }
                  >
                    {idea.parityMetrics.putPriceDeviation > 0 ? "+" : ""}
                    {idea.parityMetrics.putPriceDeviation.toFixed(2)}%
                  </span>
                </span>
              </div>

              <div className="flex justify-between border-t pt-1 mt-1">
                <span className="text-muted-foreground font-semibold">
                  Arbitrage Profit:
                </span>
                <span className="font-bold text-green-600">
                  {idea.parityMetrics.arbitrageProfitPercent.toFixed(2)}% |{" "}
                  ${idea.parityMetrics.arbitrageProfitDollars.toFixed(2)}
                </span>
              </div>

              <div className="text-muted-foreground text-xs italic pt-1">
                Threshold: {parityThreshold.toFixed(1)}% | Equation: C + PV(X) = P + S
              </div>

              {Math.abs(idea.parityMetrics.callPriceDeviation) > parityThreshold ||
              Math.abs(idea.parityMetrics.putPriceDeviation) > parityThreshold ? (
                <div className="bg-yellow-100 dark:bg-yellow-900 border border-yellow-300 dark:border-yellow-700 rounded p-1 mt-1">
                  <p className="text-yellow-800 dark:text-yellow-100 text-xs font-semibold">
                    💡 Opportunity: {idea.parityMetrics.direction === "call_expensive"
                      ? "Buy PUT, Sell CALL"
                      : "Buy CALL, Sell PUT"}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Earnings Warning */}
        {idea.hasEarningsRisk && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-yellow-500/10 px-2 py-1 text-sm text-yellow-600">
            <AlertTriangle className="h-4 w-4" />
            <span>Earnings on {idea.earningsDate} - elevated risk</span>
          </div>
        )}

        {/* Notes */}
        {idea.notes.length > 0 && (
          <div className="mt-3 space-y-1 border-t pt-2">
            {idea.notes.slice(0, 2).map((note, index) => (
              <p key={index} className="text-xs text-muted-foreground">
                {note}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
